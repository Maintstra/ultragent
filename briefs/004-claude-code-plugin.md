# Task 004: add a Claude Code plugin that dispatches work to ultragent

Goal: a Claude Code user installs the plugin from this repo; Claude Code (running on their subscription) acts as the
manager — it writes a brief, runs `npx ultragent run`, waits, then reviews the diff and the report. The coding is done by
ultragent on the user's plan-included API credits.

## Files to add (official layout; this repo is its own marketplace)
```
.claude-plugin/marketplace.json
plugins/ultragent/.claude-plugin/plugin.json
plugins/ultragent/skills/ultragent/SKILL.md
```
- `marketplace.json`:
  `{"name":"ultragent-marketplace","owner":{"name":"U Design Studio"},"plugins":[{"name":"ultragent","source":"./plugins/ultragent","description":"Hand coding tasks to ultragent, a local budget-capped worker on your Claude API credits"}]}`
- `plugin.json`: `{"name":"ultragent","version":"0.1.0","description":"...","license":"MIT"}`. Use the same description as above.
- `SKILL.md` frontmatter:
  ```yaml
  ---
  name: ultragent
  description: Delegate a well-scoped coding task to ultragent (runs locally on the user's Claude API credits with a USD cap), then review its work. Use when the user asks to hand off, delegate or "use ultragent / my API credits" for a task.
  argument-hint: "[task description]"
  allowed-tools: Bash(npx ultragent *), Bash(npx -y ultragent *), Bash(git diff *), Bash(git status *)
  ---
  ```
  Body: clear numbered instructions for Claude Code:
  1. If `npx ultragent check` fails because no key is set, tell the user to run `npx ultragent init` in their own terminal.
     Never ask for the key in chat and never write it anywhere.
  2. Write a brief to `.ultragent/briefs/<yyyymmdd-hhmm>-<slug>.md` in the current repo. The brief must contain: goal, files
     involved, out of scope, how to verify (tests/typecheck), and constraints. Keep each task small; split big work into several briefs.
  3. Run `npx ultragent run <brief> --cwd . --budget <N> --report .ultragent/reports/<same-name>.md`. N defaults to 1 USD;
     raise it only if the user agrees.
  4. When it finishes, read the report, run `git diff` and `git status`, run the project's tests, and review the change like a
     careful reviewer. Fix small issues yourself or send a follow-up brief. Report back the outcome and the cost.
  5. Never push, publish or deploy on ultragent's behalf without the user's explicit approval.
  6. Mention that `.ultragent/` can be added to `.gitignore`.
  Include the user-facing argument: if `$ARGUMENTS` is given, treat it as the task description.
- Do not use "claude" or "anthropic" in any plugin or marketplace name.

## Also
- In README.md, add a section "Use from Claude Code" with the install commands:
  `/plugin marketplace add Maintstra/ultragent` and then `/plugin install ultragent@ultragent-marketplace`. Say what the
  skill does and that `allowed-tools` pre-approves only `npx ultragent`, `git diff` and `git status` for that turn.
- Add `"plugins", ".claude-plugin"` to package.json `files`? **No** — keep them out of the npm package; they are for GitHub only.
- Add a test in `test/plugin.test.mjs` (node:test) that parses both JSON files, checks the required fields, checks that the
  names do not contain "claude"/"anthropic", and checks that SKILL.md has frontmatter with name, description and allowed-tools.

Do not touch `.env`, `runs/` or `direct-test.mjs`. Finish with `npm test` and put the results in the report.
