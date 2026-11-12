import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { withPipelineLock, LockTimeoutError } from '../pipeline-lock.mjs';
import { readState, changeState, credentialQuestion, lookupAnswer, rememberAnswer, wakeAnsweredJob, skipJobByUser } from './lean-apply.mjs';
import { reusableFactKey } from './lean-question-keys.mjs';
import { requiresEmployerEvidence } from './lean-form-defaults.mjs';

const active = status => status === 'queued' || status === 'sent';
const statuses = new Set(['queued', 'sent', 'answered', 'timeout', 'cancelled', 'undeliverable']);
const requestId = /^r_[A-Za-z0-9_]+$/;

export function isSkipJobReply(value) {
  if (typeof value !== 'string') return false;
  const text = value.normalize('NFKC').trim().replace(/[。.!！]+$/u, '').trim().toLowerCase();
  return ['/skip-job', '不投递这个岗位', '不投这个岗位', '这个岗位不投了', '跳过这个岗位', '放弃这个岗位'].includes(text);
}

export function loadRelayConfig(env = process.env, file = join(homedir(), '.config/dsh-omni/relay.json')) {
  let stored = {};
  try { stored = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' && !env.DSH_OMNI_RELAY_TOKEN) throw Error('Cannot read private dsh-omni relay configuration'); }
  const token = String(env.DSH_OMNI_RELAY_TOKEN || stored?.token || '').trim();
  if (!token) return null;
  if (!/^relay_[A-Za-z0-9_-]+$/.test(token)) throw Error('Invalid relay application token format');
  let url;
  try { url = new URL(env.DSH_OMNI_RELAY_URL || stored?.url || 'http://127.0.0.1:3100'); }
  catch { throw Error('Invalid dsh-omni relay URL'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
    throw Error('Relay URL must be HTTPS or loopback HTTP, with no embedded credentials or query');
  }
  return { base: url.href.replace(/\/+$/, ''), token };
}

export function makeRelayClient(config, fetchFn = fetch) {
  if (!config) return null;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` };
  async function call(path, { body, wait = 0 } = {}) {
    let response;
    try {
      response = await fetchFn(config.base + '/api/relay/' + path, {
        headers, method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', signal: AbortSignal.timeout((wait + 5) * 1000),
      });
    } catch (error) {
      throw Object.assign(Error('dsh-omni relay could not be reached'), {
        notSent: ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.cause?.code),
      });
    }
    if (!response.ok) throw Object.assign(Error(`dsh-omni relay returned HTTP ${response.status}`), { httpStatus: response.status });
    const data = await response.json().catch(() => null);
    if (!data?.ok) throw Error('Invalid dsh-omni relay response');
    return data;
  }
  function requestState(data, expectedId) {
    if (!requestId.test(data.id) || !statuses.has(data.status) || (expectedId && data.id !== expectedId)) throw Error('Invalid dsh-omni request state');
    return data;
  }
  async function request(path, options, expectedId) {
    return requestState(await call(path, options), expectedId);
  }
  return {
    check: () => call('requests?status=sent'),
    ask: body => request('ask', { body }),
    poll: (id, wait) => {
      if (!requestId.test(id)) throw Error('Invalid dsh-omni request ID');
      return request(`requests/${id}?wait=${wait}`, { wait }, id);
    },
    cancel: async id => {
      if (!requestId.test(id)) throw Error('Invalid dsh-omni request ID');
      const data = await call(`requests/${id}/cancel`, { body: {} });
      // Older relay builds return only {ok:true} when the request is already terminal.
      if (data.id === undefined && data.status === undefined) return request(`requests/${id}?wait=0`, {}, id);
      return requestState(data, id);
    },
  };
}

function waitingQuestions(state, employer = false) {
  return Object.values(state.jobs).filter(job => job.status === 'waiting' && !job.user_skip).flatMap(job =>
    job.questions.filter(q => requiresEmployerEvidence(q) === employer && !credentialQuestion(q.text) && !q.relay?.reply && !lookupAnswer(state, job, q.text))
      .map(question => ({ job, question })));
}

function activeFactKeys(items) {
  return new Set(items.filter(({ question }) => active(question.relay?.status))
    .map(({ job, question }) => reusableFactKey(job, question.text)).filter(Boolean));
}
async function updateQuestion(root, item, update, keepReceipt = false) {
  return changeState(root, state => {
    const job = state.jobs[item.job.key];
    const original = item.question;
    const question = job?.questions?.find(q => original.id ? q.id === original.id : job.claim === item.job.claim && q.text === original.text);
    if (!question || (!keepReceipt && (job.user_skip || job.status !== 'waiting' || lookupAnswer(state, job, question.text)))) return;
    return update(state, job, question);
  });
}
function saveResponse(root, item, response) {
  return updateQuestion(root, item, (state, job, question) => {
    question.relay = { id: response.id, status: response.status, checked_at: Date.now() };
    const answer = response.answer;
    if (response.status !== 'answered' || !['quote', 'code'].includes(answer?.via)) return;
    const value = [answer.choice, answer.text].find(value => typeof value === 'string' && value.trim())?.trim();
    if (!value || /\brelay_[A-Za-z0-9_-]+\b/.test(value)) return;
    // A correlated control reply always takes precedence over saved facts and
    // readiness. It is never a recruiting fact and never applies to other jobs.
    if (isSkipJobReply(value)) {
      skipJobByUser(state, job, { confirmed: true, source: `QQ relay ${answer.via}`, request_id: response.id,
        answered_at: Number.isFinite(response.answeredAt) ? response.answeredAt : null });
      return { skipped: job.key };
    }
    if (job.user_skip || job.status !== 'waiting' || credentialQuestion(question.text) || requiresEmployerEvidence(question) || lookupAnswer(state, job, question.text)) return;
    question.relay.reply = { value, via: answer.via, request_id: response.id, answered_at: Number.isFinite(response.answeredAt) ? response.answeredAt : null };
    // Time-sensitive or handoff replies go to the agent with their provenance for interpretation.
    if (!/offer|deadline|截止/i.test(question.text) && !/^(?:我自己填|不知道|不确定|I don't know|I'll fill it)$/i.test(value)) {
      rememberAnswer(state, { job, question: question.text, value, confirmed: true, source: `QQ relay ${answer.via} (${response.id})` });
    }
    wakeAnsweredJob(state, job);
  }, true);
}

async function dispatchQuestion(root, item, client) {
  const { job, question } = item;
  const text = `Career Ops · ${job.company} · ${job.title}\n${question.text}\n\n不再投递此岗位：引用本消息或带 #短码 回复 /skip-job（也可回复：不投递这个岗位）。将停止此岗位的投递和后续提问。`;
  if (text.length > 2000) {
    await updateQuestion(root, item, (_state, _job, q) => { q.relay = { status: 'local_only' }; });
    return null;
  }
  const choices = Array.isArray(question.choices) && question.choices.length <= 9 &&
    question.choices.every(s => typeof s === 'string' && s.trim() && s.length <= 40) ? question.choices : undefined;
  const dedupeKey = 'career-ops-' + createHash('sha256').update(JSON.stringify([job.key, job.claim, question.text])).digest('hex').slice(0, 32);
  let dispatch = false;
  await updateQuestion(root, item, (_state, _job, q) => { q.relay = { status: 'dispatch_unknown' }; dispatch = true; });
  if (!dispatch) return null;
  try { return await client.ask({ text, choices, level: 'warn', timeoutSec: 86400, waitSec: 0, dedupeKey }); }
  catch (error) {
    // A definite rejection can be retried. A lost response might already have reached QQ.
    if (error.notSent || (error.httpStatus >= 400 && error.httpStatus < 500)) {
      await updateQuestion(root, item, (_s, _j, q) => { delete q.relay; });
    }
    throw error;
  }
}

// The relay serializes delivery. Its queued requests let it send the next
// question after a reply even when the local task has exited.
export async function syncRelay(root, { wait = 0, jobKey, client, pollIntervalMs = 15000, existingOnly = false } = {}) {
  if (!Number.isInteger(wait) || wait < 0 || wait > 60) throw Error('Relay wait must be an integer from 0 to 60 seconds');
  const forcePoll = wait > 0 || existingOnly;
  try {
    return await withPipelineLock(join(root, 'data/lean/relay-sync'), async () => {
      const snapshot = readState(root);
      const waiting = waitingQuestions(snapshot);
      const employerChecks = waitingQuestions(snapshot, true).filter(({job}) => !jobKey || job.key === jobKey).length;
      const items = waiting.filter(({job, question}) => (!jobKey || job.key === jobKey) && (!existingOnly || active(question.relay?.status)));
      const obsoleteQuestions = state => Object.values(state.jobs).filter(job => !jobKey || job.key === jobKey).flatMap(job => {
        const unresolved = (job.questions || []).filter(q => active(q.relay?.status) && !requiresEmployerEvidence(q) && !lookupAnswer(state, job, q.text));
        const first = unresolved.find(q => q.relay.status === 'sent') || unresolved[0];
        return (job.questions || []).filter(q => active(q.relay?.status)).flatMap(question => {
          const obsolete = job.user_skip || job.status !== 'waiting' || requiresEmployerEvidence(question) || lookupAnswer(state, job, question.text);
          // Keep just one open request per job. The relay may deliver its next
          // queued message before this on-demand process sees a stop reply.
          const defer = !obsolete && question !== first;
          return obsolete || defer ? [{ job, question, defer }] : [];
        });
      });
      const obsolete = obsoleteQuestions(snapshot);
      if (!items.length && !obsolete.length) return employerChecks ? { status: 'employer-verification', employer_checks: employerChecks } : { status: 'idle' };
      client ??= makeRelayClient(loadRelayConfig());
      if (!client) return { status: 'unconfigured', fallback: true };
      let retired = 0;
      const skipped = new Set();
      async function receive(item, response) {
        const result = await saveResponse(root, item, response);
        if (result?.skipped) skipped.add(result.skipped);
      }
      async function retireObsolete() {
        for (const item of obsoleteQuestions(readState(root))) {
          const { question } = item;
          let response;
          try { response = await client.cancel(question.relay.id); }
          catch (error) {
            if (error.httpStatus !== 404) throw error;
            response = { id: question.relay.id, status: 'unavailable' };
          }
          // A reply may have arrived just before cancellation. In particular,
          // never discard a stop instruction because another answer woke the job.
          await receive(item, { ...response, id: question.relay.id });
          if (item.defer && response.status === 'cancelled') {
            await updateQuestion(root, item, (_state, _job, q) => { q.previous_relay = q.relay; delete q.relay; });
          }
          if (response.status === 'cancelled') retired++;
        }
      }
      await retireObsolete();
      const counts = {}, add = status => { counts[status] = (counts[status] || 0) + 1; };
      for (const original of items) {
        // Refresh after each reply: a skip must stop the rest of this batch too.
        const current = readState(root);
        const item = waitingQuestions(current).find(({job, question}) => job.key === original.job.key &&
          (original.question.id ? question.id === original.question.id : question.text === original.question.text));
        if (!item) continue;
        const record = item.question.relay;
        if (existingOnly && !active(record?.status)) continue;
        const fact = reusableFactKey(item.job, item.question.text);
        const pendingFacts = activeFactKeys(waitingQuestions(current));
        if (!record && item.job.questions.some(q => active(q.relay?.status) || q.relay?.status === 'dispatch_unknown')) { add('covered_job'); continue; }
        if (!record && fact && pendingFacts.has(fact)) { add('covered'); continue; }
        if (record && (!active(record.status) || (!forcePoll && Date.now() - record.checked_at < pollIntervalMs))) {
          add(record.status); continue;
        }
        let response;
        try {
          if (record) { const seconds = wait; wait = 0; response = await client.poll(record.id, seconds); }
          else response = await dispatchQuestion(root, item, client);
        } catch (error) {
          if (!record || error.httpStatus !== 404) throw error;
          await updateQuestion(root, item, (_state, _job, question) => { question.relay.status = 'unavailable'; });
          add('unavailable'); continue;
        }
        if (response) {
          await receive(item, response);
          if (skipped.has(item.job.key)) await retireObsolete();
          add(response.status);
        }
        else add('local_only');
      }
      await retireObsolete();
      const allRemaining = waitingQuestions(readState(root));
      const stillCovered = activeFactKeys(allRemaining);
      const remaining = allRemaining.filter(({job}) => !jobKey || job.key === jobKey);
      const fallback = !existingOnly && remaining.some(({job,question}) => !active(question.relay?.status) && !stillCovered.has(reusableFactKey(job, question.text)) &&
        !(question.relay === undefined && job.questions.some(q => active(q.relay?.status))));
      return { status: counts.queued || counts.sent || counts.covered || counts.covered_job ? 'pending' : 'settled', counts, retired,
        skipped_jobs: [...skipped], employer_checks: employerChecks, fallback };
    }, { timeoutMs: 100, maxWaitMs: 100 });
  } catch (error) {
    if (error instanceof LockTimeoutError) return { status: 'busy' };
    return { status: 'unavailable', fallback: true, error: error.message };
  }
}
