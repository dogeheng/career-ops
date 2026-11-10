#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { changeState, readState, claimNext, setJob, rememberAnswer, lookupAnswer, retryJob, wakeAnsweredJob } from './lib/lean-apply.mjs';
import { formDefaultKeys } from './lib/lean-form-defaults.mjs';
import { openReview } from './lean-review.mjs';
import { loadRelayConfig, makeRelayClient, syncRelay } from './lib/lean-relay.mjs';

async function deliverQuestions(root, options, showIdle = false) {
  const relay = await syncRelay(root, options);
  if (relay.fallback || (showIdle && relay.status === 'idle')) {
    try { await openReview(root); } catch (error) { return { ...relay, popup_error: error.message }; }
  }
  return relay;
}

export async function command(args, root = getCareerOpsRoot()) {
  const [action, ...rest] = args, flags = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) throw Error('Expected --flag value');
    const key = rest[i].slice(2); flags[key] = rest[i + 1]?.startsWith('--') || i + 1 === rest.length ? true : rest[++i];
  }
  const payload = () => JSON.parse(readFileSync(flags.file, 'utf8'));
  if (action === 'enable') {
    if (flags['confirmed-by-user'] !== true) throw Error('Explicit user authorization required');
    return changeState(root, s => { s.enabled = true; s.authorization = { source: flags.source || 'explicit user instruction', confirmed_at: new Date().toISOString(), quantity_limit: null }; return { enabled: true, quantity_limit: null }; });
  }
  if (action === 'disable') return changeState(root, s => { s.enabled = false; return { enabled: false }; });
  if (action === 'status') {
    const s = readState(root), counts = {};
    for (const j of Object.values(s.jobs)) counts[j.status] = (counts[j.status] || 0) + 1;
    return { enabled: s.enabled, quantity_limit: null, counts, remembered_answers: s.answers.length };
  }
  if (action === 'next') return claimNext(root);
  if (action === 'defaults') {
    if (flags['confirmed-by-user'] !== true) throw Error('Explicit user confirmation required');
    const updates = Object.entries(payload());
    if (!updates.length || updates.some(([key, value]) => !formDefaultKeys.has(key) || typeof value !== 'boolean')) throw Error('Expected supported boolean form defaults');
    return changeState(root, state => {
      state.form_defaults = { ...state.form_defaults, ...Object.fromEntries(updates), confirmed_at: new Date().toISOString() };
      const ready = Object.values(state.jobs).filter(job => wakeAnsweredJob(state, job)).length;
      return { saved_defaults: updates.map(([key]) => key), ready_jobs: ready };
    });
  }
  if (action === 'relay-status') {
    const client = makeRelayClient(loadRelayConfig());
    if (!client) return { configured: false };
    await client.check(); return { configured: true, authenticated: true };
  }
  if (action === 'relay-sync') {
    const options = { wait: Number(flags.wait ?? 0), existingOnly: flags['existing-only'] === true };
    return options.existingOnly ? syncRelay(root, options) : deliverQuestions(root, options);
  }
  if (action === 'lookup') {
    const s = readState(root), job = s.jobs[flags.job]; if (!job) throw Error('Claim job first');
    return { answer: lookupAnswer(s, job, flags.question) };
  }
  if (action === 'answer') {
    const p = payload();
    return changeState(root, s => {
      const job = s.jobs[p.job] || p.context;
      if (!job) throw Error('A job or explicit context is required');
      return rememberAnswer(s, { ...p, job, confirmed: flags['confirmed-by-user'] === true });
    });
  }
  if (action === 'block') {
    const p = payload();
    const job = await setJob(root, flags.job, flags.claim, 'waiting', { questions: p.questions, draft: p.draft || null });
    if (job.status === 'ready') return { job: job.key, relay: { status: 'reused' }, next: 'Confirmed answers available; reclaim the job' };
    const relay = await deliverQuestions(root, { jobKey: job.key }, true);
    return { job: job.key, relay, next: 'Question saved; continue with next job' };
  }
  if (action === 'submit-intent') return setJob(root, flags.job, flags.claim, 'submitting');
  if (action === 'result') return setJob(root, flags.job, flags.claim, flags.status, flags.file ? payload() : {});
  if (action === 'retry') return retryJob(root, flags.job, flags['confirmed-not-submitted'] === true);
  throw Error('node lean-apply.mjs enable --confirmed-by-user | disable | status | next | defaults --file FILE --confirmed-by-user | relay-status | relay-sync [--wait SECONDS] [--existing-only] | lookup --job URL --question TEXT | block --job URL --claim TOKEN --file questions.json | answer --file answer.json --confirmed-by-user | submit-intent --job URL --claim TOKEN | result --job URL --claim TOKEN --status submitted|uncertain|skipped --file evidence.json | retry --job URL --confirmed-not-submitted');
}
if (isMainModule(import.meta.url)) {
  try { console.log(JSON.stringify(await command(process.argv.slice(2)), null, 2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
