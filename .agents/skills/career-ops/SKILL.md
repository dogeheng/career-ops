---
name: career-ops
description: Screen jobs, tailor factual CVs, and handle applications or the persistent question inbox. Use for JDs, buildcv, apply, explicitly authorized continuous applications, or remembering recruiting answers.
---

# career-ops lean fork

Resolve PROJECT_ROOT by walking up from this skill to the nearest directory containing `lean-ingest.mjs` and `modes/`. A global copy reads sibling `installation.json` → `project_root` instead. If neither resolves, ask where this fork is installed; never run an upstream installer over it. Run scripts from PROJECT_ROOT. Resolve DATA_ROOT with `path-resolver.mjs`, respecting the environment and `.career-ops-data` marker.

Read PROJECT_ROOT/AGENTS.md, DATA_ROOT/config/profile.yml and DATA_ROOT/modes/_custom.md. Missing facts are questions; personal data stays local.

- Explicitly authorized continuous/automatic applications, or questions about their answer bank/inbox → read PROJECT_ROOT/modes/continuous-apply.md. `lean-apply.mjs` manages unlimited claims, scoped confirmed answers and submission evidence. This authorized mode overrides the manual-submit default below; it never authorizes guessed facts or security bypasses. `lean-review.mjs --open` opens the persistent question window.

- A pasted JD/URL, `lean`, `pre-screen`, `buildcv`, `pdf`, `auto-pipeline`, `pipeline` or `apply` → read PROJECT_ROOT/modes/lean.md and execute it. No eval, score or report prerequisite; no `_shared.md`/oferta/pdf/apply prompt loading, extra models or workers.
- `scan`, `ingest`, `job-ingestion`, daily refresh or new grad shortlist → read PROJECT_ROOT/.agents/skills/career-ops-job-ingestion/SKILL.md. This route is local parsing/filtering, no browser or CV generation.
- A specifically named upstream tool (tracker/interview/cover/etc.) → read PROJECT_ROOT/docs/UPSTREAM_AGENT_RULES.md and this skill's `references/upstream-router.md`, then execute only the requested tool. The user's `_custom.md` still overrides workflow defaults. Do not load upstream references for ordinary lean requests.
- No argument → show the four-step lean workflow and ask for a JD or a shortlist refresh.

Final Submit always belongs to the user. Do not automate login secrets/MFA/CAPTCHA, dropdowns or a form-filling loop. Upload only to an application destination the user requested. Resume facts come from cv.md and confirmed profile, not JD wish lists or prior generated reports.
