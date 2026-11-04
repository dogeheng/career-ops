#!/usr/bin/env node
// One render, deterministic gates, no evaluator/model/report prerequisite.
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadYaml } from './lib/yaml-document.mjs';
import { getCareerOpsRoot, getProfilePath } from './path-resolver.mjs';
import { resolveTemplate } from './cv-templates.mjs';
import { writeFileAtomic } from './tracker-utils.mjs';
import { applyCvPatch } from './lib/lean-cv-patch.mjs';

const code = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const patchMode = args[0] === '--base' && args[2] === '--patch' && args.length === 5;
const [input, stem] = patchMode ? [args[1], args[4]] : args;
if (!input || !stem || input === '--help') {
  console.log('node lean-buildcv.mjs <payload.json> <output-stem>\nnode lean-buildcv.mjs --base <base.json> --patch <patch.json> <output-stem>\nOutputs .json/.html/.pdf under DATA_ROOT/output. No model calls or evaluation report.');
  process.exit(input === '--help' ? 0 : 1);
}
try {
  const root = getCareerOpsRoot();
  if (!existsSync(resolve(root, 'cv.md'))) throw new Error('Missing source facts: cv.md');
  const p = loadYaml(readFileSync(getProfilePath(), 'utf8')) || {};
  const out = resolve(root, stem), rel = relative(resolve(root, 'output'), out);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Output stem must be inside DATA_ROOT/output/');
  const base = JSON.parse(readFileSync(resolve(input), 'utf8'));
  const payload = patchMode ? applyCvPatch(base, JSON.parse(readFileSync(resolve(args[3]), 'utf8'))) : base;
  if (p.cv?.show_location === false && payload.candidate) delete payload.candidate.location;
  if (p.cv?.projects === 'omit') delete payload.projects;
  else if (Array.isArray(p.cv?.projects)) payload.projects = (payload.projects || []).filter(j => p.cv.projects.includes(j.name));
  mkdirSync(dirname(out), { recursive: true });
  writeFileAtomic(out + '.json', JSON.stringify(payload, null, 2) + '\n');
  const run = (script, args) => execFileSync(process.execPath, [resolve(code, script), ...args], { cwd: code, stdio: 'inherit' });
  run('build-cv-html.mjs', [out + '.json', out + '.html', resolveTemplate('cv', undefined, { strict: true })]);
  const titles = JSON.parse(execFileSync(process.execPath, [resolve(code, 'cv-title-check.mjs'), out + '.json'], { cwd: code, encoding: 'utf8' }));
  if (titles.unverified || titles.mismatches.length || titles.ambiguous.length || titles.unmatchedTailored.length) {
    throw new Error('Source title/employer/date check needs review: ' + JSON.stringify(titles));
  }
  const flags = [`--max-pages=${p.cv?.max_pages || 1}`];
  if (p.cv?.strict_pages !== false) flags.push('--strict-pages');
  run('generate-pdf.mjs', [out + '.html', out + '.pdf', '--format=letter', ...flags]);
  console.log(JSON.stringify({ status: 'ready', pdf: out + '.pdf', html: out + '.html', evaluated: false }));
} catch (e) { console.error(e.message); process.exitCode = 1; }
