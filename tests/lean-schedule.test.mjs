import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schedulePlan, checkScheduledProject } from '../lean-schedule.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'career-schedule-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function checkout(parent, name) {
  const root = join(parent, name);
  mkdirSync(join(root, 'modes'), { recursive: true });
  writeFileSync(join(root, 'lean-ingest.mjs'), '// fixture');
  writeFileSync(join(root, 'modes/continuous-schedule.prompt.md'), 'Use this project and its confirmed local facts.');
  return root;
}

test('schedule plans bind to each computer checkout without reading private settings', t => {
  const parent = fixture(t), old = checkout(parent, 'old computer'), current = checkout(parent, 'new computer');
  writeFileSync(join(current, '.env'), 'PRIVATE_API_KEY=fixture-secret');
  writeFileSync(join(current, 'cv.md'), 'PRIVATE-CANDIDATE-DATA');
  const a = schedulePlan(old), b = schedulePlan(current);
  assert.equal(b.project_directory, realpathSync(current));
  assert.notEqual(a.project_directory, b.project_directory);
  assert.equal(a.prompt, b.prompt);
  assert.equal(b.model, 'gpt-6.1-sol');
  assert.equal(b.timezone, 'America/New_York');
  assert.ok(!JSON.stringify(b).includes(realpathSync(old)));
  assert.ok(!JSON.stringify(b).includes('fixture-secret'));
  assert.ok(!JSON.stringify(b).includes('PRIVATE-CANDIDATE-DATA'));
  assert.equal('project_id' in b, false);
});

test('scheduled project check rejects an ancestor directory and accepts the selected checkout', t => {
  const parent = fixture(t), root = checkout(parent, 'career-ops');
  assert.deepEqual(checkScheduledProject(root, root), { valid: true });
  assert.throws(() => checkScheduledProject(parent, root), /working directory/);
  assert.throws(() => schedulePlan(parent), /checkout/);
});

test('symlinked checkouts refer to the same scheduled project', { skip: process.platform === 'win32' }, t => {
  const parent = fixture(t), root = checkout(parent, 'career-ops'), alias = join(parent, 'project alias');
  symlinkSync(root, alias, 'dir');
  assert.deepEqual(checkScheduledProject(alias, root), { valid: true });
});
