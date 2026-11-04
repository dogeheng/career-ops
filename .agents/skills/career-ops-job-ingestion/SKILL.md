---
name: career-ops-job-ingestion
description: Update the two career-ops new graduate job-source submodules, deduplicate jobs and apply confirmed hard constraints locally. Use for daily job ingestion or refreshing the new grad shortlist, without evaluation or applications.
---

Resolve PROJECT_ROOT by walking up from this skill to the nearest folder containing `lean-ingest.mjs`. A globally installed copy instead reads sibling `installation.json` → `project_root`. Run commands from PROJECT_ROOT; User Layer paths follow `path-resolver.mjs`. If no install is found, ask for its location; do not guess a different checkout.

Read only DATA_ROOT/config/profile.yml and DATA_ROOT/modes/_custom.md for targeting/procedural rules. Run `node lean-ingest.mjs --refresh`. It updates only SpeedyApply's 2027 SWE college list and Simplify's new grad list, parses both Markdown and HTML formats, deduplicates canonical URLs and applies local constraints. No source repository scripts are executed. Internships are excluded for a full-time-only profile.

The run returns counts and paths. Read `data/lean/last-run.json`, then at most ten relevant entries from `data/lean/jobs.json` (prefer US, new grad, newest). Report new/skipped/needs-review counts and link `data/lean/shortlist.md`. Repo metadata does not confirm liveness, sponsorship or full JD requirements. Ambiguous/unknown facts remain needs-review; ask concise questions interactively, or record them for the next interactive run. Never invent a work permit or count an internship as full-time experience.

Do not run eval/oferta, batch workers, browser sessions, CV generation or applications during ingestion. Do not change queue states to Applied. Preserve the existing queue on source-format or fetch failures and report the actual failure. Re-running is idempotent; existing terminal application states survive refreshed metadata. Source pointer changes and all generated/private files remain local until the user requests code publication.
