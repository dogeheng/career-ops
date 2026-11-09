import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { screenJob } from '../lib/lean-screen.mjs';
import { JOB_SOURCES, parseSource, deduplicateJobs, countryOf } from '../lib/lean-sources.mjs';
import { mergeQueue, shortlist } from '../lean-ingest.mjs';
import { uploadResumeOnce, withOwnedBrowserContext } from '../lean-handoff.mjs';

const profile = { screening: { countries: ['US', 'CA', 'SG', 'AU', 'GB'], employment_types: ['fulltime'],
  full_time_years: 0, graduation_date: '2026-12-23', available_from: '2027-01-10',
  work_authorization: { US: true, CA: false, SG: false }, future_sponsorship_required: { US: true, CA: true, SG: true } } };
const job = extra => ({ country: 'US', metadata_only: false, text: '', ...extra });
const codes = s => s.blockers.map(x => x.code);
test('future sponsorship is screened even with current OPT', () => {
  const r = screenJob(job({ text: 'We do not sponsor visas now or in the future.' }), profile);
  assert.equal(r.status, 'skip'); assert.ok(codes(r).includes('sponsorship'));
});
test('sponsorship silence and unknown profile facts never cause rejection', () => {
  assert.equal(screenJob(job({}), profile).status, 'needs-review');
  assert.equal(screenJob(job({ sponsorship: 'no' }), {}).status, 'needs-review');
});
test('explicit professional minimum excludes zero full-time experience', () => {
  assert.ok(codes(screenJob(job({ text: 'Minimum of 2 years of professional experience required.' }), profile)).includes('experience'));
});
test('preferred experience and degree alternatives do not auto-reject', () => {
  assert.equal(screenJob(job({ text: '3 years of professional experience preferred.' }), profile).blockers.length, 0);
  const r = screenJob(job({ text: 'Minimum of 2 years of professional experience or a Masters degree.' }), profile);
  assert.equal(r.blockers.length, 0); assert.ok(r.questions.some(x => x.code === 'experience_interpretation'));
});
test('internship-counting experience is kept for interpretation', () => {
  const r = screenJob(job({ text: 'Minimum of 1 year of professional experience, including internships.' }), profile);
  assert.equal(r.blockers.length, 0);
});
test('existing foreign work permit is a blocker, sponsor silence is not', () => {
  const r = screenJob(job({ country: 'SG', text: 'Candidates must have an existing work permit.' }), profile);
  assert.ok(codes(r).includes('work_authorization'));
  assert.equal(screenJob(job({ country: 'CA' }), profile).blockers.length, 0);
});
test('graduation and start-date windows use explicit facts', () => {
  assert.ok(codes(screenJob(job({ graduation_from: '2027-01-01' }), profile)).includes('graduation_window'));
  assert.ok(codes(screenJob(job({ latest_start_date: '2027-01-01' }), profile)).includes('start_date'));
});
test('citizenship is never inferred from OPT', () => {
  assert.equal(screenJob(job({ citizenship: 'US' }), profile).blockers.length, 0);
  assert.ok(screenJob(job({ citizenship: 'US' }), profile).questions.some(x => x.code === 'citizenship_unknown'));
});
test('explicit citizenship, green-card and clearance requirements follow the profile exclusions', () => {
  const exclusions = { screening: { ...profile.screening, exclude_citizen_only: true, exclude_green_card_only: true, exclude_security_clearance: true } };
  for (const [text, code] of [
    ['Candidates must be a U.S. citizen.', 'citizenship'],
    ['US citizens only.', 'citizenship'],
    ['Candidates must hold a green card.', 'permanent_residency'],
    ['Applicants must be U.S. citizens or lawful permanent residents.', 'citizenship_or_permanent_residency'],
    ['Ability to obtain and maintain a Secret clearance.', 'security_clearance'],
    ['Security clearance level: Top Secret', 'security_clearance'],
    ['An active safety clearance is required.', 'security_clearance'],
  ]) assert.ok(codes(screenJob(job({text}),exclusions)).includes(code), text);
  for (const text of ['A background check is required.', 'Security clearance is preferred.', 'No security clearance is required.', 'U.S. citizenship is not required.']) {
    assert.equal(screenJob(job({text}),exclusions).blockers.length, 0, text);
  }
  const ambiguous=screenJob(job({text:'Must be a U.S. citizen or have an EAD.'}),exclusions);
  assert.equal(ambiguous.status,'needs-review');
  assert.ok(ambiguous.questions.some(q=>q.code==='citizenship_interpretation'));
});
test('known out-of-scope countries and internships are filtered', () => {
  assert.ok(codes(screenJob(job({ country: 'IN' }), profile)).includes('country'));
  assert.ok(codes(screenJob(job({ employment_type: 'internship' }), profile)).includes('employment_type'));
});
const row = '| Acme | Software Engineer New Grad | Toronto, Canada | <a href="https://jobs.example/a?utm_source=x">Apply</a> | 2d |';
test('SpeedyApply international five-column table and US salary table', () => {
  const intl = parseSource(row, JOB_SOURCES[0], 'NEW_GRAD_INTL.md')[0];
  assert.equal(intl.country, 'CA'); assert.equal(intl.age_days, 2);
  assert.equal(parseSource(row.replace(' | <a', ' | $100k | <a'), JOB_SOURCES[0], 'NEW_GRAD_USA.md').length, 1);
});
test('Simplify HTML uses employer link, inherits company, applies legends', () => {
  const rows = '<tr><td>Acme 🛂</td><td>Engineer</td><td>Seattle, WA</td><td><a href="https://jobs.example/a">Apply</a><a href="https://simplify.jobs/p/a">simplify</a></td><td>1d</td></tr>'
    + '<tr><td>↳</td><td>Engineer II</td><td>Remote in USA</td><td><a href="https://jobs.example/b">Apply</a></td><td>2d</td></tr>';
  const parsed = parseSource(rows, JOB_SOURCES[1], 'README.md');
  assert.equal(parsed.length, 2); assert.equal(parsed[0].sponsorship, 'no');
  assert.equal(parsed[0].url, 'https://jobs.example/a'); assert.equal(parsed[1].company, 'Acme');
});
test('canonical URLs deduplicate across sources', () => {
  const a = parseSource(row, JOB_SOURCES[0], 'NEW_GRAD_INTL.md')[0];
  const b = parseSource(row.replace('utm_source=x', 'utm_source=y'), JOB_SOURCES[1], 'README.md')[0];
  const all = deduplicateJobs([a, b]); assert.equal(all.length, 1); assert.equal(all[0].sources.length, 2);
});
test('ambiguous multi-country locations stay unknown', () => {
  assert.equal(countryOf('Toronto, Canada / Seattle, WA'), null);
  assert.equal(countryOf('Remote'), null);
  assert.equal(countryOf('Iaşi, Romania'), 'RO');
});
test('re-ingestion preserves state, is idempotent and re-screens changed profile', () => {
  const a = parseSource(row, JOB_SOURCES[0], 'NEW_GRAD_INTL.md')[0];
  let q = mergeQueue([a], [], profile, new Set(), '2026-11-04'); q[0].state = 'submitted';
  q = mergeQueue([a], q, profile, new Set(), '2026-11-05');
  assert.equal(q.length, 1); assert.equal(q[0].first_seen, '2026-11-04'); assert.equal(q[0].state, 'submitted');
  assert.equal(shortlist(q).length, 0);
  assert.equal(mergeQueue([], q, profile)[0].source_listed, false);
});
test('tracked URL is not offered again and missing metadata remains reviewable', () => {
  const a = parseSource(row, JOB_SOURCES[0], 'NEW_GRAD_INTL.md')[0];
  const q = mergeQueue([a], [], profile, new Set([a.key]));
  assert.equal(q[0].state, 'tracked'); assert.equal(shortlist(q).length, 0);
  assert.ok(q[0].screen.questions.some(x => x.code === 'jd_required'));
});
test('Chromium attaches only one labelled résumé input and never submits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-lean-test-'));
  const pdf = join(dir, 'resume.pdf'); writeFileSync(pdf, '%PDF-1.7\nTest');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<form onsubmit="window.didSubmit=true;return false"><label>Resume<input type="file" name="resume"></label><label>Cover letter<input type="file" name="cover"></label><button>Submit</button></form>');
    assert.equal((await uploadResumeOnce(page, pdf)).uploaded, true);
    assert.equal(await page.locator('[name=resume]').evaluate(el => el.files[0].name), 'resume.pdf');
    assert.equal(await page.locator('[name=cover]').evaluate(el => el.files.length), 0);
    assert.equal(await page.evaluate(() => window.didSubmit), undefined);
    await page.setContent('<input type="file" name="resume1"><input type="file" name="resume2">');
    assert.equal((await uploadResumeOnce(page, pdf)).reason, 'ambiguous-resume-inputs');
    await page.setContent('<input type="file" name="passport">');
    assert.equal((await uploadResumeOnce(page, pdf)).uploaded, false);
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('owned browser context closes if an application fails before handoff', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await assert.rejects(withOwnedBrowserContext(context, async () => {
      await context.newPage();
      throw Error('Fixture navigation failed');
    }), /Fixture navigation failed/);
    assert.equal(browser.contexts().length, 0);
  } finally { await browser.close(); }
});
