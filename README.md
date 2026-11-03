# ultragent

English | [简体中文](README.zh-CN.md)

Claude Max and Ultra plans include monthly API credits (Max US$100, Ultra US$200, claimed under claude.ai Settings → Billing → API credits → Link organization) that cannot be used in Claude Code. ultragent lets you spend them on real coding work locally, with a hard cap.

Give a Markdown brief to a coding agent that runs on your own machine, inside one directory, under a USD budget and a tool guard. It writes a report and stops.

```
ultragent init
ultragent run brief.md
```

Not affiliated with or endorsed by Anthropic. You need your own Claude API key.

## Why

- **Local.** The agent runs on your machine, in the directory you point it at. Your code is not copied anywhere except to the model API as part of normal tool use.
- **Direct API.** ultragent calls the Claude Messages API with `@anthropic-ai/sdk` and runs its own tool loop. It does not use the Claude Code binary or the Claude Agent SDK, so usage is billed as ordinary API usage on your `ANTHROPIC_API_KEY`.
- **Hard monthly USD cap (local).** A cap on month-to-date spend, enforced from `costs.csv` before every run (default 100; see "Monthly cap").
- **Hard per-task USD cap.** It adds up the estimated cost of every response and stops when the total reaches the budget (default 1 for `ultragent run`, or your `default-budget` setting; maximum 50). See "Cost and budget" for how the estimate works and where it can overshoot.
- **Key isolation.** The key is stored in `~/.ultragent/.env` and passed only to the API client. It is not exported to your shell.
- **Cost log.** Every run appends a line to `~/.ultragent/costs.csv`: finish time, brief name, model, outcome, turns, minutes, cost in USD.

## Quick start

Requires Node 18 or newer. Install it once from GitHub:

```
npm install -g github:Maintstra/ultragent
ultragent init     # asks for your key (hidden input), saves it, runs a dry check
ultragent run brief.md
```

`init` prompts `Paste your Claude API key (input hidden):`, checks that it starts with `sk-ant-`, saves it, asks which plan you are on (see "Monthly cap") and runs a dry check (one turn, no tools, about US$0.005). It never prints the key; it shows only "…" and the last 4 characters. If a key is already saved it asks before replacing it.

Commands:

```
ultragent init
ultragent run <brief.md> [--cwd .] [--budget 1] [--model ...] [--max-turns N] [--report path] [--allow-dir path]
ultragent check        # dry check only (about US$0.005)
ultragent costs        # last 10 rows of costs.csv as a table, plus the month-to-date total, the cap and what is left
ultragent config       # show settings; "config set monthly-cap <usd>" / "config set default-budget <usd>" change them
ultragent --help       # or: ultragent <command> --help
```

`run` prints a short summary (outcome, cost, turns, report path), then a JSON line with the outcome, cost, turns, report path, run directory and the first 300 characters of the model's last text. Exit code is 0 on `success`, 1 for any other outcome, 2 if the run fails to start (bad arguments, missing key). Unknown commands exit with 1 and print usage.

Outcomes: `success`, `error_max_turns`, `error_max_budget_usd`, `error_context_limit` (see "Looking at images"), `refusal`, `error` (API or other exception; the message is in the summary and in `events.jsonl`).

### Where files go

| Path | Content |
| --- | --- |
| `~/.ultragent/.env` | `ANTHROPIC_API_KEY=...` (directory mode 0700, file mode 0600; on Windows chmod is best effort) |
| `~/.ultragent/runs/<timestamp>-<brief name>/` | `events.jsonl` (start, each turn with usage and running cost, each tool call, blocked calls, errors, result) and the default `report.md` |
| `~/.ultragent/costs.csv` | one line per run |
| `~/.ultragent/config.json` | local settings: `monthlyCap`, `defaultBudget` (file mode 0600) |

Set `ULTRAGENT_HOME` to use another directory. For the old development setup, if a `.env` exists in the package root and `~/.ultragent/.env` does not, the key is read from the package-root file (it is not copied or moved). `AGENT_WORKER_ENV` still overrides the key file path.

## Options (`ultragent run`)

| Flag | Default | Meaning |
| --- | --- | --- |
| `<brief.md>` | required | Markdown brief to run. |
| `--cwd <path>` | current directory | Directory the agent works in. |
| `--budget <usd>` | `default-budget` setting (`1`) | Hard cost cap for the run. Must be above 0 and at most 50. Also limited by the monthly cap. |
| `--model <id>` | `claude-sonnet-5-5` | Model ID. Must be in the `PRICES` table in `src/worker.mjs`; any other model is rejected at startup. |
| `--max-turns <n>` | `200` | Maximum number of API responses. |
| `--report <path>` | `report.md` in the run directory | Where the agent is told to write its report. Its directory becomes writable. |
| `--allow-dir <path>` | none | Extra writable directory. Can be given more than once. |

Unknown flags cause an error.

### Developing from a clone

`node worker.mjs --brief brief.md --cwd path/to/repo [--budget 5] [--dry-check] ...` still works as a thin wrapper over the same code (its default budget is 5, and it needs `--brief` and `--cwd` unless `--dry-check`). `npm test` runs the guard tests and the CLI tests; `npm run check` runs the dry check.

## Monthly cap

Plan-included API credits differ by plan (see Anthropic's "API credits for Max, Ultra, and Team plans" page):

| Plan | Included API credit |
| --- | --- |
| Max | US$100 per month |
| Ultra | US$200 per month |

An API key cannot tell ultragent which plan you are on or how much credit is left, so you set a local monthly cap and ultragent enforces it from `costs.csv`.

```
ultragent config                          # print the current settings
ultragent config set monthly-cap 200      # US$ per UTC month; 0 = no local cap
ultragent config set default-budget 2     # budget for "run" without --budget (above 0, at most 50)
```

Settings are saved in `~/.ultragent/config.json` (mode 0600; same home rules as the key, so `ULTRAGENT_HOME` applies). Invalid values are rejected and nothing is saved.

| Setting | Default |
| --- | --- |
| `monthly-cap` | `100` (US$; `0` = no local cap) |
| `default-budget` | `1` (US$) |

- `init` asks "Which plan are you on? [1] Max (US$100/month credit) [2] Ultra (US$200/month) [3] Other / set my own cap" and sets `monthly-cap` to 100, 200 or the number you type. An empty answer, or piped input that ends, keeps the current cap (100 unless you changed it).
- `run` first adds up this month's spend (current UTC month, from `costs.csv`). If that plus the run's `--budget` is over the cap, it refuses before any API call and says what was spent, what the cap is and how to change it (exit code 2). Otherwise it passes `min(--budget, cap - month-to-date)` as the effective budget, so one run can never cross the cap.
- `costs` also shows the cap and the amount remaining.

**Honest note:** ultragent only counts what it spent itself; usage from other apps on the same key is not included. Set a spend limit in the Console as well. The amounts are estimates from the local price table (see below), not the invoice.

## Cost and budget

The API returns token usage with each response; the worker multiplies it by the `PRICES` table in `src/worker.mjs` (USD per million tokens: input, output, cache read). Cache writes are charged at 1.25 times the input price. The table currently has `claude-sonnet-5-5`, `claude-opus-5-5` and `claude-haiku-5-5`. If you pass a model that is not in the table, the worker refuses to start rather than guess a price; add the model to `PRICES` first.

This is an estimate from a local table, not the invoice. If prices change or the table is wrong, the cap is wrong too. The check happens after each response and before its tool calls run: if the running total has reached the budget, the run ends with `error_max_budget_usd` and those tool calls are not executed. A single response can therefore overshoot the cap by its own cost. A response that ends the turn with no tool calls counts as `success` even if it crossed the cap.

## How the direct worker runs tools

Ultragent runs a manual loop: send the messages, read the response, execute the tool calls locally, send the results back. It uses two Anthropic-defined tools that it implements itself, plus one custom tool (`view_image`, below):

- `bash_20250124` (`bash`). Each call runs in a fresh shell started in the repository root, so `cd` and environment changes do not carry over to the next call. On Windows it uses Git Bash (`bash.exe` under `C:\Program Files\Git` or `C:\Program Files (x86)\Git`) when found, otherwise PowerShell. Elsewhere it uses `bash`. A command is killed after 10 minutes. The `restart` option does nothing except report that every command already runs in a fresh shell.
- `text_editor_20250728` (`str_replace_based_edit_tool`). Supports `view` (files with line numbers and an optional range, or a directory listing without `node_modules` and `.git`), `create`, `str_replace` (the old text must occur exactly once) and `insert`.

Tool output is clipped to 30,000 characters. Longer output keeps the first and last 15,000 characters with a note in the middle.

### Looking at images

`view_image` (input `{ "path": string, "note"?: string }`) lets the model see a screenshot or other image, for example when running GUI tests on an Android emulator through `adb`. The guard treats it as a read: `.env` files are blocked, and the path is resolved relative to the repository like the editor tool. Supported types are `.png`, `.jpg`/`.jpeg` and `.webp`. The result is an image block plus a text line with the path, the size in pixels (when it can be read from the file header) and the size in KB. `events.jsonl` logs only the path (as `editor.view_image`), never the image data.

- **5 MB limit.** A larger file is rejected with an error telling the model to downscale it first (for example `adb exec-out screencap -p` with resizing on the device side) or to view a cropped copy.
- **Cost.** Images cost more input tokens than text, and they stay in the conversation for every later turn. The system prompt tells the model to prefer text (uiautomator dumps, logs) when that answers the question.
- **Context stop.** If one request reports more than 700,000 input tokens (`input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens`), the run stops with outcome `error_context_limit` and the summary says so, so a long screenshot session cannot run away. Like the budget check, it runs after the response and before its tool calls; a response that ends the turn is still `success`.

If the model stops with `refusal`, the run ends as `refusal`; a `pause_turn` stop is continued automatically.

### Project instructions

At startup the worker reads `AGENTS.md` and `CLAUDE.md` from the root of the `--cwd` repository (each cut to 40,000 characters, if present) and puts them in the system prompt under "Project instructions". Nothing else from the repo or from user-level configuration is loaded.

## The guard

The guard is in `src/guard.mjs` (`makeGuard`) and is shared by both workers; `guard-test.mjs` imports it and `npm test` runs it. The direct worker calls it before executing every tool call:

- Each `bash` call is checked as `Bash`, with the command text.
- Editor `view` is checked as `Read`, with the resolved path.
- Every other editor command (`create`, `str_replace`, `insert`) is checked as `Write`, with the resolved path.

A blocked call is not run. The model gets `Blocked: <reason>` as an error result, and the call is logged to `events.jsonl` as `blocked`.

**Shell commands are denied if they match any of:**

- `git push`
- `git reset --hard`, `git clean -f...`, `git checkout -- <path>`, `git stash drop`, `git stash clear`
- `npm publish`, `pnpm publish`, `yarn publish`
- `eas`, `vercel`, `netlify`, `fly`, `railway`, `wrangler`, `firebase` followed by `build`, `deploy`, `submit`, `publish` or `up`
- `curl`, `wget`, `Invoke-WebRequest`, `Invoke-RestMethod`, `iwr`, `irm`
- `rm -r...` aimed at `/`, `~` or a drive root
- `Remove-Item` with `-Recurse`
- `setx`, `reg add`, `Set-ItemProperty`, `netsh`, `schtasks`
- `ssh`, `scp`, `gh pr create`, `gh release create`, `gh repo create`, `gh api`
- any command that mentions `.env` together with a reader or interpreter (`cat`, `type`, `Get-Content`, `gc`, `more`, `less`, `head`, `tail`, `grep`, `rg`, `Select-String`, `sls`, `findstr`, `node`, `python`)

**File access:**

- Writes (`create`, `str_replace`, `insert`) are denied unless the target path is inside a writable root: `--cwd`, the report's directory, the run directory, or any `--allow-dir`.
- Writes are denied for `.env` and `.env.*` files, even inside a writable root.
- Reads (`view`) are denied for `.env` and `.env.*` files. Other reads are not restricted by path.

### Limits

The guard is not a sandbox. Command matching is regex-based on the command text, so a determined model can evade it (for example by building a command indirectly, using a tool or language not in the list, or running a script it wrote earlier). Reads outside the repo are allowed, and shell commands are not confined to the writable roots; the path check applies only to the editor tool, not to what a shell command writes. Shell commands also inherit your environment variables. Run the worker on repositories you can review, keep backups or use git, and review the diff before you push anything.

## Writing a good brief

- State the goal in a sentence or two, then the concrete steps or files involved.
- Say what is out of scope and what must not be touched.
- Say how to verify: which tests, typecheck or build commands to run.
- Give any constraints the repo's `AGENTS.md` / `CLAUDE.md` does not already cover.
- Ask a question in the report rather than guessing when something is ambiguous. The worker is already told to do this.
- Keep the task small enough to fit the budget; split large work into several briefs.

The worker appends the repository path and the report path to the brief. The system prompt tells the agent the platform, repo root and shell, to work only inside the repo, not to push, publish, deploy or touch credentials, and to finish by writing a report of at most 30 lines: what changed (files), test results, and open questions.

## Use from Claude Code

This repo is also a Claude Code plugin marketplace. Install the plugin inside Claude Code:

```
/plugin marketplace add Maintstra/ultragent
/plugin install ultragent@ultragent-marketplace
```

Then ask Claude Code to hand a task off (for example `/ultragent:ultragent add input validation to the signup form`, or "use ultragent for this"). The skill makes Claude Code the manager: it writes a brief to `.ultragent/briefs/`, runs `ultragent run` with a USD budget (default 1), waits, then reads the report, checks `git diff` and `git status`, runs your tests and reviews the change. The coding itself is done by ultragent on your API key. If no key is set, the skill tells you to run `ultragent init` in your own terminal; it never asks for the key in chat.

The skill's `allowed-tools` pre-approves only `ultragent`, `git diff` and `git status` for that turn. Other commands (such as running your tests) still go through the normal permission prompts. The plugin files live in `.claude-plugin/` and `plugins/` and are not part of the npm package.


## Agent SDK variant

`worker-agent-sdk.mjs` (repository root only; not part of the npm package) is the older worker, built on the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), which runs the Claude Code engine and its built-in tools. It takes the same flags as `worker.mjs` and shares `src/guard.mjs`, but differs in these ways:

- **Billing.** Agent SDK traffic is billed as Claude Code usage, so plan-included API credits do not cover it. This is the reason the direct worker (`ultragent`) is the main one.
- **Budget.** It passes `maxBudgetUsd` to the SDK, which does its own cost accounting; there is no `PRICES` table and no model restriction.
- **Guard wiring.** The guard runs as the `canUseTool` callback and as a `PreToolUse` hook, so a project allow-rule cannot skip it. It sees the Claude Code tool names (`Bash`, `PowerShell`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `Read`).
- **Key source check.** On startup the SDK reports where its credentials came from. If that is not the worker's own `ANTHROPIC_API_KEY`, the worker throws. It also removes `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL` and the Bedrock/Vertex/Foundry switches from the child environment.
- **Settings loaded.** Only project settings (`settingSources: ['project']`): the repo's `AGENTS.md` / `CLAUDE.md` and project settings. Permission mode is `default`.
- **Dry check.** `--dry-check` still requires `--brief` and `--cwd`, and its cap is US$0.25.

Run it with `node worker-agent-sdk.mjs --brief ... --cwd ...`. It still keeps its runs, costs and key file next to the script (repository root), not in `~/.ultragent`.

## Disclaimer

This project is not affiliated with or endorsed by Anthropic. It uses the Anthropic SDK (`@anthropic-ai/sdk`) and, for the variant, the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) under their terms; you need your own API key and are responsible for the usage it incurs.

## License

MIT. See `LICENSE`.
