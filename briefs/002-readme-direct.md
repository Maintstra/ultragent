# Task 002: update README.md for the direct-API worker

The repository changed since README.md was written:
- `worker.mjs` is now the main worker. It calls the Claude Messages API directly with `@anthropic-ai/sdk`
  (manual tool loop, Anthropic-defined `bash_20250124` and `text_editor_20250728` tools implemented locally),
  computes cost from token usage with the `PRICES` table, and stops at the USD budget. It does not use the Claude Code binary.
- `worker-agent-sdk.mjs` is the older alternative on the Claude Agent SDK. Its traffic is billed as Claude Code usage,
  so plan-included API credits do not cover it.
- The guard moved to `guard.mjs` (shared by both workers); `guard-test.mjs` imports it.

Read `worker.mjs`, `worker-agent-sdk.mjs`, `guard.mjs`, `guard-test.mjs`, `package.json` and the current `README.md`.
Update `README.md` so it accurately describes the current code. Keep the existing tone (plain, specific, no emoji)
and keep the honest "Limits" section. In particular:
1. Main sections describe `worker.mjs`. Add a short "Agent SDK variant" section for `worker-agent-sdk.mjs`, including the billing note.
2. Explain how the direct worker applies the guard (bash calls checked as Bash, editor `view` as Read, other editor commands as Write),
   that each bash call runs in a fresh shell in the repo root (Git Bash on Windows when found, else PowerShell), the 10-minute
   command timeout, the 30,000-character tool output clip, and that it loads `AGENTS.md`/`CLAUDE.md` from the repo into the system prompt.
3. Explain that cost is estimated from usage × the `PRICES` table (cache writes at 1.25× input) and that unknown models are rejected.
4. Update the options table (the `--dry-check` cap is now US$0.05 and needs no `--brief`/`--cwd`).
5. Update `package.json` "check" script to `node worker.mjs --dry-check` (this is the only change allowed outside README.md).

Do not change any other file. Run `npm test` and `node --check worker.mjs` at the end and put the results in the report.
