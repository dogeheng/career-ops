# Continuous applications with explicit user authorization

Use only when the user requests automatic applications and `node lean-apply.mjs status` reports enabled. The user's explicit recurring authorization overrides the manual-submit default for this workflow. It does not authorize invented answers, outreach, bypassing approval reviews or security challenges. Do not enable this mode on a new installation without the user's instruction.

Resolve the code root from the installed career-ops skill's `installation.json` or the current checkout, and resolve the private data root with `path-resolver.mjs`. Run the commands below in the code root. Read profile.yml, cv.md and _custom.md once. Use Sol, one agent, no eval, scores, additional models or worker fan-out.

## Process the entire suitable queue

There is no discovery, per-run or daily application count limit. `node lean-apply.mjs next` atomically claims ONE job, with its `key` and `claim` token, without loading the whole queue into model context. Repeat after each completed, skipped or blocked job until no job remains or the host session/quota ends. Do not stop at three, five or ten jobs. A host time/context limit is not a user quantity cap: persist state and resume in the next scheduled run. Do not leave a sleeping model loop or exhaust tokens polling for answers.

The existing importer remains local and model-free. Use its queue, and optionally refresh it once if stale. No broad scored search. Recheck the live employer JD and run the existing lean pre-screen. Prefer US full-time new-grad/entry-level roles that match the confirmed profile and real skills. Do not reinterpret internships as full-time experience. Respect allowed countries, current work authorization, future sponsorship, graduation and earliest start. Explicit hard mismatches are skipped with evidence; unknown material eligibility remains pending, never silently passed. Job-source legends do not prove employer sponsorship. A prior user's exception for a single employer is not a blanket exception elsewhere.

Tailor one factual 11pt, one-page CV using the existing builder and deterministic checks. Reuse cached JD and base CV patches. Use the host's available authorized browser tool, following its skill and control rules. Reuse a signed-in session when available. Do not keep retrying failed selectors blindly. Each job is independent; employer account creation, authentication and browser-owned challenges depend on actual available permissions and credential access. Never put credentials or verification codes into prompts, files, the answer bank, Git or logs. Verify mailbox identity before reading only the current matching verification message. If secure credentials or user control are required, record the blocker and follow the browser handoff rules; do not route around a handoff by making another browser task.

## Remember answers and continue other applications

Before asking a missing fact, query the exact question:

```sh
node lean-apply.mjs lookup --job JOB_URL --question 'Exact question text'
```

Use confirmed profile facts first; reuse an answer only when its meaning, scope, country/employer and expiry actually match. No fuzzy reuse for legal or immigration questions. For an unknown required answer, save the draft if supported and write a private questions JSON file:

```json
{"questions":[{"text":"Exact employer question","context":"Available choices and why a fact is missing"}],"draft":{"job_url":"https://employer.example/jobs/123","resume":"output/example.pdf"}}
```

```sh
node lean-apply.mjs block --job JOB_URL --claim CLAIM_TOKEN --file PRIVATE_QUESTIONS_JSON
```

This saves the job and opens the persistent local review window. Continue with `next`; a factual question blocks that job rather than the whole queue. If a native popup cannot open, the pending question is still saved: report the error and link `npm run apply:review`. Browser control/MFA/CAPTCHA handoffs can require ending the browser round, so do not claim other browser work can always continue during a user handoff.

The user can answer and choose reuse scope/expiry in the review window. Answers are saved automatically, and jobs whose questions are all answered become ready and take priority. If the user answers in chat instead, record their actual answer (not a prediction) immediately:

```json
{"job":"https://employer.example/jobs/123","question":"Exact employer question","value":"User's confirmed answer","scope":"job","expires":null,"source":"Explicit user reply in chat"}
```

```sh
node lean-apply.mjs answer --file PRIVATE_ANSWER_JSON --confirmed-by-user
```

Default scope is one job. Broader employer/country/global reuse requires the user's intent to support it. Time-sensitive offer/deadline answers require an expiry date. Never turn an Adobe-specific employment answer into a fact about another company. If an explicit user answer corrects an existing profile/CV fact, update that owning private source as well and retain the confirmation provenance, so later CVs do not reuse the old fact. Never derive such updates from a JD or generated content.

## Submit once and record evidence

When all mandatory facts are confirmed, the CV is correct and submission is within the user's explicit recurring authorization, do not require an extra review simply because the default mode is manual. Capture the final form, then run:

```sh
node lean-apply.mjs submit-intent --job JOB_URL --claim CLAIM_TOKEN
```

Click Submit exactly once. A timeout is NOT permission to click again. Verify an employer confirmation page, application ID or matching confirmation email. Save local evidence JSON:

```json
{"evidence":{"kind":"confirmation_page","job_url":"https://employer.example/jobs/123","confirmation_url":"https://employer.example/confirmation","text":"Actual employer confirmation text","application_id":"optional"}}
```

```sh
node lean-apply.mjs result --job JOB_URL --claim CLAIM_TOKEN --status submitted --file PRIVATE_EVIDENCE_JSON
```

Only then add Applied via the existing reserve-report-num / headed tracker-additions TSV / merge-tracker writer (score N/A, no invented report). Refresh the local queue without a network refresh. Save screenshot/evidence links relative to the private data root. An upload alone is not a submission. If confirmation is ambiguous, use `result --status uncertain` and continue other jobs; never auto-retry. Interrupted `working` or `submitting` jobs stay held across runs and are visible in the review window. The user's explicit “verified not submitted” action is required to return them to the queue.

End with a concise Chinese report of confirmed submissions, hard mismatches, pending questions, uncertain outcomes and remaining work. Report actual counts; no target quota and no claim that every ATS will work unattended.
