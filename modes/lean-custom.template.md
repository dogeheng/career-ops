# Custom Instructions — lean application workflow

The standing default is **pre-screen → buildcv → sign in on Chromium → upload resume → human finishes and submits**.

- Route URLs/JDs, auto-pipeline, pipeline, pdf/buildcv and apply through `modes/lean.md`. Route scan/job-ingestion through the job-ingestion skill. These rules override upstream workflow defaults.
- Skip eval/oferta, A–H reports, scores, company/salary research, cover letters, interview prep, multi-model judges, repeated reviews and batch evaluators unless I explicitly request them. Do not load their prompts as part of lean mode. A hard-constraint screen is not a scored evaluation.
- Use `config/profile.yml` for confirmed targeting and authorization facts; use `cv.md` for résumé facts. Null/missing means unknown. Ask concise questions; never guess dates, citizenship, sponsorship, seniority, addresses or experience.
- Reject only explicit hard constraints. Sponsorship silence, degree/experience alternatives and ambiguous requirements stay needs-review. Internships are separate from full-time employment. Read a real employer JD once; cached text is reused.
- Tailor one compact JSON payload from source facts. Location is optional and always truthful. Projects may be selected, reordered or omitted using JD relevance; every included claim must exist in cv.md. Preserve employers, titles, dates, metrics and attribution.
- Reuse deterministic builders and fact/structure checks; these checks are local code, not LLM evaluation. Never bypass a failing fact check to save tokens.
- Open a dedicated local Chromium profile. Login, passwords, MFA and CAPTCHA belong to me. Use the small upload helper; do not start a Playwright MCP form-filling loop. After upload, hand over dropdowns, questions and Submit to me.
- No automatic Submit/Send, no auto-registration, no emailed outreach. Upload only to the specific application destination I requested. Never label an upload as an application submitted.
- Daily ingestion updates only the two configured public job-source submodules, deduplicates and screens metadata locally. It does not generate CVs, browse every job, or submit applications. Summarize counts and a small shortlist rather than dumping the entire queue.
- Keep profile, cv.md, contact data, generated CVs, login sessions and job state out of Git. Preserve fork code with normal Git updates; do not run the upstream system updater over this fork.
