#!/usr/bin/env node
// OS-scheduled importer. No model client, browser, timers or polling loop.
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import { writeFileAtomic } from './tracker-utils.mjs';
import { ingest } from './lean-ingest.mjs';
import { collectNewCandidates } from './lib/lean-native.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
const readJson = (path, fallback) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;

export async function notifyMac({ pending, root }) {
  const config = readJson(join(CODE_ROOT, 'local/native-install.json'), null);
  if (!config?.notifier_app) throw new Error('Native notifier is not installed; run node lean-native-setup.mjs install');
  const dir = join(root, 'data/lean');
  const payload = join(dir, 'native-notification.json'), result = join(dir, 'native-notification-result.json');
  const id = createHash('sha256').update(pending.map(j => j.key).sort().join('\n')).digest('hex').slice(0, 24);
  writeFileAtomic(payload, JSON.stringify({ count: pending.length, id, path: join(dir, 'shortlist.md') }));
  rmSync(result, { force: true });
  execFileSync('/usr/bin/open', ['-g', '-n', '-W', config.notifier_app, '--args', '--notify', payload, '--result', result], { timeout: 30_000 });
  const response = readJson(result, {});
  if (!response.accepted) throw new Error(response.error || 'Notification permission is missing; new jobs remain pending');
  return response;
}

export async function runNative({ root = getCareerOpsRoot(), ingestFn = () => ingest({ refresh: true }), notifyFn = notifyMac } = {}) {
  const dir = join(root, 'data/lean'); mkdirSync(dir, { recursive: true });
  const path = join(dir, 'native-state.json');
  return withPipelineLock(path, async () => {
    const before = readJson(join(dir, 'jobs.json'), []);
    const previous = readJson(path, { seen_keys: before.map(j => j.key), pending: [] });
    const start = Date.now(), cpu = process.cpuUsage();
    const imported = await ingestFn();
    let state = collectNewCandidates(previous, readJson(join(dir, 'jobs.json'), []));
    // Save pending jobs before attempting notification, so a denied/failed alert is retryable.
    writeFileAtomic(path, JSON.stringify(state, null, 2) + '\n');
    let notified = 0;
    if (state.pending.length) {
      await notifyFn({ pending: state.pending, root });
      notified = state.pending.length;
      state = { ...state, pending: [], last_notification_at: new Date().toISOString() };
      writeFileAtomic(path, JSON.stringify(state, null, 2) + '\n');
    }
    const usage = process.cpuUsage(cpu);
    const result = { success: true, imported: imported.imported, new: imported.new, notified,
      duration_ms: Date.now() - start, node_cpu_ms: (usage.user + usage.system) / 1000,
      model_tokens: 0, shortlist: join(dir, 'shortlist.md'), time: new Date().toISOString() };
    writeFileAtomic(join(dir, 'native-last-run.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
  });
}

if (isMainModule(import.meta.url)) {
  try { console.log(JSON.stringify(await runNative())); }
  catch (e) {
    const path = join(getCareerOpsRoot(), 'data/lean/native-last-run.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileAtomic(path, JSON.stringify({ success: false, error: e.message, time: new Date().toISOString(), model_tokens: 0 }, null, 2));
    console.error(e.message); process.exitCode = 1;
  }
}
