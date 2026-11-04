import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localSchedule, nativeManifest, collectNewCandidates } from '../lib/lean-native.mjs';
import { runNative } from '../lean-native-run.mjs';

const job = key => ({ key, url: 'https://jobs.example/' + key, company: 'Example', title: 'New Grad Engineer', country: 'US', source_listed: true, state: 'queued', screen: { status: 'needs-review', questions: [] } });
test('NY and California schedules preserve the requested times in winter and summer', () => {
  for (const date of ['2026-01-05T12:00:00Z', '2026-07-05T12:00:00Z']) {
    assert.deepEqual(localSchedule('America/New_York', new Date(date)), [{ Hour: 10, Minute: 20 }, { Hour: 13, Minute: 30 }]);
    assert.deepEqual(localSchedule('America/Los_Angeles', new Date(date)), [{ Hour: 7, Minute: 20 }, { Hour: 10, Minute: 30 }]);
  }
});
test('native job has no resident process, polling, login run or model command', () => {
  const manifest = nativeManifest({ node: '/node', codeRoot: '/code', dataRoot: '/private-data', logDir: '/logs', zone: 'America/New_York' });
  assert.deepEqual(manifest.ProgramArguments, ['/node', '/code/lean-native-run.mjs']);
  assert.equal(manifest.KeepAlive, false); assert.equal(manifest.RunAtLoad, false);
  assert.equal(manifest.ProcessType, 'Background'); assert.equal(manifest.StartInterval, undefined);
  assert.equal(manifest.StartCalendarInterval.length, 2);
});
test('new-job notifications exclude old, blocked and already tracked positions', () => {
  const skipped = { ...job('blocked'), screen: { status: 'skip', questions: [] } };
  const tracked = { ...job('tracked'), state: 'tracked' };
  const state = collectNewCandidates({ seen_keys: ['old'], pending: [] }, [job('old'), job('new'), skipped, tracked]);
  assert.deepEqual(state.pending.map(j => j.key), ['new']);
  assert.equal(state.seen_keys.length, 4);
});
test('failed alerts survive the next ingestion and successful alerts are not repeated', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lean-native-'));
  const dir = join(root, 'data/lean'); mkdirSync(dir, { recursive: true });
  const path = join(dir, 'jobs.json'); writeFileSync(path, JSON.stringify([job('old')]));
  const ingestFn = async () => { writeFileSync(path, JSON.stringify([job('old'), job('new')])); return { imported: 2, new: 0 }; };
  try {
    await assert.rejects(() => runNative({ root, ingestFn, notifyFn: async () => { throw new Error('denied'); } }), /denied/);
    let state = JSON.parse(readFileSync(join(dir, 'native-state.json')));
    assert.deepEqual(state.pending.map(j => j.key), ['new']);
    let calls = 0;
    const notifyFn = async ({ pending }) => { calls++; assert.equal(pending.length, 1); };
    assert.equal((await runNative({ root, ingestFn, notifyFn })).notified, 1);
    assert.equal((await runNative({ root, ingestFn, notifyFn })).notified, 0);
    assert.equal(calls, 1);
    state = JSON.parse(readFileSync(join(dir, 'native-state.json'))); assert.deepEqual(state.pending, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('no new jobs means no notification call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lean-silent-'));
  const dir = join(root, 'data/lean'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'jobs.json'), JSON.stringify([job('old')]));
  try {
    const result = await runNative({ root, ingestFn: async () => ({ imported: 1, new: 0 }), notifyFn: async () => { throw new Error('must stay silent'); } });
    assert.equal(result.notified, 0); assert.equal(result.model_tokens, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
