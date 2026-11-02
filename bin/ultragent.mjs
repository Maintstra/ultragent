#!/usr/bin/env node
// ultragent CLI: init | run | check | costs
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { costsPath, hasKeyFile, keyPath, maskKey, saveKey } from '../src/config.mjs';

const MAIN_HELP = `ultragent - run a Markdown brief with a budget-capped, guarded coding agent on the Claude API

Usage:
  ultragent init                      Ask for your Claude API key (hidden input), save it, run a dry check
  ultragent run <brief.md> [options]  Run a brief in a directory under a USD budget
  ultragent check                     Dry check only (about US$0.005)
  ultragent costs                     Show the last 10 runs and the month-to-date total

Run "ultragent <command> --help" for details.
Files live in ~/.ultragent (override with ULTRAGENT_HOME).
Not affiliated with Anthropic.
`;

const HELP = {
  init: `Usage: ultragent init

Prompts for your Claude API key (input hidden; it must start with sk-ant-), saves it to
~/.ultragent/.env (mode 0600), then runs a dry check (about US$0.005).
If a key is already saved you are asked before it is replaced.
`,
  run: `Usage: ultragent run <brief.md> [options]

Options:
  --cwd <dir>         Directory the agent works in (default: current directory)
  --budget <usd>      Hard cost cap, above 0 and at most 50 (default: 1)
  --model <id>        Model ID with a known price (default: claude-sonnet-5-5)
  --max-turns <n>     Maximum number of API responses (default: 200)
  --report <path>     Where the agent writes its report (default: in the run directory)
  --allow-dir <dir>   Extra writable directory; may be repeated
  -h, --help          Show this help

Prints a short summary (outcome, cost, turns, report path) followed by a JSON line.
Exit code: 0 on success, 1 for any other outcome, 2 if the run could not start.
`,
  check: `Usage: ultragent check

Sends a one-word prompt with no tools (1 turn, capped at US$0.05, typically about US$0.005)
to verify your key and setup.
`,
  costs: `Usage: ultragent costs

Prints the last 10 rows of ~/.ultragent/costs.csv as a table and the current-month total.
`,
};

const redact = (text) => String(text).replace(/sk-ant-[A-Za-z0-9_-]+/g, (m) => maskKey(m));

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
  } finally { close(); }
  if (values['no-verify']) return;
  console.log('Running dry check...');
  if (!(await dryCheck())) process.exitCode = 1;
}

async function cmdCheck(args) {
  const { values } = parse('check', args, {});
  if (values.help) return console.log(HELP.check);
  if (!(await dryCheck())) process.exitCode = 1;
}

async function cmdRun(args) {
  const { values, positionals } = parse('run', args, {
    cwd: { type: 'string' }, budget: { type: 'string' }, model: { type: 'string' }, 'max-turns': { type: 'string' },
    report: { type: 'string' }, 'allow-dir': { type: 'string', multiple: true },
  });
  if (values.help) return console.log(HELP.run);
  if (positionals.length !== 1) return fail('ultragent run needs exactly one brief file.', 1, HELP.run);
  const brief = resolve(positionals[0]);
  if (!existsSync(brief)) return fail(`Brief not found: ${brief}`, 1, HELP.run);
  const { runWorker } = await import('../src/worker.mjs');
  const r = await runWorker({
    brief,
    cwd: resolve(values.cwd ?? process.cwd()),
    budget: values.budget === undefined ? 1 : Number(values.budget),
    model: values.model,
    maxTurns: values['max-turns'] === undefined ? undefined : Number(values['max-turns']),
    report: values.report,
    allowDirs: values['allow-dir'] ?? [],
  });
  console.log(`Outcome: ${r.outcome}\nCost:    US$${r.costUsd.toFixed(4)}\nTurns:   ${r.turns}\nReport:  ${r.report}`);
  console.log(JSON.stringify({ ...r, summary: redact(r.summary) }));
  process.exitCode = r.outcome === 'success' ? 0 : 1;
}

// A CSV row is finished_at,brief,model,outcome,turns,minutes,cost_usd; the brief name may contain commas.
function parseCostRow(line) {
  const f = line.split(',');
  if (f.length < 7) return null;
  const tail = f.slice(-5);
  return { at: f[0], brief: f.slice(1, -5).join(','), model: tail[0], outcome: tail[1], turns: tail[2], minutes: tail[3], cost: Number(tail[4]) };
}

function cmdCosts(args) {
  const { values } = parse('costs', args, {});
  if (values.help) return console.log(HELP.costs);
  const path = costsPath();
  if (!existsSync(path)) { console.log(`No costs recorded yet (${path} does not exist).`); return; }
  const rows = readFileSync(path, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(parseCostRow).filter(Boolean);
  if (!rows.length) { console.log('No costs recorded yet.'); return; }
  const header = ['finished', 'brief', 'model', 'outcome', 'turns', 'min', 'cost USD'];
  const table = [header, ...rows.slice(-10).map((r) => [r.at.slice(0, 16).replace('T', ' '), r.brief, r.model, r.outcome, r.turns, r.minutes, Number.isFinite(r.cost) ? r.cost.toFixed(4) : '?'])];
  const widths = header.map((_, i) => Math.max(...table.map((row) => String(row[i]).length)));
  for (const row of table) console.log(row.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd());
  const now = new Date();
  const month = rows.filter((r) => { const d = new Date(r.at); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && Number.isFinite(r.cost); });
  const total = month.reduce((sum, r) => sum + r.cost, 0);
  console.log(`\nMonth to date (${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}): US$${total.toFixed(4)} over ${month.length} run(s)`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === undefined || cmd === '--help' || cmd === '-h' || cmd === 'help') return console.log(MAIN_HELP);
  const commands = { init: cmdInit, run: cmdRun, check: cmdCheck, costs: cmdCosts };
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
