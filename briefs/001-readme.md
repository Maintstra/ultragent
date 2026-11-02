# Task 001: write README.md for this repository

This repository is a small local coding worker built on the official Claude Agent SDK
(`@anthropic-ai/claude-agent-sdk`). Read `worker.mjs`, `guard-test.mjs`, `package.json`,
`.gitignore` and `.env.example` first. Describe only what the code actually does; do not invent features.

Write `README.md` (English, plain and specific, no marketing clichés, no emoji) with:

1. One-sentence summary: a manager (a person or another agent) writes a Markdown brief; the worker runs it
   headless on your own machine inside one repo directory, under a USD budget and a tool guard, writes a report, and stops.
2. Why: local (code stays on your machine), hard per-task USD cap (`maxBudgetUsd`), API-key-only billing
   (refuses to run if credentials come from anything other than its own key), key isolation (read from a local `.env`
   for that one process only; not exported globally), cost log (`costs.csv`).
3. Quick start: Node 18+, `npm install`, copy `.env.example` to `.env` and add the key, `npm run check` (dry check,
   about US$0.01–0.06), then a real run example with `--brief`, `--cwd`, `--budget`, `--report`.
4. Options table for every CLI flag in `parseArgs`.
5. The guard: list exactly what `BLOCKED_COMMANDS` and the path rules block, and that it runs both as `canUseTool`
   and as a `PreToolUse` hook so project allow-rules cannot bypass it. Add an honest "Limits" section: regex-based
   command matching can be evaded by a determined model, so run it on repos you can review, keep backups/git, and
   review diffs before pushing. It is not a sandbox.
6. Writing a good brief (short checklist) and what the report contains.
7. Settings loaded: project settings only (AGENTS.md/CLAUDE.md), not user hooks.
8. Not affiliated with Anthropic; uses the Claude Agent SDK under its terms. Do not use "Claude" or "Anthropic" as the
   product name — refer to the project as "local agent worker" for now (name to be decided).
9. License: MIT (also create a `LICENSE` file, MIT, copyright holder "U Design Studio", year 2026).

Do not modify `worker.mjs`, `guard-test.mjs` or `package.json`. Run `npm test` at the end and include the result in the report.
