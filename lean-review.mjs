#!/usr/bin/env node
import http from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, watch, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { readJson, readState, changeState, rememberAnswer, retryJob } from './lib/lean-apply.mjs';

const code = dirname(fileURLToPath(import.meta.url));
const runtimePath = root => join(root, 'data/lean/review-runtime.json');
export function launchWindow(url, platform = process.platform, launch = spawn, resultPath = null) {
  const app = join(code, 'local/native/CareerOps Notifier.app');
  const native = platform === 'darwin' && existsSync(app);
  const [exe, args] = native ? ['/usr/bin/open', ['-W', '-n', app, '--args', '--review', url, ...(resultPath ? ['--result', resultPath] : [])]] :
    platform === 'darwin' ? ['/usr/bin/open', [url]] : platform === 'win32' ? ['cmd.exe', ['/d', '/c', 'start', '', url]] : ['xdg-open', [url]];
  return { child: launch(exe, args, { stdio: 'ignore' }), native };
}
export async function startReviewServer(root = getCareerOpsRoot(), { launch = url => launchWindow(url, process.platform, spawn, join(root, 'data/lean/review-window-runtime.json')) } = {}) {
  const token = randomBytes(32).toString('hex'), peers = new Set(); let opened = false;
  mkdirSync(join(root, 'data/lean'), { recursive: true });
  let origin;
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      if (req.headers.host !== new URL(origin).host) return send(403, { error: 'Invalid host' });
      const url = new URL(req.url, origin);
      res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'");
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { service: 'career-ops-review' });
      if (req.method === 'POST' && url.pathname === '/internal/open' && req.headers.authorization === `Bearer ${token}`) {
        if (!opened) {
          const { child, native } = launch(`${origin}/launch/${token}`); opened = true;
          child.once('error', () => { opened = false; }); if (native) child.once('exit', () => { opened = false; }); child.unref();
        }
        return send(200, { opened: true });
      }
      if (req.method === 'GET' && url.pathname === `/launch/${token}`) {
        res.writeHead(303, { Location: '/', 'Set-Cookie': `career_review=${token}; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store' }); return res.end();
      }
      if (!req.headers.cookie?.split(';').some(c => c.trim() === `career_review=${token}`)) return send(403, { error: 'Open with node lean-review.mjs --open' });
      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' }); res.write('data: changed\n\n'); peers.add(res); req.on('close', () => peers.delete(res)); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const s = readState(root); return send(200, { enabled: s.enabled, answers: s.answers,
          jobs: Object.values(s.jobs).filter(j => ['waiting', 'working', 'submitting', 'uncertain', 'ready'].includes(j.status)).map(({ claim, ...j }) => j) });
      }
      if (req.method === 'GET' && ['/', '/review.js'].includes(url.pathname)) {
        res.writeHead(200, { 'Content-Type': url.pathname === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(readFileSync(join(code, 'ui', url.pathname === '/' ? 'lean-review.html' : 'lean-review.js')));
      }
      if (req.method !== 'POST' || req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) return send(403, { error: 'Same-origin JSON required' });
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 32768) return send(413, { error: 'Answer too large' }); }
      const p = JSON.parse(body);
      if (url.pathname === '/api/answer') {
        const answer = await changeState(root, s => {
          const job = s.jobs[p.job], question = job?.questions?.find(q => q.text === p.question);
          if (!job || !question) throw Error('Question no longer exists');
          return rememberAnswer(s, { job, question: question.text, value: p.value, scope: p.scope, expires: p.expires || null, confirmed: true, source: 'local review window: user confirmation' });
        }); return send(200, { saved: true, id: answer.id });
      }
      if (url.pathname === '/api/retry') { await retryJob(root, p.job, p.confirmedNotSubmitted === true); return send(200, { ready: true }); }
      return send(404, { error: 'Not found' });
    } catch (e) { send(400, { error: e.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const runtime = { origin, token, pid: process.pid };
  writeFileSync(runtimePath(root), JSON.stringify(runtime), { mode: 0o600 });
  const watcher = watch(join(root, 'data/lean'), (_event, name) => { if (String(name) === 'application-state.json') for (const peer of peers) peer.write('data: changed\n\n'); });
  return { server, runtime, close: () => { watcher.close(); for (const peer of peers) peer.end(); server.closeAllConnections(); server.close();
    if (readJson(runtimePath(root), {})?.token === token) rmSync(runtimePath(root), { force: true }); } };
}
export async function openReview(root = getCareerOpsRoot()) {
  let runtime = readJson(runtimePath(root), null);
  try { const u = new URL(runtime?.origin); if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port || !/^[a-f0-9]{64}$/.test(runtime.token)) runtime = null; } catch { runtime = null; }
  try { if (!runtime || (await (await fetch(runtime.origin + '/health', { signal: AbortSignal.timeout(1000) })).json()).service !== 'career-ops-review') runtime = null; } catch { runtime = null; }
  if (!runtime) {
    runtime = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve'], { detached: true, env: { ...process.env, CAREER_OPS_ROOT: root }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      const timer = setTimeout(() => { child.kill(); reject(Error('Review server startup timed out')); }, 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', code => { clearTimeout(timer); reject(Error(`Review server exited: ${code}`)); });
      child.once('message', message => { clearTimeout(timer); child.disconnect(); child.unref(); resolve(message); });
    });
  }
  const response = await fetch(runtime.origin + '/internal/open', { method: 'POST', headers: { Authorization: `Bearer ${runtime.token}` }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error('Could not open review window');
  return { opened: true, origin: runtime.origin };
}
if (isMainModule(import.meta.url)) {
  if (process.argv[2] === '--serve') { const instance = await startReviewServer(); process.send?.(instance.runtime); }
  else if (process.argv[2] === '--open') console.log(JSON.stringify(await openReview()));
  else { console.error('node lean-review.mjs --open'); process.exitCode = 1; }
}
