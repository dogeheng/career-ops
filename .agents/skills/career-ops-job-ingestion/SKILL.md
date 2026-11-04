---
name: career-ops-job-ingestion
description: Update the two career-ops new graduate job-source submodules, deduplicate jobs and apply confirmed hard constraints locally. Use for daily job ingestion or refreshing the new grad shortlist, without evaluation or applications.
---

Use an explicit project directory from the user/scheduler prompt when it contains `lean-ingest.mjs`; otherwise resolve PROJECT_ROOT by walking up from this skill, or read sibling `installation.json` → `project_root` for a global copy. Run commands from PROJECT_ROOT; User Layer paths follow `path-resolver.mjs`. If no install is found, ask for its location; do not guess another checkout.

Run `node lean-ingest.mjs --refresh`; it reads the confirmed profile itself. In a routine scheduled run, do not additionally read profile, CV or procedural files unless diagnosing a failure or resolving a user question. It updates only SpeedyApply's 2027 SWE college list and Simplify's new grad list, parses both Markdown and HTML formats, deduplicates canonical URLs and applies local constraints. No source repository scripts are executed. Internships are excluded for a full-time-only profile.

The command returns compact counts, paths and `top_new` (at most ten eligible new entries, US first). Report these directly; do not read the multi-megabyte jobs.json or full shortlist into model context. No extra read or model pass is needed after a successful command. Link the shortlist for the human. Repo metadata does not confirm liveness, sponsorship or full JD requirements. Ambiguous/unknown facts remain needs-review; ask concise questions interactively, or record them for the next interactive run. Never invent a work permit or count an internship as full-time experience.

Do not run eval/oferta, batch workers, browser sessions, CV generation or applications during ingestion. Do not change queue states to Applied. Preserve the existing queue on source-format or fetch failures and report the actual failure. Re-running is idempotent; existing terminal application states survive refreshed metadata. Source pointer changes and all generated/private files remain local until the user requests code publication.
