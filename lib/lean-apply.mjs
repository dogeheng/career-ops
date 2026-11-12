import { existsSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, relative, isAbsolute, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { withPipelineLock } from '../pipeline-lock.mjs';
import { writeFileAtomic } from '../tracker-utils.mjs';
import { resolveTrackerPath, getProfilePath } from '../path-resolver.mjs';
import { loadYaml } from './yaml-document.mjs';
import { screenJob } from './lean-screen.mjs';
import { resolveColumns, parseTrackerRow } from '../tracker-parse.mjs';
import { normalizeUrl } from '../url-key.mjs';
import { shortlist } from '../lean-ingest.mjs';
import { questionIdentity, reusableFactKey, reusableValue } from './lean-question-keys.mjs';
import { employerKey, employmentHistory, lookupFormDefault, lookupUSWorkAuthorization } from './lean-form-defaults.mjs';

export const readJson = (p, fallback) => existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback;
export const statePath = root => join(root, 'data/lean/application-state.json');
export const credentialQuestion = question => /password|passcode|验证码|密码|one.time.code|verification.?code|\bOTP\b|\b2FA\b|access.token|secret/i.test(question);
const empty = () => ({ version: 1, enabled: false, jobs: {}, answers: [] });
const trackerRows = Symbol('trackerRows');
const formHistory = Symbol('formHistory');
const userProfile = Symbol('userProfile');
function readTrackerRows(root) {
  const tracker = resolveTrackerPath(root);
  if (!existsSync(tracker)) return [];
  const lines = readFileSync(tracker, 'utf8').split('\n'), columns = resolveColumns(lines);
  return lines.map(line => parseTrackerRow(line, columns)).filter(Boolean);
}
export function readState(root) {
  const state = readJson(statePath(root), empty());
  let rows, history, profile;
  Object.defineProperty(state, trackerRows, { get: () => rows ??= readTrackerRows(root) });
  Object.defineProperty(state, userProfile, { get() {
    if (profile !== undefined) return profile;
    const file = getProfilePath(root);
    profile = existsSync(file) ? loadYaml(readFileSync(file, 'utf8')) || {} : {};
    return profile;
  } });
  Object.defineProperty(state, formHistory, { get() {
    if (history) return history;
    const applied = new Set(state[trackerRows].filter(row => /^(?:applied|interview|offer|accepted|rejected)$/i.test(row.status.trim())).map(row => employerKey(row.company)));
    for (const job of Object.values(state.jobs)) if (job.status === 'submitted') applied.add(employerKey(job.company));
    const cv = join(root, 'cv.md');
    history = { applied, ...employmentHistory(existsSync(cv) ? readFileSync(cv, 'utf8') : '') };
    return history;
  } });
  return state;
}
export async function changeState(root, fn) {
  const path = statePath(root); mkdirSync(join(root, 'data/lean'), { recursive: true });
  return withPipelineLock(path, async () => {
    const state = readState(root), result = await fn(state);
    writeFileAtomic(path, JSON.stringify(state, null, 2) + '\n'); chmodSync(path, 0o600);
    return result;
  });
}
function context(job) { return { key: normalizeUrl(job.key || job.url), company: job.company, country: job.country }; }
// Match approved equivalents within scope. A few job-independent QQ facts can
// be reused across jobs with their original confirmation preserved.
export function lookupAnswer(state, job, question, now = new Date().toISOString()) {
  const work = lookupUSWorkAuthorization(state[userProfile], job, question);
  if (work) return work;
  if (state.form_defaults) {
    const standard = lookupFormDefault(state.form_defaults, state[formHistory], job, question);
    if (standard) return standard;
  }
  const c = context(job);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(now) ? now : new Intl.DateTimeFormat('en-CA', {
    timeZone: state.timezone || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now));
  const priority = { job: 0, employer: 1, country: 2, global: 3 };
  const identity = questionIdentity(question);
  const matching = state.answers.filter(a => (!a.expires || a.expires >= date) && questionIdentity(a.question).key === identity.key);
  const direct = matching.slice().reverse().sort((a, b) => priority[a.scope] - priority[b.scope]).find(a =>
    ((a.scope === 'job' && a.target === c.key) || (a.scope === 'employer' && a.target === c.company) ||
     (a.scope === 'country' && a.target === c.country) || a.scope === 'global'));
  if (direct) return direct;

  const scope = identity.scope;
  const target = { global: '*', employer: c.company, country: c.country }[scope];
  if (!target) return null;
  const key = reusableFactKey(job, question);
  const earliest = identity.maxAgeDays ? Date.parse(date) - identity.maxAgeDays * 86400000 : null;
  const facts = matching.filter(a => a.scope === 'job' && (earliest === null || Date.parse(a.confirmed_at) >= earliest) &&
    reusableFactKey(state.jobs?.[a.target] || {}, a.question) === key && reusableValue(identity, a.value) !== null);
  const values = new Set(facts.map(a => reusableValue(identity, a.value)));
  const answer = facts.findLast(a => /^QQ relay (?:quote|code) \(r_[A-Za-z0-9_]+\)$/.test(a.source || ''));
  if (!answer || values.size !== 1) return null;
  return { ...answer, scope, target, original_job: answer.target };
}
export function rememberAnswer(state, { job, question, value, scope = 'job', expires = null, confirmed = false, source = 'user' }) {
  if (!confirmed) throw Error('Only an explicit user confirmation may enter the answer bank');
  if (!question?.trim() || typeof value !== 'string' || !value.trim()) throw Error('Question and answer required');
  if (credentialQuestion(question)) throw Error('Credentials and verification codes must never enter the answer bank');
  if (!['job', 'employer', 'country', 'global'].includes(scope)) throw Error('Invalid answer scope');
  if (expires && (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || !Number.isFinite(Date.parse(expires+'T00:00:00Z')) || new Date(expires+'T00:00:00Z').toISOString().slice(0,10)!==expires)) throw Error('Expiry must be a valid YYYY-MM-DD');
  if (/offer|deadline|截止/i.test(question) && !expires) throw Error('Time-sensitive offer answers require an expiry date');
  const c = context(job), target = { job: c.key, employer: c.company, country: c.country, global: '*' }[scope];
  if (!target) throw Error('Scope target is unknown');
  const answer = { id: randomUUID(), question, value, scope, target, expires, source, confirmed_at: new Date().toISOString() };
  state.answers.push(answer);
  // A confirmed answer wakes every blocked job whose exact question and scope match.
  for (const j of Object.values(state.jobs)) wakeAnsweredJob(state, j);
  return answer;
}
export function wakeAnsweredJob(state, job) {
  if (!job.user_skip && job.status === 'waiting' && job.questions.every(q => q.relay?.reply || lookupAnswer(state, job, q.text))) {
    job.status = 'ready'; job.updated_at = new Date().toISOString();
    return true;
  }
  return false;
}
export function skipJobByUser(state, job, { confirmed = false, source, request_id, answered_at = null } = {}) {
  if (!confirmed) throw Error('Explicit user confirmation required to stop a job');
  if (!job || state.jobs[job.key] !== job) throw Error('Unknown job');
  job.user_skip ??= { source, request_id, answered_at, confirmed_at: new Date().toISOString() };
  // Never erase an actual submission or claim that an in-flight click was undone.
  if (!['submitted', 'submitting', 'uncertain'].includes(job.status)) {
    job.status = 'skipped'; delete job.claim;
  }
  job.reason = 'User requested no further application or questions for this job';
  job.updated_at = new Date().toISOString();
  return job;
}
export async function claimNext(root) {
  return changeState(root, state => {
    if (!state.enabled) throw Error('Automatic applications are disabled; explicit user authorization required');
    for (const job of Object.values(state.jobs)) wakeAnsweredJob(state, job);
    const queue = readJson(join(root, 'data/lean/jobs.json'), []);
    const profile = state[userProfile];
    const tracked = new Set(state[trackerRows].filter(row => row.url).map(row => normalizeUrl(row.url)));
    const candidates = shortlist(queue).filter(j => !tracked.has(normalizeUrl(j.key || j.url)) && screenJob(j, profile).status !== 'skip')
      .sort((a, b) => Number(state.jobs[b.key]?.status === 'ready') - Number(state.jobs[a.key]?.status === 'ready') ||
        Number(b.country === 'US') - Number(a.country === 'US') || Number(b.sponsorship === 'yes') - Number(a.sponsorship === 'yes'));
    const job = candidates.find(j => !state.jobs[j.key]?.user_skip && (!state.jobs[j.key] || state.jobs[j.key].status === 'ready'));
    if (!job) return { job: null, waiting: Object.values(state.jobs).filter(j => j.status === 'waiting').length,
      unresolved_submissions: Object.values(state.jobs).filter(j => ['working', 'submitting', 'uncertain'].includes(j.status)).length };
    const key = normalizeUrl(job.key || job.url), old = state.jobs[key];
    const claimed = { ...old, ...context(job), url: job.url, title: job.title, status: 'working', claim: randomUUID(), updated_at: new Date().toISOString() };
    state.jobs[key] = claimed;
    return { job: claimed, answers: (old?.questions || []).map(q => lookupAnswer(state, claimed, q.text)).filter(Boolean),
      relay_replies: (old?.questions || []).filter(q => q.relay?.reply && !lookupAnswer(state, claimed, q.text))
        .map(q => ({ question: q.text, ...q.relay.reply })) };
  });
}
export async function setJob(root, key, claim, status, details = {}) {
  if (!['waiting', 'skipped', 'submitting', 'uncertain', 'submitted'].includes(status)) throw Error('Invalid job transition');
  if (Object.keys(details).some(k => !['questions', 'draft', 'reason', 'evidence'].includes(k))) throw Error('Unexpected job detail field');
  details = structuredClone(details);
  // Persist artifact references relative to the data root, never to this computer.
  for (const object of [details.draft, details.evidence]) if (object) {
    for (const field of ['resume', 'screenshot', 'jd', 'path']) if (object[field]) {
      const value = object[field]; if (typeof value !== 'string') throw Error('Invalid artifact path');
      if (process.platform !== 'win32' && value.includes('\\')) throw Error('Use portable forward-slash artifact paths');
      if (/^[A-Za-z]:[\\/]/.test(value) && process.platform !== 'win32') throw Error('Artifact belongs to a different computer');
      const local = relative(resolve(root), resolve(root, value));
      if (isAbsolute(local) || local === '..' || local.startsWith('..'+sep)) throw Error('Artifact must be inside the private data root');
      object[field] = local.split(sep).join('/');
    }
  }
  return changeState(root, state => {
    const job = state.jobs[normalizeUrl(key)];
    if (job?.user_skip && !['submitted', 'uncertain'].includes(status)) throw Error('User skipped this job; do not apply or ask more questions');
    if (status === 'submitting' && !state.enabled) throw Error('Automatic applications are disabled');
    if (!job || job.claim !== claim) throw Error('Job claim mismatch');
    if (!['working', 'submitting'].includes(job.status)) throw Error('Job no longer owned by this run');
    if (status === 'waiting' && job.status === 'submitting') throw Error('An attempted submission must be resolved as submitted or uncertain');
    if (status === 'waiting') {
      if (!Array.isArray(details.questions) || !details.questions.length || details.questions.some(q => typeof q?.text !== 'string' || !q.text.trim())) throw Error('Record the exact unanswered questions');
      const unique = new Map(details.questions.map(q => [q.text, { id: randomUUID(), text: q.text, context: q.context, choices: q.choices, audience: q.audience === 'employer' ? 'employer' : undefined }]));
      details.questions = [...unique.values()];
    }
    if (status === 'submitted') {
      const e = details.evidence;
      if (job.status !== 'submitting' || !['confirmation_page','confirmation_email','application_portal'].includes(e?.kind) || !e?.text?.trim() || !/^https?:\/\//.test(e.confirmation_url || '') || normalizeUrl(e.job_url) !== job.key) throw Error('Employer confirmation matching the job is required after submit intent');
    }
    if (status === 'submitting' && job.status !== 'working') throw Error('Submission already attempted; never retry blindly');
    Object.assign(job, details, { status, updated_at: new Date().toISOString() });
    if (status === 'waiting') wakeAnsweredJob(state, job);
    return job;
  });
}
export async function retryJob(root, key, confirmedNotSubmitted, resumeUserSkipped = false) {
  if (!confirmedNotSubmitted) throw Error('Confirm that no submission occurred before retry');
  return changeState(root, state => {
    const j = state.jobs[normalizeUrl(key)]; if (!j || j.status === 'submitted') throw Error('Cannot retry this job');
    if (j.user_skip && !resumeUserSkipped) throw Error('User skipped this job; explicit --resume-user-skipped is required');
    if (j.user_skip) { j.previous_user_skip = j.user_skip; delete j.user_skip; }
    j.status = 'ready'; delete j.claim; j.updated_at = new Date().toISOString(); return j;
  });
}
