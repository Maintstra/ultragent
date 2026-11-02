# Task 005: monthly cap setting + Chinese README

## 1. Monthly cap (local)
Plan-included API credits differ by plan (Max: US$100/month, Ultra: US$200/month, per Anthropic's "API credits for Max,
Ultra, and Team plans" page). The API key cannot tell us the user's plan or remaining credit, so let the user set a local
monthly cap and enforce it from `costs.csv`:

- New command: `ultragent config` prints the current settings. `ultragent config set monthly-cap <usd>` and
  `ultragent config set default-budget <usd>` save them to `~/.ultragent/config.json` (same home rules as the key; mode 0600).
  `monthly-cap 0` means no local cap.
- Defaults: monthly-cap **100**, default-budget **1**.
- `init`: after saving the key, ask "Which plan are you on? [1] Max (US$100/month credit) [2] Ultra (US$200/month) [3] Other / set my own cap".
  It sets monthly-cap to 100, 200 or a number the user types. With piped stdin, an empty answer keeps 100.
- `run`: before starting, compute the month-to-date spend (current UTC month, from costs.csv). If month-to-date + this run's
  `--budget` is over the cap, refuse with a clear message: the spend so far, the cap, and how to change it.
  Also pass `min(--budget, cap - month-to-date)` as the effective budget, so one run can never cross the cap.
- `costs`: also show the cap and the remaining amount.
- README (English): document `config`, the defaults, the plan table, and an honest note: "ultragent only counts what it spent
  itself; usage from other apps on the same key is not included. Set a spend limit in the Console as well."
- Tests (no network): config set/get, an invalid value is rejected, a run is refused when the cap would be exceeded (use a temp
  ULTRAGENT_HOME with a fake costs.csv and a fake key; the refusal must happen before any API call), init plan choice via piped stdin.

## 2. Chinese README
Create `README.zh-CN.md`, a faithful Simplified Chinese version of the final README.md. Use plain, natural Chinese for
developers, not machine-translation style. Keep code blocks and commands unchanged. Keep the Limits section and the
"not affiliated with Anthropic" note. Add a line at the top of each README linking to the other language
("English | 简体中文").

At the top of the Chinese README add one short paragraph explaining the main use case: Claude Max/Ultra plans include
monthly API credits (Max US$100, Ultra US$200, claimed under claude.ai Settings → Billing → API credits → Link organization)
that cannot be used in Claude Code; ultragent lets you spend them on real coding work locally, with a hard cap.
Add the same paragraph in English to README.md.

Do not touch `.env`, `runs/` or `direct-test.mjs`. Finish with `npm test` and `node bin/ultragent.mjs --help`, and put the results in the report.
