#!/usr/bin/env node
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCareerOpsRoot, getProfilePath } from './path-resolver.mjs';
const code = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args[0] === '--bind-skills' && args.length === 2) {
  for (const name of ['career-ops', 'career-ops-job-ingestion']) {
    const dir = resolve(args[1], name);
    if (!existsSync(join(dir, 'SKILL.md'))) throw new Error(`Install the skill first: ${dir}`);
    writeFileSync(join(dir, 'installation.json'), JSON.stringify({ project_root: code }, null, 2) + '\n');
  }
  console.log('Bound both installed skills to this checkout.');
} else if (args.length) { console.error('node lean-setup.mjs [--bind-skills <installed-skills-directory>]'); process.exitCode = 1; }
else {
  const root = getCareerOpsRoot();
  for (const dir of ['config', 'modes', 'data/lean', 'output', 'jds']) mkdirSync(join(root, dir), { recursive: true });
  const copied = [];
  for (const [src, dest] of [
    ['config/lean-profile.example.yml', getProfilePath()],
    ['modes/lean-custom.template.md', join(root, 'modes/_custom.md')],
  ]) if (!existsSync(dest)) { copyFileSync(join(code, src), dest); copied.push(dest); }
  console.log(JSON.stringify({ copied, next: 'Add confirmed profile facts and cv.md; null facts remain questions.' }, null, 2));
}
