# Task 003: turn this repo into the `ultragent` npm CLI

The project is now named **ultragent**. Goal: a user with a Claude API key can run it with no clone:

```
npx ultragent init                 # asks for the API key (hidden input), saves it, runs a dry check
npx ultragent run brief.md [--cwd .] [--budget 1] [--model ...] [--max-turns N] [--report path] [--allow-dir path]
npx ultragent check                # dry check only (≈US$0.005)
npx ultragent costs                # prints costs.csv as a small table + month-to-date total
```

## Requirements
1. **Layout.** Create `bin/ultragent.mjs` (with shebang) as the CLI entry. Move the worker logic from `worker.mjs` into
   `src/worker.mjs`, which exports `runWorker(options)`, and move `guard.mjs` to `src/guard.mjs`. Keep `worker.mjs` at the root
   as a thin compatibility wrapper that calls the same code, so `node worker.mjs --brief ...` still works. Keep
   `worker-agent-sdk.mjs` at the root and fix its guard import path. `guard-test.mjs` must import from `src/guard.mjs`.
2. **Config directory.** Store the key, runs and costs in a per-user directory, not next to the package (npx installs into a cache):
   - default `~/.ultragent/` (`os.homedir()`), overridable with the env var `ULTRAGENT_HOME`;
   - key file `~/.ultragent/.env` (`ANTHROPIC_API_KEY=...`). Create the directory with mode 0700 and the file with mode 0600.
     On Windows, chmod is best effort; that is fine.
   - Run logs go in `~/.ultragent/runs/` and costs in `~/.ultragent/costs.csv`.
   - Backwards compatibility: if `./.env` exists next to the package root (the current dev setup) and `~/.ultragent/.env` does
     not, read the key from the package-root `.env`. Do not copy or move it.
3. **init.** Prompt `Paste your Claude API key (input hidden):` with echo off (readline with muted output, no new
   dependencies). Validate that it starts with `sk-ant-`. Write the file, then run the dry check and print the result.
   Never print the key or any part of it except "…" plus the last 4 characters. If a key already exists, ask before replacing it.
4. **run.** Default `--cwd` to `process.cwd()` and default `--budget` to 1. Print a short human summary at the end
   (outcome, cost, turns, report path), followed by the JSON line.
5. **costs.** Read costs.csv and print the last 10 rows plus the current-month total.
6. **Help.** `ultragent --help` and `ultragent <cmd> --help` show usage. Unknown commands exit with code 1 and print usage.
7. **package.json.** Set `"name": "ultragent"`, `"version": "0.1.0"`, `"bin": {"ultragent": "bin/ultragent.mjs"}`,
   `"files": ["bin","src","README.md","LICENSE"]`, `"engines": {"node": ">=18"}`, `"license": "MIT"`, keywords and a
   description. Remove `"private": true`. Do not add dependencies. Do not run `npm publish`.
8. **Tests.** Keep `npm test` passing. Add `test/cli.test.mjs` using `node:test`: help output, unknown command, an init
   simulation that writes a fake key into a temp `ULTRAGENT_HOME` without calling the API (add an internal `--no-verify`
   flag for this), and that `costs` handles a missing file. Make `npm test` run the guard tests and the CLI tests.
9. **README.md.** Update it for the `ultragent` name and the npx usage; keep the Limits section. Not affiliated with Anthropic.
10. Do not touch `.env`, `direct-test.mjs` or anything under `runs/`. Do not make network calls in tests.

Finish with `npm test`, `node --check bin/ultragent.mjs` and `node bin/ultragent.mjs --help`, and put the results in the report.
