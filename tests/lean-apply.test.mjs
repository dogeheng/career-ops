import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { chromium } from 'playwright';
import { command } from '../lean-apply.mjs';
import { readState, claimNext, setJob, changeState, rememberAnswer, lookupAnswer, retryJob, skipJobByUser } from '../lib/lean-apply.mjs';
import { startReviewServer, launchWindow } from '../lean-review.mjs';
import { makeBackup, restoreBackup } from '../lean-backup.mjs';

function fixture(t, count = 8) {
  const root = mkdtempSync(join(tmpdir(), 'career-apply-'));
  mkdirSync(join(root, 'data/lean'), { recursive: true });
  const queue = Array.from({ length: count }, (_, i) => ({ key: `https://jobs.example/${i}`, url: `https://jobs.example/${i}`, company: `Company ${i}`, country: 'US', title: 'New Graduate Engineer', state: 'queued', source_listed: true, screen: { status: 'needs-review' } }));
  writeFileSync(join(root, 'data/lean/jobs.json'), JSON.stringify(queue));
  t.after(() => rmSync(root, { recursive: true, force: true })); return root;
}
const enable = root => command(['enable', '--confirmed-by-user'], root);

test('disabled by default; more than three jobs can be claimed concurrently without duplication', async t => {
  const root=fixture(t, 17); await assert.rejects(claimNext(root), /disabled/);
  await enable(root);
  const claims=await Promise.all(Array.from({length:17},()=>claimNext(root)));
  assert.equal(new Set(claims.map(c=>c.job.key)).size,17);
  assert.equal((await claimNext(root)).job,null);
  for(const c of claims) await setJob(root,c.job.key,c.job.claim,'skipped',{reason:'Fixture mismatch'});
  assert.equal((await claimNext(root)).job,null);
});

test('blocked jobs do not stop others; exact scoped user answers wake the original job', async t => {
  const root=fixture(t);await enable(root);const first=(await claimNext(root)).job;
  await setJob(root,first.key,first.claim,'waiting',{questions:[{text:'Previously employed here?'}]});
  const second=(await claimNext(root)).job;assert.notEqual(second.key,first.key);
  await changeState(root,s=>rememberAnswer(s,{job:first,question:'Previously employed here?',value:'No',confirmed:true}));
  const resumed=(await claimNext(root)).job;assert.equal(resumed.key,first.key);
  const s=readState(root);assert.equal(lookupAnswer(s,second,'Previously employed here?'),null);
  assert.equal(lookupAnswer(s,first,'Previously employed here?').value,'No');
  assert.equal(lookupAnswer(s,first,'Have you worked here?'),null);
  assert.throws(()=>rememberAnswer(s,{job:first,question:'Password',value:'fictional',confirmed:true}),/Credentials/);
  assert.throws(()=>rememberAnswer(s,{job:first,question:'Citizenship?',value:'unknown'}),/explicit user/);
});

test('specific answers outrank general ones; expired offer facts are not reused', () => {
  const s={answers:[],jobs:{}},job={key:'https://jobs.example/1',company:'Acme',country:'US'};
  rememberAnswer(s,{job,question:'Work location?',value:'New York',confirmed:true});
  rememberAnswer(s,{job,question:'Work location?',value:'Anywhere',scope:'global',confirmed:true});
  assert.equal(lookupAnswer(s,job,'Work location?').value,'New York');
  assert.throws(()=>rememberAnswer(s,{job,question:'Offer deadline?',value:'2020-01-01',confirmed:true}),/expiry/);
  rememberAnswer(s,{job,question:'Offer deadline?',value:'2020-01-01',expires:'2020-01-01',confirmed:true});
  assert.equal(lookupAnswer(s,job,'Offer deadline?','2026-11-06'),null);
  rememberAnswer(s,{job,question:'Offer deadline?',value:'2026-11-30',expires:'2026-11-30',confirmed:true});
  assert.equal(lookupAnswer(s,job,'Offer deadline?','2026-12-01T02:00:00Z').value,'2026-11-30');
  assert.equal(lookupAnswer(s,job,'Offer deadline?','2026-12-01T06:00:00Z'),null);
});

test('approved QQ facts reuse wording variants without treating citizenship as export eligibility', () => {
  const first = { key: 'https://jobs.example/first', company: 'Acme', country: 'US' };
  const other = { key: 'https://jobs.example/other', company: 'Other', country: 'CA' };
  const state = { answers: [], jobs: { [first.key]: first, [other.key]: other } };
  rememberAnswer(state, { job: first, question: 'In which country/region do you have citizenship?', value: 'Canada', confirmed: true, source: 'QQ relay quote (r_first)' });
  const match = lookupAnswer(state, other, 'What is your country of citizenship? *');
  assert.equal(match.value, 'Canada');
  assert.equal(match.original_job, first.key);
  assert.equal(lookupAnswer(state, other, 'Do you satisfy US export-control eligibility?'), null);
  rememberAnswer(state, { job: other, question: 'Country/region of citizenship', value: 'Ireland', confirmed: true, source: 'QQ relay code (r_other)' });
  assert.equal(lookupAnswer(state, { key: 'https://jobs.example/third' }, 'What is your country of citizenship?'), null);
});

test('equivalent sponsorship questions stay within the saved country and time frame', () => {
  const first = { key: 'https://jobs.example/first', company: 'Acme', country: 'US' };
  const state = { answers: [], jobs: { [first.key]: first } };
  rememberAnswer(state, { job: first, question: 'Will you now or in the future require visa sponsorship?', value: 'Yes', confirmed: true, source: 'QQ relay quote (r_first)' });
  const other = { key: 'https://jobs.example/other', company: 'Other', country: 'US' };
  assert.equal(lookupAnswer(state, other, 'Do you require visa sponsorship now or in the future?').value, 'Yes');
  assert.equal(lookupAnswer(state, { ...other, country: 'CA' }, 'Do you require visa sponsorship now or in the future?'), null);
  assert.equal(lookupAnswer(state, other, 'Do you require visa sponsorship today?'), null);
});

test('confirmed US authorization and future sponsorship are read directly from the private profile', t => {
  const root = fixture(t);
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config/profile.yml'), 'screening:\n  us_work_authorization_type: OPT\n  work_authorization: { US: true }\n  future_sponsorship_required: { US: true }\n');
  const state = readState(root), us = { key: 'https://jobs.example/us', country: 'US' };
  assert.equal(lookupAnswer(state, us, 'Are you legally authorized to work in the United States?').value, 'Yes');
  assert.equal(lookupAnswer(state, us, 'Are you currently on OPT?').value, 'Yes');
  assert.equal(lookupAnswer(state, us, 'Will you need sponsorship now or in the future to work in the United States?').value, 'Yes');
  assert.equal(lookupAnswer(state, us, 'Do you require visa sponsorship today?'), null);
  assert.equal(lookupAnswer(state, us, 'What is the expiration date of your current visa?'), null);
  assert.equal(lookupAnswer(state, { ...us, country: 'CA' }, 'Do you require visa sponsorship?'), null);
});

test('confirmed defaults persist across employers while application and internship history take precedence', async t => {
  const root = fixture(t, 3);
  const [first, second, third] = JSON.parse(readFileSync(join(root, 'data/lean/jobs.json'), 'utf8'));
  const file = join(root, 'confirmed-defaults.json');
  writeFileSync(file, JSON.stringify({ relocation: true, prior_application: false, prior_employment: false, current_employment: false, relatives: false, military_service: false }));
  await assert.rejects(command(['defaults','--file',file],root), /Explicit user confirmation/);
  await command(['defaults','--file',file,'--confirmed-by-user'],root);
  writeFileSync(join(root,'data/applications.md'), '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n|---|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-11-09 | Company 0 | Engineer | N/A | Applied | ✅ | — | Employer confirmed | [job](https://jobs.example/old) |\n| 2 | 2026-11-09 | Company 2 | Engineer | N/A | Draft | ✅ | — | Draft | [job](https://jobs.example/draft) |\n');
  writeFileSync(join(root,'cv.md'),'## Work Experience\n\n### Company 1 — New York\n\n**Engineering Intern**\nJun 2026 - Aug 2026\n');
  const state = readState(root);
  for (const job of [first, second, third]) {
    assert.equal(lookupAnswer(state,job,'Are you open to relocation?').value,'Yes');
    assert.equal(lookupAnswer(state,job,'Veteran status').value,'No');
    assert.equal(lookupAnswer(state,job,'Do you have any relatives at this company?').value,'No');
    assert.equal(lookupAnswer(state,job,'Do you require relocation assistance?'),null);
  }
  await changeState(root,s=>rememberAnswer(s,{job:first,question:'Have you previously applied to Company 0?',value:'No',confirmed:true}));
  const updated = readState(root);
  assert.equal(lookupAnswer(updated,first,'Have you previously applied to Company 0?').value,'Yes');
  assert.equal(lookupAnswer(updated,second,'Have you previously applied to Company 0 or any Company 0 subsidiary?').value,'Yes');
  assert.equal(lookupAnswer(updated,third,'Have you ever applied to this company?').value,'No');
  assert.equal(lookupAnswer(updated,second,'Have you been employed by Company 1 in the past?').value,'Yes');
  assert.equal(lookupAnswer(updated,second,'Are you currently a Company 1 employee?').value,'No');
  assert.equal(lookupAnswer(updated,third,'Have you previously worked for us?').value,'No');
});

test('submission intent, matching evidence and held ambiguous outcomes prevent duplicates', async t => {
  const root=fixture(t);await enable(root);const j=(await claimNext(root)).job;
  const evidence={kind:'confirmation_page',job_url:j.url,confirmation_url:'https://jobs.example/confirmation',text:'Application received'};
  await assert.rejects(setJob(root,j.key,j.claim,'submitted',{evidence}),/confirmation/);
  await assert.rejects(setJob(root,j.key,'wrong','submitting'),/mismatch/);
  await setJob(root,j.key,j.claim,'submitting');
  await assert.rejects(setJob(root,j.key,j.claim,'submitted',{evidence:{...evidence,kind:'upload',text:'Resume uploaded'}}),/confirmation/);
  await assert.rejects(setJob(root,j.key,j.claim,'submitting'),/already attempted/);
  await assert.rejects(setJob(root,j.key,j.claim,'waiting',{questions:[{text:'Unknown'}]}),/attempted/);
  await assert.rejects(setJob(root,j.key,j.claim,'submitted',{evidence:{...evidence,job_url:'https://jobs.example/other'}}),/matching/);
  await setJob(root,j.key,j.claim,'submitted',{evidence});
  await assert.rejects(retryJob(root,j.key,true),/Cannot retry/);
  const next=(await claimNext(root)).job;await setJob(root,next.key,next.claim,'submitting');await setJob(root,next.key,next.claim,'uncertain');
  assert.notEqual((await claimNext(root)).job.key,next.key);
  await assert.rejects(retryJob(root,next.key,false),/Confirm/);await retryJob(root,next.key,true);
  assert.equal((await claimNext(root)).job.key,next.key);
});

test('disabling prevents a pending submit; artifact paths stay portable and cannot escape the data root', async t=>{
  const root=fixture(t);await enable(root);const j=(await claimNext(root)).job;
  await command(['disable'],root);await assert.rejects(setJob(root,j.key,j.claim,'submitting'),/disabled/);
  await enable(root);
  await assert.rejects(setJob(root,j.key,j.claim,'waiting',{questions:[{text:'Fact?'}],draft:{resume:'../outside.pdf'}}),/private data root/);
  await setJob(root,j.key,j.claim,'waiting',{questions:[{text:'Fact?'}],draft:{resume:join(root,'output','resume.pdf')}});
  assert.equal(readState(root).jobs[j.key].draft.resume,'output/resume.pdf');
  assert.throws(()=>rememberAnswer({answers:[],jobs:{}},{job:j,question:'Offer deadline?',value:'yes',expires:'2026-02-31',confirmed:true}),/valid/);
});

test('canonical tracker excludes an already applied job even before ingestion refresh', async t=>{
  const root=fixture(t);await enable(root);
  writeFileSync(join(root,'data/applications.md'),'| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n|---|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-11-06 | Company 0 | Engineer | N/A | Applied | ✅ | — | confirmed | [job](https://jobs.example/0?utm_source=mail) |\n');
  assert.notEqual((await claimNext(root)).job.key,'https://jobs.example/0');
});

test('private answers migrate to a different root; runtime tokens stay behind and active claims require review', async t=>{
  const src=fixture(t),dst=fixture(t,0);await enable(src);const j=(await claimNext(src)).job;
  await changeState(src,s=>rememberAnswer(s,{job:j,question:'Degree?',value:'MS',confirmed:true}));
  writeFileSync(join(src,'data/lean/review-runtime.json'),JSON.stringify({token:'fixture-secret',pid:999}));
  const backup=makeBackup(src);assert.equal(backup.files['data/lean/review-runtime.json'],undefined);
  restoreBackup(backup,dst,true);const state=readState(dst);
  assert.equal(state.jobs[j.key].status,'uncertain');assert.equal(state.jobs[j.key].claim,undefined);
  assert.equal(lookupAnswer(state,j,'Degree?').value,'MS');assert.notEqual((await claimNext(dst)).job.key,j.key);
});

test('user stop survives migration, stays out of review and cannot be undone by an ordinary retry', async t => {
  const src = fixture(t, 2), dst = fixture(t, 0);
  await enable(src); const job = (await claimNext(src)).job;
  await changeState(src, state => skipJobByUser(state, state.jobs[job.key], { confirmed: true, source: 'QQ relay code', request_id: 'r_fixture' }));
  restoreBackup(makeBackup(src), dst, true);
  assert.equal(readState(dst).jobs[job.key].user_skip.request_id, 'r_fixture');
  assert.notEqual((await claimNext(dst)).job.key, job.key);
  await assert.rejects(retryJob(dst, job.key, true), /resume-user-skipped/);
  const instance = await startReviewServer(dst); t.after(() => instance.close());
  const { origin, token } = instance.runtime;
  const visible = await (await fetch(origin + '/api/state', { headers: { Cookie: `career_review=${token}` } })).json();
  assert.equal(visible.jobs.some(j => j.key === job.key), false);
  await command(['retry', '--job', job.key, '--confirmed-not-submitted', '--resume-user-skipped'], dst);
  assert.equal(readState(dst).jobs[job.key].user_skip, undefined);
  assert.equal((await claimNext(dst)).job.key, job.key);
});

test('an unverifiable old QQ request prevents submission even after a fresh invocation', async t => {
  const root = fixture(t, 1); await enable(root);
  const job = (await claimNext(root)).job;
  await changeState(root, state => { state.jobs[job.key].questions = [{ text: 'An old question', relay: { id: 'r_missing', status: 'unavailable' } }]; });
  await assert.rejects(command(['submit-intent', '--job', job.key, '--claim', job.claim], root), /could not be synchronized/);
  assert.equal(readState(root).jobs[job.key].status, 'working');
});

test('review API blocks anonymous and cross-origin writes; browser confirmation persists answers without executing markup', async t=>{
  const root=fixture(t);await enable(root);const j=(await claimNext(root)).job;
  const question='A required fact <img src=x onerror="window.pwned=true">?';
  await setJob(root,j.key,j.claim,'waiting',{questions:[{text:question}]});
  const instance=await startReviewServer(root);t.after(()=>instance.close());
  const {origin,token}=instance.runtime;
  assert.equal((await fetch(origin+'/api/state')).status,403);
  const headers={Cookie:`career_review=${token}`,'Content-Type':'application/json',Origin:'https://evil.example'};
  assert.equal((await fetch(origin+'/api/answer',{method:'POST',headers,body:'{}'})).status,403);
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.goto(origin+'/launch/'+token);
  await page.getByRole('textbox',{name:question}).fill('Confirmed factual answer');
  await page.getByRole('button',{name:'确认并记住，等待继续'}).click();
  await page.getByText('回答已保存，下一轮优先继续').waitFor();
  assert.equal(await page.evaluate(()=>window.pwned),undefined);
  assert.equal(readState(root).jobs[j.key].status,'ready');assert.equal(lookupAnswer(readState(root),j,question).value,'Confirmed factual answer');
});

test('desktop launchers have explicit macOS, Windows and Linux paths without shell execution',()=>{
  for(const platform of ['darwin','win32','linux']){
    let got;launchWindow('http://127.0.0.1:12345/launch/abc',platform,(exe,args,options)=>{got={exe,args,options};return {};});
    assert.ok(got.args.includes('http://127.0.0.1:12345/launch/abc'));assert.notEqual(got.options.shell,true);
  }
});

test('automatic questions reuse one window; explicit reopen works after a browser tab is closed', async t=>{
  const root=fixture(t);let launches=0;
  const instance=await startReviewServer(root,{launch:()=>{launches++;const child=new EventEmitter();child.unref=()=>{};return {child,native:false};}});t.after(()=>instance.close());
  const {origin,token}=instance.runtime,options={method:'POST',headers:{Authorization:'Bearer '+token}};
  await fetch(origin+'/internal/open',options);await fetch(origin+'/internal/open',options);assert.equal(launches,1);
  await fetch(origin+'/internal/open?force=1',options);assert.equal(launches,2);
});

test('a native review window keeps its service when the web view disconnects', { timeout: 5000 }, async t => {
  const root = fixture(t);
  const child = new EventEmitter();
  child.unref = () => {};
  let launches = 0;
  const instance = await startReviewServer(root, {
    idleMs: 50,
    launch: () => {
      launches++;
      return { child, native: true };
    },
  });
  t.after(() => instance.close());
  const { origin, token } = instance.runtime;
  const open = { method: 'POST', headers: { Authorization: 'Bearer ' + token } };
  await fetch(origin + '/internal/open', open);
  const events = await fetch(origin + '/events', { headers: { Cookie: 'career_review=' + token } });
  assert.equal(events.status, 200);
  await events.body.cancel();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal((await fetch(origin + '/health')).status, 200);
  await fetch(origin + '/internal/open', open);
  assert.equal(launches, 1);

  const stopped = new Promise(resolve => instance.server.once('close', resolve));
  child.emit('exit');
  await stopped;
  assert.equal(instance.server.listening, false);
});

test('closing the last review tab stops the server while pending answers stay on disk', { timeout: 5000 }, async t => {
  const root = fixture(t); await enable(root);
  const job = (await claimNext(root)).job;
  await setJob(root, job.key, job.claim, 'waiting', { questions: [{text:'Can you travel?'}] });
  const instance = await startReviewServer(root, { idleMs: 150 });
  t.after(() => instance.close());
  const {origin, token} = instance.runtime;
  const response = await fetch(origin+'/events', {headers:{Cookie:'career_review='+token}});
  assert.equal(response.status,200);
  const stopped = new Promise(resolve=>instance.server.once('close',resolve));
  await response.body.cancel(); await stopped;
  assert.equal(existsSync(join(root,'data/lean/review-runtime.json')),false);
  assert.equal(readState(root).jobs[job.key].status,'waiting');
});

test('claiming rechecks newer hard filters against an older queue', async t => {
  const root=fixture(t,2); await enable(root);
  const file=join(root,'data/lean/jobs.json'), jobs=JSON.parse(readFileSync(file,'utf8'));
  jobs[0].requires_security_clearance=true; writeFileSync(file,JSON.stringify(jobs));
  mkdirSync(join(root,'config'));
  writeFileSync(join(root,'config/profile.yml'),'screening:\n  exclude_security_clearance: true\n');
  assert.equal((await claimNext(root)).job.key,jobs[1].key);
});
