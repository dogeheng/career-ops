#!/usr/bin/env node
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { getCareerOpsRoot, getProfilePath } from './path-resolver.mjs';
const code = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args[0] === '--install-skills' && args.length <= 2) {
  const parent = resolve(args[1] || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills'));
  for (const name of ['career-ops', 'career-ops-job-ingestion']) {
    const target = join(parent, name);
    if (existsSync(join(target, 'SKILL.md'))) {
      const binding = join(target, 'installation.json');
      if (!existsSync(binding) || JSON.parse(readFileSync(binding, 'utf8')).project_root !== code) {
        throw new Error(`An unrelated skill already exists at ${target}. Choose another skills directory or move that copy aside first.`);
      }
    }
  }
  for (const name of ['career-ops', 'career-ops-job-ingestion']) {
    const target = join(parent, name);
    cpSync(join(code, '.agents/skills', name), target, { recursive: true });
    writeFileSync(join(target, 'installation.json'), JSON.stringify({ project_root: code }, null, 2) + '\n');
  }
  console.log(JSON.stringify({ installed: parent, next: 'Skills are available on the next turn.' }));
} else if (args[0] === '--bind-skills' && args.length === 2) {
  for (const name of ['career-ops', 'career-ops-job-ingestion']) {
    const dir = resolve(args[1], name);
    if (!existsSync(join(dir, 'SKILL.md'))) throw new Error(`Install the skill first: ${dir}`);
    writeFileSync(join(dir, 'installation.json'), JSON.stringify({ project_root: code }, null, 2) + '\n');
  }
  console.log('Bound both installed skills to this checkout.');
} else if (args.length) { console.error('node lean-setup.mjs [--install-skills [directory] | --bind-skills <directory>]'); process.exitCode = 1; }
else {
  const root = getCareerOpsRoot();
  for (const dir of ['config', 'modes', 'data/lean', 'output', 'jds']) mkdirSync(join(root, dir), { recursive: true });
  const copied = [];
  for (const [src, dest] of [
    ['config/lean-profile.example.yml', getProfilePath()],
    ['modes/lean-custom.template.md', join(root, 'modes/_custom.md')],
  ]) if (!existsSync(dest)) { copyFileSync(join(code, src), dest); copied.push(dest); }
  const facts = join(root, 'config/cv-facts.json');
  if (!existsSync(facts)) { writeFileSync(facts, JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: [] }, null, 2) + '\n'); copied.push(facts); }
  console.log(JSON.stringify({ copied, next: 'Add confirmed profile facts and cv.md; null facts remain questions.' }, null, 2));
}
