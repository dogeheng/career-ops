import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { withPipelineLock, LockTimeoutError } from '../pipeline-lock.mjs';
import { readState, changeState, credentialQuestion, lookupAnswer, rememberAnswer, wakeAnsweredJob } from './lean-apply.mjs';
import { reusableFactKey } from './lean-question-keys.mjs';

const active = status => status === 'queued' || status === 'sent';
const statuses = new Set(['queued', 'sent', 'answered', 'timeout', 'cancelled', 'undeliverable']);
const requestId = /^r_[A-Za-z0-9_]+$/;

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
  async function request(path, options, expectedId) {
    const data = await call(path, options);
    if (!requestId.test(data.id) || !statuses.has(data.status) || (expectedId && data.id !== expectedId)) throw Error('Invalid dsh-omni request state');
    return data;
  }
  return {
    check: () => call('requests?status=sent'),
    ask: body => request('ask', { body }),
    poll: (id, wait) => {
      if (!requestId.test(id)) throw Error('Invalid dsh-omni request ID');
      return request(`requests/${id}?wait=${wait}`, { wait }, id);
    },
    cancel: id => {
      if (!requestId.test(id)) throw Error('Invalid dsh-omni request ID');
      return request(`requests/${id}/cancel`, { body: {} }, id);
    },
  };
}

function waitingQuestions(state) {
  return Object.values(state.jobs).filter(job => job.status === 'waiting').flatMap(job =>
    job.questions.filter(q => !credentialQuestion(q.text) && !q.relay?.reply && !lookupAnswer(state, job, q.text))
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
    if (!question || (!keepReceipt && (job.status !== 'waiting' || lookupAnswer(state, job, question.text)))) return;
    update(state, job, question);
  });
}
function saveResponse(root, item, response) {
  return updateQuestion(root, item, (state, job, question) => {
    question.relay = { id: response.id, status: response.status, checked_at: Date.now() };
    const answer = response.answer;
    if (job.status !== 'waiting' || lookupAnswer(state, job, question.text) || response.status !== 'answered' || !['quote', 'code'].includes(answer?.via)) return;
    const value = [answer.choice, answer.text].find(value => typeof value === 'string' && value.trim())?.trim();
    if (!value || /\brelay_[A-Za-z0-9_-]+\b/.test(value)) return;
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
  const text = `Career Ops · ${job.company} · ${job.title}\n${question.text}`;
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
export async function syncRelay(root, { wait = 0, jobKey, client, pollIntervalMs = 15000 } = {}) {
  if (!Number.isInteger(wait) || wait < 0 || wait > 60) throw Error('Relay wait must be an integer from 0 to 60 seconds');
  const forcePoll = wait > 0;
  try {
    return await withPipelineLock(join(root, 'data/lean/relay-sync'), async () => {
      const snapshot = readState(root);
      const waiting = waitingQuestions(snapshot);
      const items = waiting.filter(({job}) => !jobKey || job.key === jobKey);
      const obsolete = jobKey ? [] : Object.values(snapshot.jobs).flatMap(job => (job.questions || [])
        .filter(q => active(q.relay?.status) && (job.status !== 'waiting' || lookupAnswer(snapshot, job, q.text)))
        .map(question => ({ job, question })));
      if (!items.length && !obsolete.length) return { status: 'idle' };
      client ??= makeRelayClient(loadRelayConfig());
      if (!client) return { status: 'unconfigured', fallback: true };
      for (const { job, question } of obsolete) {
        let status;
        try { status = (await client.cancel(question.relay.id)).status; }
        catch (error) {
          if (error.httpStatus !== 404) throw error;
          status = 'unavailable';
        }
        await changeState(root, state => {
          const current = state.jobs[job.key]?.questions?.find(q => q.relay?.id === question.relay.id);
          if (current) current.relay.status = status;
        });
      }
      const counts = {}, add = status => { counts[status] = (counts[status] || 0) + 1; };
      const pendingFacts = activeFactKeys(waiting);
      for (const item of items) {
        const record = item.question.relay;
        const fact = reusableFactKey(item.job, item.question.text);
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
          await saveResponse(root, item, response);
          if (fact && active(response.status)) pendingFacts.add(fact);
          add(response.status);
        }
        else add('local_only');
      }
      const allRemaining = waitingQuestions(readState(root));
      const stillCovered = activeFactKeys(allRemaining);
      const remaining = allRemaining.filter(({job}) => !jobKey || job.key === jobKey);
      const fallback = remaining.some(({job,question}) => !active(question.relay?.status) && !stillCovered.has(reusableFactKey(job, question.text)));
      return { status: counts.queued || counts.sent || counts.covered ? 'pending' : 'settled', counts, fallback };
    }, { timeoutMs: 100, maxWaitMs: 100 });
  } catch (error) {
    if (error instanceof LockTimeoutError) return { status: 'busy' };
    return { status: 'unavailable', fallback: true, error: error.message };
  }
}
