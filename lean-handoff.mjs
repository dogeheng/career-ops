#!/usr/bin/env node
// A bounded Chromium helper. The human signs in and submits; no form filling.
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { chromium } from 'playwright';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { browserLaunchOptions } from './lib/browser-launch.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

export async function resumeInputs(page) {
  const matches = [];
  for (const frame of page.frames()) {
    for (const input of await frame.locator('input[type=file]').all()) {
      const hint = await input.evaluate(el => [el.id, el.name, el.getAttribute('aria-label'),
        ...(el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent),
        ...Array.from(el.labels || []).map(x => x.textContent),
        el.closest('[data-automation-id*="resume" i]')?.getAttribute('data-automation-id'),
        el.closest('[data-automation-id]')?.getAttribute('data-automation-id'),
        el.parentElement?.textContent?.slice(0, 200)].filter(Boolean).join(' '));
      if (/resume|résumé|\bcv\b|简历/i.test(hint)) matches.push(input);
    }
  }
  return matches;
}
export async function uploadResumeOnce(page, pdf) {
  const inputs = await resumeInputs(page);
  if (inputs.length !== 1) return { uploaded: false, reason: inputs.length ? 'ambiguous-resume-inputs' : 'no-labelled-resume-input' };
  try {
    await inputs[0].setInputFiles(pdf);
    let names = [];
    try { names = await inputs[0].evaluate(el => [...el.files].map(f => f.name)); } catch { /* site may replace the input after receiving the file */ }
    return { attempted: true, uploaded: true, filenames: names, submitted: false };
  } catch (e) { return { attempted: true, uploaded: false, reason: 'upload-outcome-unknown', submitted: false }; }
}
async function main(args) {
  if (args.includes('--help')) { console.log('node lean-handoff.mjs --url https://employer/job --resume /absolute/cv.pdf [--upload]\nHuman signs in; --upload authorizes one resume attachment to this destination. No typing, clicking or submission. Browser sessions stay local.'); return; }
  const opt = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--upload') opt.upload = true;
    else if (['--url', '--resume'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) opt[args[i].slice(2)] = args[++i];
    else throw new Error(`Unknown/missing argument: ${args[i]}`);
  }
  const url = new URL(opt.url);
  if (url.protocol !== 'https:') throw new Error('Application URL must use HTTPS');
  const root = getCareerOpsRoot(), pdf = resolve(opt.resume || '');
  const rel = relative(resolve(root, 'output'), pdf);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Resume must be inside this data root/output');
  if (!existsSync(pdf) || readFileSync(pdf).subarray(0, 5).toString() !== '%PDF-') throw new Error('A valid local PDF is required');
  const profile = join(root, 'data', 'lean', 'chromium'); mkdirSync(profile, { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(profile, browserLaunchOptions({ headless: false, viewport: null }));
  const page = context.pages()[0] || await context.newPage();
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  console.log(`Sign in manually, then open the Resume/CV step. PDF: ${pdf}`);
  console.log('You finish questions and click Submit. Close Chromium when done.');
  if (opt.upload) {
    const end = Date.now() + 10 * 60_000;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      if (Date.now() > end) { clearInterval(timer); console.log('Upload watch ended; attach the PDF manually.'); return; }
      busy = true;
      try {
        const pages = context.pages();
        // Only same employer host; a different ATS/SSO host requires a new explicit destination.
        const target = pages.at(-1);
        if (target && new URL(target.url()).hostname === url.hostname) {
          const result = await uploadResumeOnce(target, pdf);
          if (result.uploaded) { clearInterval(timer); console.log(JSON.stringify(result)); console.log('PDF attached. Verify the upload in the page; finish and submit manually.'); }
          else if (result.attempted) { clearInterval(timer); console.log('Upload outcome uncertain. Check the page before retrying manually.'); }
          else if (result.reason === 'ambiguous-resume-inputs') { clearInterval(timer); console.log('Several résumé inputs found; attach manually using the PDF path above.'); }
        }
      } catch (e) { /* Navigation/detachment is expected during human login. */ }
      finally { busy = false; }
    }, 3000);
    context.on('close', () => clearInterval(timer));
  }
  await new Promise(done => context.on('close', done));
}
if (isMainModule(import.meta.url)) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
