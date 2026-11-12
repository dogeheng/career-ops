#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/is-main-module.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));

function checkoutRoot(directory) {
  const root = realpathSync(resolve(directory));
  if (!existsSync(join(root, 'lean-ingest.mjs')) || !existsSync(join(root, 'modes/continuous-schedule.prompt.md'))) {
    throw Error('Select the installed Career Ops checkout as the scheduled project.');
  }
  return root;
}

export function schedulePlan(directory = CODE_ROOT) {
  const root = checkoutRoot(directory);
  return {
    project_directory: root,
    project_label: 'career-ops',
    name: 'Career Ops 持续自动投递（不限数量）',
    execution_environment: 'local',
    model: 'gpt-6.1-sol',
    reasoning_effort: 'medium',
    timezone: 'America/New_York',
    daily_time: '13:40',
    prompt: readFileSync(join(root, 'modes/continuous-schedule.prompt.md'), 'utf8').trim(),
  };
}

export function checkScheduledProject(cwd = process.cwd(), directory = CODE_ROOT) {
  const expected = checkoutRoot(directory), actual = realpathSync(resolve(cwd));
  const equal = process.platform === 'win32' ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
  if (!equal) throw Error('The scheduled task must use the Career Ops checkout as its project and working directory.');
  return { valid: true };
}

if (isMainModule(import.meta.url)) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    if (rest.length || !['plan', 'check'].includes(command)) throw Error('node lean-schedule.mjs plan | check');
    console.log(JSON.stringify(command === 'plan' ? schedulePlan() : checkScheduledProject(), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
