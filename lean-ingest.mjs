#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadYaml } from './lib/yaml-document.mjs';
import { getCareerOpsRoot, getProfilePath, resolveTrackerPath } from './path-resolver.mjs';
import { writeFileAtomic } from './tracker-utils.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { normalizeUrl } from './url-key.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import { screenJob } from './lib/lean-screen.mjs';
import { JOB_SOURCES, parseSource, deduplicateJobs } from './lib/lean-sources.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
function git(args) { return execFileSync('git', args, { cwd: CODE_ROOT, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

export function refreshSources() {
  for (const s of JOB_SOURCES) {
    const sub = `data/job-sources/${s.id}`;
    if (!existsSync(join(CODE_ROOT, sub, '.git'))) git(['submodule', 'update', '--init', '--depth', '1', '--', sub]);
    // Never execute source scripts, overwrite local edits, or trust a changed origin.
    if (git(['-C', sub, 'remote', 'get-url', 'origin']) !== s.repo) throw new Error(`Unexpected source origin: ${s.id}`);
    if (git(['-C', sub, 'status', '--porcelain'])) throw new Error(`Source has local changes: ${s.id}`);
    git(['-C', sub, 'fetch', '--depth', '1', 'origin', s.branch]);
    git(['-C', sub, 'checkout', '--detach', 'FETCH_HEAD']);
  }
}
export function readSourceJobs() {
  return deduplicateJobs(JOB_SOURCES.flatMap(s => s.files.flatMap(file => {
    const path = join(CODE_ROOT, 'data/job-sources', s.id, file);
    if (!existsSync(path)) throw new Error(`Missing source file: ${s.id}/${file}`);
    const jobs = parseSource(readFileSync(path, 'utf8'), s, file);
    if (!jobs.length) throw new Error(`Source format changed or empty: ${s.id}/${file}; existing queue preserved`);
    return jobs;
  })));
}
export function mergeQueue(jobs, previous, profile, tracked = new Set(), now = new Date().toISOString()) {
  const old = new Map(previous.map(j => [j.key, j]));
  const listed = new Set(jobs.map(j => j.key));
  const current = jobs.map(job => {
    const prior = old.get(job.key);
    return { ...prior, ...job, first_seen: prior?.first_seen || now, last_seen: now, source_listed: true,
      state: tracked.has(job.key) ? 'tracked' : prior?.state || 'queued', screen: screenJob(job, profile) };
  });
  return current.concat(previous.filter(j => !listed.has(j.key)).map(j => ({ ...j, source_listed: false })));
}
const cell = s => String(s ?? '').replace(/[|\r\n]/g, ' ').replace(/[<>]/g, '');
export function shortlist(queue) {
  return queue.filter(j => j.source_listed && j.state === 'queued' && j.screen.status !== 'skip')
    .sort((a, b) => Number(b.country === 'US') - Number(a.country === 'US') || (a.age_days ?? 9999) - (b.age_days ?? 9999));
}
export async function ingest({ refresh = false, root = getCareerOpsRoot(), profilePath = getProfilePath() } = {}) {
  if (refresh) refreshSources();
  const profile = existsSync(profilePath) ? loadYaml(readFileSync(profilePath, 'utf8')) || {} : {};
  const jobs = readSourceJobs();
  const dir = join(root, 'data', 'lean'); mkdirSync(dir, { recursive: true });
  const path = join(dir, 'jobs.json');
  return withPipelineLock(path, async () => {
    const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
    const known = new Set(previous.map(j => j.key));
    const tracker = resolveTrackerPath(root), tracked = new Set();
    if (existsSync(tracker)) {
      const lines = readFileSync(tracker, 'utf8').split('\n');
      const columns = resolveColumns(lines);
      for (const line of lines) { const row = parseTrackerRow(line, columns); if (row?.url) tracked.add(normalizeUrl(row.url)); }
    }
    const queue = mergeQueue(jobs, previous, profile, tracked);
    writeFileAtomic(path, JSON.stringify(queue, null, 2) + '\n');
    const ready = shortlist(queue);
    const lines = ['# New grad shortlist', '', 'Repository metadata only. Employer JD, work authorization and sponsorship still need confirmation.', '', '| Company | Role | Country | Review | URL |', '|---|---|---|---|---|'];
    for (const j of ready) lines.push(`| ${cell(j.company)} | ${cell(j.title)} | ${cell(j.country || '?')} | ${cell(j.screen.questions.map(q => q.code).join(', '))} | [Apply](${j.url.replace(/[()<>\s]/g, c => encodeURIComponent(c))}) |`);
    writeFileAtomic(join(dir, 'shortlist.md'), lines.join('\n') + '\n');
    const result = { imported: jobs.length, new: jobs.filter(j => !known.has(j.key)).length,
      skipped: queue.filter(j => j.source_listed && j.screen.status === 'skip').length,
      needs_review: ready.length, already_tracked: queue.filter(j => j.source_listed && j.state === 'tracked').length,
      shortlist: join(dir, 'shortlist.md'), queue: path,
      top_new: ready.filter(j => !known.has(j.key)).slice(0, 10).map(j => ({ company: j.company, title: j.title, country: j.country, url: j.url, review: j.screen.questions.map(q => q.code) })),
      source_revisions: Object.fromEntries(JOB_SOURCES.map(s => [s.id, git(['-C', `data/job-sources/${s.id}`, 'rev-parse', 'HEAD'])])) };
    writeFileAtomic(join(dir, 'last-run.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
  });
}
if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) console.log('node lean-ingest.mjs [--refresh]\nRefresh only the two public submodules; screen and deduplicate locally. No LLM, CV, browser or application submission.');
  else if (args.some(a => a !== '--refresh')) { console.error('Unknown argument'); process.exitCode = 1; }
  else try { console.log(JSON.stringify(await ingest({ refresh: args.includes('--refresh') }), null, 2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
