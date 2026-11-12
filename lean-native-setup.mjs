#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { nativeManifest, nativeRuntimeDir, NATIVE_LABEL } from './lib/lean-native.mjs';

const code = dirname(fileURLToPath(import.meta.url)), root = getCareerOpsRoot();
const dir = join(code, 'local/native'), configPath = join(code, 'local/native-install.json');
const plist = join(homedir(), 'Library/LaunchAgents', NATIVE_LABEL + '.plist');
const domain = `gui/${process.getuid?.()}`;
const run = (name, args, opts = {}) => execFileSync(name, args, { encoding: 'utf8', ...opts });
function writePlist(path, object) { run('/usr/bin/plutil', ['-convert', 'xml1', '-o', path, '-'], { input: JSON.stringify(object) }); }
function notifierCommand(app, action) {
  const runtime = nativeRuntimeDir(root); mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const result = join(runtime, 'notifier-result.json'); rmSync(result, { force: true });
  run('/usr/bin/open', ['-n', '-W', app, '--args', action, '--result', result], { timeout: 45_000 });
  return existsSync(result) ? JSON.parse(readFileSync(result, 'utf8')) : { authorized: false, error: 'No response from notification helper' };
}

try {
  if (process.platform !== 'darwin') throw new Error('Native installer supports macOS. Other systems can run lean-native-run.mjs with their own OS scheduler.');
  const command = process.argv[2] || 'status';
  if (command === 'install') {
    mkdirSync(dir, { recursive: true }); mkdirSync(dirname(plist), { recursive: true });
    const app = join(dir, 'CareerOps Notifier.app'), contents = join(app, 'Contents');
    mkdirSync(join(contents, 'MacOS'), { recursive: true });
    const binary = join(contents, 'MacOS/CareerOpsNotifier');
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    run('/usr/bin/xcrun', ['swiftc', '-O', '-swift-version', '5', '-target', `${architecture}-apple-macosx13.0`, '-module-cache-path', join(dir, 'swift-cache'), join(code, 'scripts/lean-notifier.swift'), '-o', binary, '-framework', 'AppKit', '-framework', 'UserNotifications', '-framework', 'WebKit'], { timeout: 120_000 });
    writePlist(join(contents, 'Info.plist'), { CFBundleIdentifier: 'io.careerops.local.notifier', CFBundleExecutable: 'CareerOpsNotifier', CFBundleName: 'CareerOps Notifier', CFBundleDisplayName: 'CareerOps Notifier', CFBundleVersion: '1', CFBundleShortVersionString: '1.0', CFBundlePackageType: 'APPL', LSUIElement: true, NSPrincipalClass: 'NSApplication' });
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const logDir = join(homedir(), 'Library/Logs/CareerOps');
    mkdirSync(logDir, { recursive: true });
    const manifest = nativeManifest({ node: process.execPath, codeRoot: code, dataRoot: root, logDir, zone, workingDirectory: homedir() });
    writePlist(plist, manifest);
    const config = { node: process.execPath, code_root: code, data_root: root, log_dir: logDir, system_zone_at_install: zone, requested_zone: 'America/New_York', calendar: manifest.StartCalendarInterval, notifier_app: app, plist };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    spawnSync('/bin/launchctl', ['bootout', domain + '/' + NATIVE_LABEL], { encoding: 'utf8' });
    run('/bin/launchctl', ['bootstrap', domain, plist]);
    let authorization = notifierCommand(app, '--authorize');
    if (!authorization.authorized) {
      const current = notifierCommand(app, '--status');
      if (current.authorized) authorization = current;
    }
    console.log(JSON.stringify({ installed: true, ...config, notification_permission: authorization, model_tokens: 0 }, null, 2));
  } else if (command === 'status') {
    const job = spawnSync('/bin/launchctl', ['print', domain + '/' + NATIVE_LABEL], { encoding: 'utf8' });
    const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
    const last = join(root, 'data/lean/native-last-run.json');
    const authorization = config.notifier_app && existsSync(config.notifier_app) ? notifierCommand(config.notifier_app, '--status') : null;
    console.log(JSON.stringify({ loaded: job.status === 0, state: job.stdout?.match(/\bstate = ([^\n]+)/)?.[1], config, notification_permission: authorization, last_run: existsSync(last) ? JSON.parse(readFileSync(last, 'utf8')) : null }, null, 2));
  } else if (command === 'uninstall') {
    spawnSync('/bin/launchctl', ['bootout', domain + '/' + NATIVE_LABEL]); rmSync(plist, { force: true });
    console.log('Native schedule removed. Candidate data and generated CVs are retained.');
  } else throw new Error('node lean-native-setup.mjs install|status|uninstall');
} catch (e) { console.error(e.message); process.exitCode = 1; }
