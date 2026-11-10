# Continuous applications with explicit user authorization

Use only when the user requests automatic applications and `node lean-apply.mjs status` reports enabled. The user's explicit recurring authorization overrides the manual-submit default for this workflow. It does not authorize invented answers, outreach, bypassing approval reviews or security challenges. Do not enable this mode on a new installation without the user's instruction.

Resolve the code root from the installed career-ops skill's `installation.json` or the current checkout, and resolve the private data root with `path-resolver.mjs`. Run the commands below in the code root. Read profile.yml, cv.md and _custom.md once. Use Sol, one agent, no eval, scores, additional models or worker fan-out.

## Process the entire suitable queue

There is no discovery, per-run or daily application count limit. `node lean-apply.mjs next` atomically claims ONE job, with its `key` and `claim` token, without loading the whole queue into model context. Repeat after each completed, skipped or blocked job until no job remains or the host session/quota ends. Do not stop at three, five or ten jobs. A host time/context limit is not a user quantity cap: persist state and resume in the next scheduled run. Do not leave a sleeping model loop or exhaust tokens polling for answers.

The existing importer remains local and model-free. Use its queue, and optionally refresh it once if stale. No broad scored search. Recheck the live employer JD and run the existing lean pre-screen. Prefer US full-time new-grad/entry-level roles that match the confirmed profile and real skills. Do not reinterpret internships as full-time experience. Respect allowed countries, current work authorization, future sponsorship, graduation and earliest start. Explicit hard mismatches are skipped with evidence; unknown material eligibility remains pending, never silently passed. Job-source legends do not prove employer sponsorship. A prior user's exception for a single employer is not a blanket exception elsewhere.

Apply the profile's citizenship, permanent-residency and security-clearance exclusions. Clearance includes a mandatory ability to obtain or maintain one. A background check alone, a preference, or an ambiguous alternative is a different requirement. Record explicit JD requirements in `requires_us_citizenship`, `requires_green_card`, `citizenship: US_or_permanent_resident`, or `requires_security_clearance` when relevant. Check current profile rules again before submission.

Tailor one factual 11pt, one-page CV using the existing builder and deterministic checks. Reuse cached JD and base CV patches. Use the host's available authorized browser tool, following its skill and control rules. Reuse a signed-in session when available. Do not keep retrying failed selectors blindly. Each job is independent; employer account creation, authentication and browser-owned challenges depend on actual available permissions and credential access. Never put credentials or verification codes into prompts, files, the answer bank, Git or logs. Verify mailbox identity before reading only the current matching verification message. If secure credentials or user control are required, record the blocker and follow the browser handoff rules; do not route around a handoff by making another browser task.

Start the browser when a screened job needs it. Reuse the active application page, close agent-owned pages after each job, and release any temporary mail page after verification. Save draft artifacts before releasing a blocked page. Use DOM snapshots and text readback throughout unattended runs. Keep pixel screenshots, video, screenshot tracing, and raw CDP capture out of that path. On macOS, a stalled ego lite capture can leave a `Capturing` display-sleep assertion held ([ego lite issue #482](https://github.com/citrolabs/ego-lite/issues/482)).

Finish a successful ego-browser task with `task.finish({ keep: [] })`. Follow the browser tool's error and handoff rules for unfinished work. After an ego-browser run on macOS, check `pmset -g assertions` for any remaining ego lite `Capturing` assertion. If one remains, preserve drafts and bring the existing window into view or quit ego lite normally when no user task needs it. Pages needed for an active human handoff remain under the user's control.

## Remember answers and continue other applications

Run `node lean-apply.mjs relay-sync` before claiming jobs to collect QQ replies and send any unsent questions. Run it again near the end, with optional `--wait 25` for one bounded long poll. Continue ready jobs if time remains. Each sync exits when it finishes. The dsh-omni server handles its own queue and delivers subsequent questions after the Career Ops run exits.

Before asking a missing fact, query the exact question:

```sh
node lean-apply.mjs lookup --job JOB_URL --question 'Exact question text'
```

Use confirmed profile facts first. Check saved answers before opening a new question, including approved wording variants. Confirm the scope, expiry and actual form choices before filling. `lookup` can reuse unambiguous QQ facts on the curated list in `lib/lean-question-keys.mjs`. Preserve the distinction between a citizenship country, permanent-residency history and export eligibility.

Read the candidate's confirmed US work authorization and future sponsorship requirement from the private profile. Use those values for equivalent applicant questions without asking again. Keep the confirmed available date separate from work authorization. Use employer evidence for the employer's sponsorship policy. If it remains unresolved, mark the question with `audience: "employer"`, save the draft, and continue other jobs. Leave visa expiry and other unconfirmed document details pending until verified.

Use `lookup` for user-confirmed form defaults on willingness to relocate, prior applications, employment, relatives at the employer and military service. Choose the equivalent label on the actual form, such as “I am not a veteran” for a confirmed negative answer. Check the live tracker and CV for company-specific history. A confirmed application or prior internship takes precedence over the negative baseline. A relocation preference does not answer separate questions about paying moving costs or meeting a particular start date.

For an unknown required answer, save the draft if supported and write a private questions JSON file.

```json
{"questions":[{"text":"Exact employer question","context":"Why a fact is missing","choices":["Yes","No"]}],"draft":{"job_url":"https://employer.example/jobs/123","resume":"output/example.pdf"}}
```

```sh
node lean-apply.mjs block --job JOB_URL --claim CLAIM_TOKEN --file PRIVATE_QUESTIONS_JSON
```

This saves the job and sends each required question to the dsh-omni QQ relay. `queued` and `sent` are normal pending states. Continue with `next`. Local review is the fallback when delivery is unavailable or settles without an answer. Credentials and verification codes belong in the applicable employer or mailbox flow. Browser control handoffs can end the browser round.

QQ replies must quote the original message or include its `#短码`. The relay's request ID links each answer to its source job. Verified equivalents of selected facts share one pending QQ request and reuse its confirmed answer within the applicable scope. Other questions use their saved scope, which defaults to the original job. A time-sensitive or handoff reply is returned in `relay_replies`. Interpret it before filling the form and record the confirmed fact with its expiry. The review window allows the user to choose reuse scope and expiry. If the user answers in chat instead, record the actual answer immediately:

```json
{"job":"https://employer.example/jobs/123","question":"Exact employer question","value":"User's confirmed answer","scope":"job","expires":null,"source":"Explicit user reply in chat"}
```

```sh
node lean-apply.mjs answer --file PRIVATE_ANSWER_JSON --confirmed-by-user
```

Default scope is one job. Broader employer/country/global reuse requires the user's intent to support it. Time-sensitive offer/deadline answers require an expiry date. Never turn an Adobe-specific employment answer into a fact about another company. If an explicit user answer corrects an existing profile/CV fact, update that owning private source as well and retain the confirmation provenance, so later CVs do not reuse the old fact. Never derive such updates from a JD or generated content.

## Submit once and record evidence

When all mandatory facts are confirmed, the CV is correct and submission is within the user's explicit recurring authorization, do not require an extra review simply because the default mode is manual. Read back the final form fields as text, then run:

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

Only then add Applied via the existing reserve-report-num / headed tracker-additions TSV / merge-tracker writer (score N/A, no invented report). Refresh the local queue without a network refresh. Save the confirmation text, URL and application ID when available, with evidence links relative to the private data root. An upload alone is not a submission. If confirmation is ambiguous, use `result --status uncertain` and continue other jobs; never auto-retry. Interrupted `working` or `submitting` jobs stay held across runs and are visible in the review window. The user's explicit “verified not submitted” action is required to return them to the queue.

End with a concise Chinese report of confirmed submissions, hard mismatches, pending questions, uncertain outcomes and remaining work. Report actual counts; no target quota and no claim that every ATS will work unattended.
