#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadYaml } from './lib/yaml-document.mjs';
import { getProfilePath } from './path-resolver.mjs';
import { screenJob } from './lib/lean-screen.mjs';

const [input, profilePath = getProfilePath()] = process.argv.slice(2);
if (!input || input === '--help') {
  console.log('node lean-prescreen.mjs <job.json> [profile.yml]\nJSON: {title,company,country,text,metadata_only:false}; optional explicit constraints: see docs/LEAN_QUICKSTART.zh-CN.md');
  process.exit(input ? 0 : 1);
}
try {
  const job = JSON.parse(readFileSync(resolve(input), 'utf8'));
  const profile = loadYaml(readFileSync(profilePath, 'utf8'));
  console.log(JSON.stringify(screenJob(job, profile), null, 2));
} catch (e) { console.error(e.message); process.exitCode = 1; }
