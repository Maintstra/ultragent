#!/usr/bin/env node
// ultragent CLI: init | run | check | costs | config
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  SETTINGS, configPath, costsPath, hasKeyFile, keyPath, loadSettings, maskKey, monthToDate, parseCap,
  readCostRows, runsDir, saveKey, saveSettings,
} from '../src/config.mjs';

const MAIN_HELP = `ultragent - run a Markdown brief with a budget-capped, guarded coding agent on the Claude API

Usage:
  ultragent init                      Ask for your Claude API key (hidden input), save it, pick your plan, run a dry check
  ultragent run <brief.md> [options]  Run a brief in a directory under a USD budget
  ultragent check                     Dry check only (about US$0.005)
  ultragent steer "<note>" [--run d]  Send a note to a running worker; it reads it with its next tool results
  ultragent costs                     Show the last 10 runs, the month-to-date total, the cap and what is left
  ultragent config                    Show settings; "config set monthly-cap|default-budget <usd>" changes them

Run "ultragent <command> --help" for details.
Files live in ~/.ultragent (override with ULTRAGENT_HOME).
Not affiliated with Anthropic.
`;

const HELP = {
  init: `Usage: ultragent init

Prompts for your Claude API key (input hidden; it must start with sk-ant-), saves it to
~/.ultragent/.env (mode 0600), asks which plan you are on to set the monthly cap
([1] Max US$100, [2] Ultra US$200, [3] your own number), then runs a dry check (about US$0.005).
If a key is already saved you are asked before it is replaced.
`,
  run: `Usage: ultragent run <brief.md> [options]

Options:
  --cwd <dir>         Directory the agent works in (default: current directory)
  --budget <usd>      Hard cost cap, above 0 and at most 50 (default: the default-budget setting, 1)
  --model <id>        Model ID with a known price (default: claude-sonnet-5-5)
  --max-turns <n>     Maximum number of API responses (default: 200)
  --report <path>     Where the agent writes its report (default: in the run directory)
  --allow-dir <dir>   Extra writable directory; may be repeated
  --command-timeout <s>  Stop any single shell command (and its child processes) after this many seconds (default: 120)
  -h, --help          Show this help

While it runs, "ultragent steer <note>" sends it a correction without stopping it.
Refuses to start if month-to-date spend plus --budget would exceed the monthly cap
(see "ultragent config"); otherwise the effective budget is min(--budget, cap - month-to-date).
Prints a short summary (outcome, cost, turns, report path) followed by a JSON line.
Exit code: 0 on success, 1 for any other outcome, 2 if the run could not start.
`,
  check: `Usage: ultragent check

Sends a one-word prompt with no tools (1 turn, capped at US$0.05, typically about US$0.005)
to verify your key and setup.
`,
  steer: `Usage: ultragent steer "<note>" [--run <run-dir>]

Writes the note to steer.md in the run directory (default: the most recent run). The running worker
receives it together with its next tool results, follows it, and the file is renamed so it is delivered once.
`,
  costs: `Usage: ultragent costs

Prints the last 10 rows of ~/.ultragent/costs.csv as a table and the current-month total,
then the local monthly cap and the amount remaining.
`,
  config: `Usage: ultragent config
       ultragent config set monthly-cap <usd>      Local cap on month-to-date spend (default 100; 0 = no cap)
       ultragent config set default-budget <usd>   Budget for "run" without --budget (default 1; above 0, at most 50)

Settings are saved in ~/.ultragent/config.json (mode 0600). The cap counts only what ultragent
itself spent (from costs.csv, current UTC month); other usage on the same key is not included.
`,
};

const redact = (text) => String(text).replace(/sk-ant-[A-Za-z0-9_-]+/g, (m) => maskKey(m));
const usd = (n) => `US$${Number(n).toFixed(2)}`;
const usd4 = (n) => `US$${Number(n).toFixed(4)}`;
const capText = (cap) => (cap > 0 ? usd(cap) : 'no local cap');

function fail(message, code = 1, help = MAIN_HELP) {
  console.error(`${message}\n`);
  console.error(help);
  process.exitCode = code;
}

function parse(cmd, args, options) {
  return parseArgs({ args, options: { help: { type: 'boolean', short: 'h' }, ...options }, allowPositionals: true });
}

async function dryCheck() {
  const { runWorker } = await import('../src/worker.mjs');
  const r = await runWorker({ dryCheck: true });
  if (r.outcome === 'success') console.log(`Dry check OK (cost US$${r.costUsd.toFixed(4)}).`);
  else console.log(`Dry check FAILED (${r.outcome}): ${redact(r.summary)}`);
  return r.outcome === 'success';
}

// readline with muted output, so the pasted key is not echoed. Lines are queued so that
// piped input (several lines arriving at once) is not lost between questions.
function makeAsker() {
  let muted = false;
  const output = new Writable({
    write(chunk, enc, cb) { if (!muted) process.stdout.write(chunk, enc); cb(); },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
  const lines = [];
  const waiting = [];
  let closed = false;
  rl.on('line', (line) => (waiting.length ? waiting.shift().res(line) : lines.push(line)));
  rl.on('close', () => { closed = true; while (waiting.length) waiting.shift().rej(new Error('Input ended before an answer was given')); });
  const ask = (prompt, hidden = false) => new Promise((res, rej) => {
    process.stdout.write(prompt);
    const done = (answer) => { muted = false; if (hidden && process.stdin.isTTY) process.stdout.write('\n'); res(answer); };
    if (lines.length) return done(lines.shift());
    if (closed) return rej(new Error('Input ended before an answer was given'));
    muted = hidden;
    waiting.push({ res: done, rej });
  });
  return { ask, close: () => rl.close() };
}

// Plan question after the key is saved. An empty answer (or ended input) keeps the current cap (100 by default).
async function askPlan(ask) {
  console.log('\nWhich plan are you on?\n  [1] Max (US$100/month credit)\n  [2] Ultra (US$200/month)\n  [3] Other / set my own cap');
  const answer = async (prompt) => { try { return (await ask(prompt)).trim(); } catch { return ''; } };
  const current = loadSettings().monthlyCap;
  const choice = await answer('Choice [1]: ');
  let cap;
  if (choice === '') cap = current;
  else if (choice === '1') cap = 100;
  else if (choice === '2') cap = 200;
  else if (choice === '3') {
    const typed = await answer('Monthly cap in USD (0 = no cap): ');
    try { cap = parseCap(typed); } catch (err) { console.error(`${err.message} Keeping ${capText(current)}.`); return; }
  } else { console.error(`Unknown choice "${choice}". Keeping ${capText(current)}.`); return; }
  saveSettings({ monthlyCap: cap });
  console.log(`Monthly cap set to ${capText(cap)}. Change it any time with "ultragent config set monthly-cap <usd>".`);
}

async function cmdInit(args) {
  const { values } = parse('init', args, { 'no-verify': { type: 'boolean' } });
  if (values.help) return console.log(HELP.init);
  const { ask, close } = makeAsker();
  try {
    if (hasKeyFile()) {
      const yes = (await ask(`A key already exists in ${keyPath()}. Replace it? [y/N] `)).trim().toLowerCase();
      if (yes !== 'y' && yes !== 'yes') { console.log('Keeping the existing key.'); return; }
    }
    const key = (await ask('Paste your Claude API key (input hidden): ', true)).trim();
    if (!key.startsWith('sk-ant-')) { console.error('That does not look like a Claude API key (it should start with sk-ant-). Nothing was saved.'); process.exitCode = 1; return; }
    const path = saveKey(key);
    console.log(`Saved key ${maskKey(key)} to ${path}`);
    await askPlan(ask);
  } finally { close(); }
  if (values['no-verify']) return;
  console.log('Running dry check...');
  if (!(await dryCheck())) process.exitCode = 1;
}

function cmdConfig(args) {
  // No parseArgs here: a value such as -5 must reach the validator, not be read as an unknown flag.
  if (args.includes('-h') || args.includes('--help')) return console.log(HELP.config);
  const positionals = args;
  if (positionals.length === 0) {
    const s = loadSettings();
    console.log(`monthly-cap:     ${s.monthlyCap > 0 ? s.monthlyCap : '0 (no local cap)'}\ndefault-budget:  ${s.defaultBudget}\nfile:            ${configPath()}`);
    return;
  }
  const [sub, name, value, ...extra] = positionals;
  if (sub !== 'set' || !name || value === undefined || extra.length) return fail('Usage: ultragent config set <monthly-cap|default-budget> <usd>', 1, HELP.config);
  if (!Object.hasOwn(SETTINGS, name)) return fail(`Unknown setting: ${name} (use monthly-cap or default-budget).`, 1, HELP.config);
  let parsed;
  try { parsed = SETTINGS[name].parse(value); } catch (err) { return fail(err.message, 1, HELP.config); }
  saveSettings({ [SETTINGS[name].key]: parsed });
  console.log(`${name} set to ${parsed}`);
}

async function cmdCheck(args) {
  const { values } = parse('check', args, {});
  if (values.help) return console.log(HELP.check);
  if (!(await dryCheck())) process.exitCode = 1;
}

async function cmdRun(args) {
  const { values, positionals } = parse('run', args, {
    cwd: { type: 'string' }, budget: { type: 'string' }, model: { type: 'string' }, 'max-turns': { type: 'string' },
    report: { type: 'string' }, 'allow-dir': { type: 'string', multiple: true }, 'command-timeout': { type: 'string' },
  });
  if (values.help) return console.log(HELP.run);
  if (positionals.length !== 1) return fail('ultragent run needs exactly one brief file.', 1, HELP.run);
  const brief = resolve(positionals[0]);
  if (!existsSync(brief)) return fail(`Brief not found: ${brief}`, 1, HELP.run);

  // Local monthly cap: checked before the worker (and the API client) is even loaded.
  const settings = loadSettings();
  const requested = values.budget === undefined ? settings.defaultBudget : Number(values.budget);
  if (!(requested > 0 && requested <= 50)) throw new Error('--budget must be between 0 and 50 USD');
  let budget = requested;
  if (settings.monthlyCap > 0) {
    const spent = monthToDate();
    const left = settings.monthlyCap - spent.total;
    if (spent.total + requested > settings.monthlyCap + 1e-9) {
      console.error(
        `Refusing to run: month-to-date spend (${spent.label}, UTC) is ${usd4(spent.total)}, this run's budget is ${usd(requested)}, `
        + `and the monthly cap is ${usd(settings.monthlyCap)} (${usd4(Math.max(left, 0))} left).\n`
        + 'Lower --budget, wait for next month, or change the cap with "ultragent config set monthly-cap <usd>" (0 = no cap).\n'
        + 'The cap counts only what ultragent spent itself (costs.csv).',
      );
      process.exitCode = 2;
      return;
    }
    budget = Math.min(requested, left);
  }

  const { runWorker } = await import('../src/worker.mjs');
  const r = await runWorker({
    brief,
    cwd: resolve(values.cwd ?? process.cwd()),
    budget,
    model: values.model,
    maxTurns: values['max-turns'] === undefined ? undefined : Number(values['max-turns']),
    report: values.report,
    allowDirs: values['allow-dir'] ?? [],
    commandTimeout: values['command-timeout'] === undefined ? undefined : Number(values['command-timeout']),
  });
  console.log(`Outcome: ${r.outcome}\nCost:    US$${r.costUsd.toFixed(4)}\nTurns:   ${r.turns}\nReport:  ${r.report}`);
  console.log(JSON.stringify({ ...r, summary: redact(r.summary) }));
  process.exitCode = r.outcome === 'success' ? 0 : 1;
}

function printCap(mtd) {
  const { monthlyCap } = loadSettings();
  if (monthlyCap > 0) console.log(`Monthly cap: ${usd4(monthlyCap)}, remaining: ${usd4(Math.max(monthlyCap - mtd.total, 0))}`);
  else console.log('Monthly cap: none (0). Set one with "ultragent config set monthly-cap <usd>".');
  console.log('Counts only what ultragent spent itself; other usage on the same key is not included.');
}

function cmdCosts(args) {
  const { values } = parse('costs', args, {});
  if (values.help) return console.log(HELP.costs);
  const path = costsPath();
  const rows = readCostRows();
  if (!rows.length) {
    console.log(existsSync(path) ? 'No costs recorded yet.' : `No costs recorded yet (${path} does not exist).`);
    printCap(monthToDate());
    return;
  }
  const header = ['finished', 'brief', 'model', 'outcome', 'turns', 'min', 'cost USD'];
  const table = [header, ...rows.slice(-10).map((r) => [r.at.slice(0, 16).replace('T', ' '), r.brief, r.model, r.outcome, r.turns, r.minutes, Number.isFinite(r.cost) ? r.cost.toFixed(4) : '?'])];
  const widths = header.map((_, i) => Math.max(...table.map((row) => String(row[i]).length)));
  for (const row of table) console.log(row.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd());
  const mtd = monthToDate();
  console.log(`\nMonth to date (${mtd.label}, UTC): US$${mtd.total.toFixed(4)} over ${mtd.runs} run(s)`);
  printCap(mtd);
}

function cmdSteer(args) {
  const { values, positionals } = parse('steer', args, { run: { type: 'string' } });
  if (values.help) return console.log(HELP.steer);
  const note = positionals.join(' ').trim();
  if (!note) return fail('ultragent steer needs a note.', 1, HELP.steer);
  let dir = values.run ? resolve(values.run) : null;
  if (!dir) {
    const all = existsSync(runsDir()) ? readdirSync(runsDir()).filter((n) => !n.endsWith('dry-check')).sort() : [];
    if (all.length === 0) return fail('No runs found.', 1, HELP.steer);
    dir = join(runsDir(), all[all.length - 1]);
  }
  if (!existsSync(dir)) return fail(`Run directory not found: ${dir}`, 1, HELP.steer);
  const file = join(dir, 'steer.md');
  const previous = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  writeFileSync(file, previous ? `${previous}\n\n${note}\n` : `${note}\n`);
  console.log(`Queued for ${dir}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === undefined || cmd === '--help' || cmd === '-h' || cmd === 'help') return console.log(MAIN_HELP);
  const commands = { init: cmdInit, run: cmdRun, check: cmdCheck, steer: cmdSteer, costs: cmdCosts, config: cmdConfig };
  if (!Object.hasOwn(commands, cmd)) return fail(`Unknown command: ${cmd}`);
  try {
    await commands[cmd](rest);
  } catch (err) {
    if (err?.code?.startsWith?.('ERR_PARSE_ARGS')) return fail(err.message, 1, HELP[cmd]);
    console.error(`ultragent failed: ${redact(err.message)}`);
    process.exitCode = 2;
  }
}

await main();
