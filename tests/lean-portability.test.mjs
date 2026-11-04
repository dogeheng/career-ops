import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { makeBackup, restoreBackup, allowedBackupPath } from '../lean-backup.mjs';
import { applyCvPatch } from '../lib/lean-cv-patch.mjs';

test('backup restores facts, queue and PDFs but never credentials or Chromium sessions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lean-migrate-'));
  const src = join(dir, 'old computer'), dst = join(dir, 'new computer');
  try {
    for (const d of ['config', 'data/lean/chromium', 'output']) mkdirSync(join(src, d), { recursive: true });
    writeFileSync(join(src, 'cv.md'), '# Candidate facts');
    writeFileSync(join(src, 'config/profile.yml'), 'candidate: {full_name: Example}');
    writeFileSync(join(src, '.env'), 'SECRET=never-copy');
    writeFileSync(join(src, 'data/lean/chromium/Cookies'), 'never-copy');
    writeFileSync(join(src, 'data/lean/jobs.json'), '[{"state":"submitted"}]');
    writeFileSync(join(src, 'data/lean/last-run.json'), JSON.stringify({ shortlist: '/old/shortlist.md', queue: '/old/jobs.json' }));
    writeFileSync(join(src, 'output/cv.pdf'), '%PDF-test');
    const bundle = makeBackup(src); restoreBackup(bundle, dst);
    assert.equal(readFileSync(join(dst, 'cv.md'), 'utf8'), '# Candidate facts');
    assert.equal(readFileSync(join(dst, 'output/cv.pdf'), 'utf8'), '%PDF-test');
    assert.equal(JSON.parse(readFileSync(join(dst, 'data/lean/jobs.json')))[0].state, 'submitted');
    assert.equal(JSON.parse(readFileSync(join(dst, 'data/lean/last-run.json'))).queue, join(dst, 'data/lean/jobs.json'));
    assert.ok(!existsSync(join(dst, '.env'))); assert.ok(!existsSync(join(dst, 'data/lean/chromium')));
    assert.throws(() => restoreBackup(bundle, dst), /Already exists/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('invalid bundles fail validation before any private file is replaced', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lean-invalid-'));
  try {
    writeFileSync(join(dir, 'cv.md'), 'keep');
    for (const name of ['../cv.md', '/tmp/cv.md', 'data/lean/chromium/Cookies', '.env', 'output/../../.env']) assert.equal(allowedBackupPath(name), false);
    assert.throws(() => restoreBackup({ format: 'career-ops-lean-backup/v1', files: { 'cv.md': { base64: 'b29wcw==', sha256: 'bad' } } }, dir, true), /Checksum/);
    assert.equal(readFileSync(join(dir, 'cv.md'), 'utf8'), 'keep');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('skill installation binds to this checkout without touching another installation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lean-skills-'));
  try {
    execFileSync(process.execPath, ['lean-setup.mjs', '--install-skills', dir]);
    const binding = JSON.parse(readFileSync(join(dir, 'career-ops/installation.json'), 'utf8'));
    assert.equal(binding.project_root, resolve('.'));
    execFileSync(process.execPath, ['lean-setup.mjs', '--install-skills', dir]);
    writeFileSync(join(dir, 'career-ops/installation.json'), '{"project_root":"/other-computer"}');
    const result = spawnSync(process.execPath, ['lean-setup.mjs', '--install-skills', dir]);
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(readFileSync(join(dir, 'career-ops/installation.json'))).project_root, '/other-computer');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('CV patches reuse unchanged facts, replace arrays and do not mutate the approved base', () => {
  const base = { candidate: { name: 'Example', location: 'Actual City' }, projects: [{ name: 'One' }], experience: [{ role: 'Intern' }] };
  const merged = applyCvPatch(base, { candidate: { location: null }, projects: [] });
  assert.equal(merged.candidate.name, 'Example'); assert.equal(merged.candidate.location, undefined);
  assert.deepEqual(merged.experience, base.experience); assert.deepEqual(merged.projects, []);
  assert.equal(base.candidate.location, 'Actual City');
  assert.throws(() => applyCvPatch(base, JSON.parse('{"__proto__":{}}')), /Unsafe/);
});
