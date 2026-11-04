#!/usr/bin/env node
// Planning estimate, not model billing. Host prompt/reasoning are explicitly separate.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCareerOpsRoot } from './path-resolver.mjs';
const root = getCareerOpsRoot(), code = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = { jobs: 0, runs: 2, host_tokens: 30000, calls_per_job: 6, calls_per_ingest: 0, jd_tokens: 2000 };
try {
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '').replaceAll('-', '_'), value = Number(args[i + 1]);
    if (!(key in opt) || !Number.isFinite(value) || value < 0) throw new Error('Use --jobs N --runs N --host-tokens N --calls-per-job N --calls-per-ingest N --jd-tokens N');
    opt[key] = value;
  }
  const estimatedTokens = (base, path) => existsSync(join(base, path)) ? Math.ceil([...readFileSync(join(base, path), 'utf8')].length / 4) : 0;
  const components = Object.fromEntries(['cv.md', 'config/profile.yml', 'modes/_custom.md'].map(f => [f, estimatedTokens(root, f)]));
  components['modes/lean.md'] = estimatedTokens(code, 'modes/lean.md');
  const jobPayload = Object.values(components).reduce((a, b) => a + b, 0) + opt.jd_tokens;
  const ingestionPayload = estimatedTokens(code, '.agents/skills/career-ops-job-ingestion/SKILL.md') + 600;
  const aiIngestionRuns = opt.calls_per_ingest > 0 ? opt.runs : 0;
  const input = opt.runs * opt.calls_per_ingest * (opt.host_tokens + ingestionPayload) + opt.jobs * opt.calls_per_job * (opt.host_tokens + jobPayload);
  console.log(JSON.stringify({ kind: 'estimate-not-billing', tokenizer: 'English-oriented chars/4 approximation', assumptions: opt,
    models: { ingestion: aiIngestionRuns ? 'Optional AI invocation; specify its model separately' : 'none / OS-scheduled local script', cv: 'gpt-6.1-sol / medium (trusted project default; UI/CLI may override)' },
    project_payload_tokens: components, per_job_payload_with_jd: jobPayload,
    daily: { cumulative_input_including_repeated_context: Math.ceil(input), input_sensitivity_25_percent: [Math.floor(input * .75), Math.ceil(input * 1.25)],
      visible_output: [aiIngestionRuns * 200 + opt.jobs * 500, aiIngestionRuns * 900 + opt.jobs * 2500],
      additional_reasoning_budget: [aiIngestionRuns * 100 + opt.jobs * 300, aiIngestionRuns * 700 + opt.jobs * 3000] },
    caveat: 'Host instructions/tool schemas/history, cache hits, retries and reasoning are not observable from project files. Replace host/call assumptions with actual run usage; token totals do not directly map to ChatGPT quota or API cost.' }, null, 2));
} catch (e) { console.error(e.message); process.exitCode = 1; }
