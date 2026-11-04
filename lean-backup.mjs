#!/usr/bin/env node
// Portable, explicit private-data bundle. No credentials or browser cookies.
import { existsSync, readFileSync, readdirSync, lstatSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const FIXED = new Set(['cv.md', 'article-digest.md', 'config/profile.yml', 'config/cv-facts.json', 'modes/_profile.md', 'modes/_custom.md', 'modes/_brief.md', 'portals.yml', 'data/applications.md', 'data/pdf-index.tsv', 'data/status-log.tsv', 'documents/source-resume.pdf']);
const TREES = ['data/lean', 'output', 'jds'];
export function allowedBackupPath(path) {
  if (typeof path !== 'string' || path.includes('\\') || path.startsWith('/') || path.split('/').some(s => !s || s === '.' || s === '..' || s.startsWith('.'))) return false;
  if (path.startsWith('data/lean/chromium/') || path === 'data/lean/chromium' || path.includes('.lock/') || /\.(?:lock|tmp)$/.test(path)) return false;
  return FIXED.has(path) || TREES.some(t => path.startsWith(t + '/'));
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function inside(root, path) { const r = relative(root, path); return !isAbsolute(r) && r !== '..' && !r.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')); }
function checkedPath(root, name) {
  if (!allowedBackupPath(name)) throw new Error(`Not a portable data path: ${name}`);
  const target = resolve(root, name);
  if (!inside(root, target)) throw new Error('Path escapes data root');
  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (!inside(realpathSync(root), realpathSync(ancestor))) throw new Error(`Symlink escapes data root: ${name}`);
  return target;
}
export function makeBackup(root = getCareerOpsRoot()) {
  root = resolve(root);
  const files = {};
  function visit(name) {
    const path = join(root, name);
    if (!existsSync(path) || !allowedBackupPath(name + (TREES.includes(name) ? '/placeholder' : ''))) return;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink in portable data: ${name}`);
    if (stat.isDirectory()) for (const item of readdirSync(path)) visit(name + '/' + item);
    else if (stat.isFile()) { const bytes = readFileSync(path); files[name] = { base64: bytes.toString('base64'), sha256: hash(bytes) }; }
  }
  for (const file of [...FIXED, ...TREES]) visit(file);
  return { format: 'career-ops-lean-backup/v1', created: new Date().toISOString(), files };
}
export function restoreBackup(bundle, root = getCareerOpsRoot(), overwrite = false) {
  if (bundle?.format !== 'career-ops-lean-backup/v1' || !bundle.files || typeof bundle.files !== 'object' || Array.isArray(bundle.files)) throw new Error('Unsupported backup');
  root = resolve(root); mkdirSync(root, { recursive: true });
  // Validate the entire bundle before writing any file.
  const entries = Object.entries(bundle.files).map(([name, file]) => {
    const path = checkedPath(root, name);
    if (typeof file?.base64 !== 'string' || typeof file.sha256 !== 'string') throw new Error(`Invalid backup entry: ${name}`);
    let bytes = Buffer.from(file.base64, 'base64');
    if (hash(bytes) !== file.sha256) throw new Error(`Checksum mismatch: ${name}`);
    if (!overwrite && existsSync(path)) throw new Error(`Already exists: ${name}; use --overwrite after checking the destination`);
    if (name === 'data/lean/last-run.json') {
      const last = JSON.parse(bytes.toString('utf8'));
      if (!last || typeof last !== 'object' || Array.isArray(last)) throw new Error('Invalid last-run data');
      last.shortlist = join(root, 'data/lean/shortlist.md'); last.queue = join(root, 'data/lean/jobs.json');
      bytes = Buffer.from(JSON.stringify(last, null, 2) + '\n');
    }
    return { path, bytes };
  });
  for (const { path, bytes } of entries) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes, { mode: 0o600 }); }
  return { restored: entries.length, root, next: 'Run lean-setup --install-skills and lean-native-setup install on this computer. Sign in to Chromium again.' };
}
if (isMainModule(import.meta.url)) {
  const [mode, path, flag] = process.argv.slice(2);
  try {
    if (!path || !['export', 'import'].includes(mode) || (flag && flag !== '--overwrite')) throw new Error('node lean-backup.mjs export <private-backup.json> | import <private-backup.json> [--overwrite]');
    if (mode === 'export') { const bundle = makeBackup(); mkdirSync(dirname(resolve(path)), { recursive: true }); writeFileSync(resolve(path), JSON.stringify(bundle), { mode: 0o600, flag: 'wx' }); console.log(JSON.stringify({ path: resolve(path), files: Object.keys(bundle.files).length, includes_credentials: false })); }
    else console.log(JSON.stringify(restoreBackup(JSON.parse(readFileSync(resolve(path), 'utf8')), getCareerOpsRoot(), flag === '--overwrite')));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
