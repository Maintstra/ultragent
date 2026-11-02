// Local coding worker on the Claude Messages API (no Claude Code binary).
// A manager writes a Markdown brief; the worker runs it in one repo directory,
// under a USD budget and a tool guard, then writes a report and stops.
// Exports runWorker(options); bin/ultragent.mjs and the root worker.mjs wrapper call it.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { makeGuard } from './guard.mjs';
import { costsPath, ensureHome, loadKey, runsDir } from './config.mjs';

// USD per million tokens: input, output, cache read. Cache writes (5-minute TTL) cost 1.25x input.
const PRICES = {
  'claude-sonnet-5-5': [2, 10, 0.2],
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-haiku-5-5': [0.1, 0.5, 0.01],
};
const MAX_TOOL_OUTPUT = 30_000;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

// Legacy flag parser used by the root worker.mjs wrapper.
export function parseArgs(argv) {
  const out = { allowDirs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--brief') out.brief = next();
    else if (a === '--cwd') out.cwd = next();
    else if (a === '--budget') out.budget = Number(next());
    else if (a === '--model') out.model = next();
    else if (a === '--max-turns') out.maxTurns = Number(next());
    else if (a === '--report') out.report = next();
    else if (a === '--allow-dir') out.allowDirs.push(next());
    else if (a === '--dry-check') out.dryCheck = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

function normalize(options) {
  const out = {
    ...options,
    allowDirs: options.allowDirs ?? [],
    budget: options.budget ?? 5,
    model: options.model ?? 'claude-sonnet-5-5',
    maxTurns: options.maxTurns ?? 200,
  };
  if (!out.dryCheck && (!out.brief || !out.cwd)) throw new Error('--brief and --cwd are required');
  if (!(out.budget > 0 && out.budget <= 50)) throw new Error('--budget must be between 0 and 50 USD');
  if (!(Number.isInteger(out.maxTurns) && out.maxTurns > 0)) throw new Error('--max-turns must be a positive integer');
  if (!PRICES[out.model]) throw new Error(`No price table for ${out.model}; add it to PRICES first`);
  return out;
}

function costOf(model, u) {
  const [inp, out, read] = PRICES[model];
  return ((u.input_tokens ?? 0) * inp + (u.cache_creation_input_tokens ?? 0) * inp * 1.25
    + (u.cache_read_input_tokens ?? 0) * read + (u.output_tokens ?? 0) * out) / 1e6;
}

function clip(text) {
  return text.length > MAX_TOOL_OUTPUT
    ? `${text.slice(0, MAX_TOOL_OUTPUT / 2)}\n…[${text.length - MAX_TOOL_OUTPUT} characters cut]…\n${text.slice(-MAX_TOOL_OUTPUT / 2)}`
    : text;
}

function findShell() {
  if (process.platform !== 'win32') return { file: 'bash', args: (c) => ['-lc', c] };
  for (const p of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']) {
    if (existsSync(p)) return { file: p, args: (c) => ['-lc', c] };
  }
  return { file: 'powershell.exe', args: (c) => ['-NoProfile', '-NonInteractive', '-Command', c] };
}

function runCommand(shell, command, cwd) {
  const r = spawnSync(shell.file, shell.args(command), { cwd, encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { text: `error: ${r.error.message}`, isError: true };
  const text = [r.stdout, r.stderr].filter(Boolean).join(r.stdout && r.stderr ? '\n[stderr]\n' : '') || '(no output)';
  return { text: clip(`${text}\n[exit code ${r.status ?? 'killed'}]`), isError: r.status !== 0 };
}

// Client-side implementation of the text_editor_20250728 tool.
function runEditor(input, cwd) {
  const path = resolve(cwd, String(input.path ?? ''));
  switch (input.command) {
    case 'view': {
      if (!existsSync(path)) return { text: `${path} does not exist`, isError: true };
      if (statSync(path).isDirectory()) {
        const names = readdirSync(path, { withFileTypes: true })
          .filter((d) => !['node_modules', '.git'].includes(d.name))
          .map((d) => (d.isDirectory() ? `${d.name}/` : d.name));
        return { text: names.join('\n') || '(empty)' };
      }
      const lines = readFileSync(path, 'utf8').split('\n');
      const [from, to] = Array.isArray(input.view_range) ? input.view_range : [1, lines.length];
      const end = to === -1 ? lines.length : Math.min(to, lines.length);
      return { text: clip(lines.slice(from - 1, end).map((l, i) => `${from + i}\t${l}`).join('\n')) };
    }
    case 'create': {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, String(input.file_text ?? ''));
      return { text: `Created ${path}` };
    }
    case 'str_replace': {
      if (!existsSync(path)) return { text: `${path} does not exist`, isError: true };
      const text = readFileSync(path, 'utf8');
      const oldStr = String(input.old_str ?? '');
      const count = oldStr ? text.split(oldStr).length - 1 : 0;
      if (count !== 1) return { text: `old_str must occur exactly once; found ${count} matches`, isError: true };
      writeFileSync(path, text.replace(oldStr, () => String(input.new_str ?? '')));
      return { text: `Edited ${path}` };
    }
    case 'insert': {
      if (!existsSync(path)) return { text: `${path} does not exist`, isError: true };
      const lines = readFileSync(path, 'utf8').split('\n');
      const at = Number(input.insert_line ?? 0);
      if (at < 0 || at > lines.length) return { text: `insert_line out of range (0-${lines.length})`, isError: true };
      lines.splice(at, 0, ...String(input.insert_text ?? input.new_str ?? '').split('\n'));
      writeFileSync(path, lines.join('\n'));
      return { text: `Inserted into ${path}` };
    }
    default:
      return { text: `Unsupported command: ${input.command}`, isError: true };
  }
}

function projectInstructions(cwd) {
  const parts = [];
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const p = join(cwd, name);
    if (existsSync(p)) parts.push(`## ${name}\n${readFileSync(p, 'utf8').slice(0, 40_000)}`);
  }
  return parts.join('\n\n');
}

function systemPrompt(cwd, shell) {
  return `You are a background coding worker. A manager wrote the task brief and will review your work.
Environment: ${process.platform}, repository root ${cwd}. Each bash call starts fresh in the repository root (shell: ${basename(shell.file)}); use paths relative to it or absolute paths.
Rules:
- Work only inside the repository. Follow its project instructions below.
- Do not push, publish, deploy, send messages, download from the network or touch credentials or .env files. If the brief needs that, stop and say so in the report.
- Keep changes focused on the brief. Read before you edit. Run the relevant tests and typecheck before finishing.
- If you are blocked or the brief is ambiguous, write the question in the report instead of guessing.
- Finish by writing the report file you were given (max 30 lines): what changed (files), test results, open questions. Then reply with a one-line summary and stop calling tools.

# Project instructions
${projectInstructions(cwd) || '(none found)'}`;
}

export async function runWorker(options) {
  const args = normalize(options);
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: loadKey(), maxRetries: 4 });
  ensureHome();
  const cwd = resolve(args.cwd ?? process.cwd());
  const briefPath = args.brief ? resolve(args.brief) : null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(runsDir(), `${stamp}-${briefPath ? basename(briefPath, '.md') : 'dry-check'}`);
  mkdirSync(runDir, { recursive: true });
  const reportPath = resolve(args.report ?? join(runDir, 'report.md'));
  const writableRoots = [cwd, dirname(reportPath), runDir, ...args.allowDirs.map((d) => resolve(d))];
  const guard = makeGuard(writableRoots);
  const logPath = join(runDir, 'events.jsonl');
  const log = (obj) => appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), ...obj }) + '\n');

  const shell = findShell();
  const budget = args.dryCheck ? 0.05 : args.budget;
  log({ event: 'start', cwd, brief: briefPath, model: args.model, budget, report: reportPath });

  const tools = [
    { type: 'bash_20250124', name: 'bash' },
    { type: 'text_editor_20250728', name: 'str_replace_based_edit_tool', max_characters: MAX_TOOL_OUTPUT },
  ];
  const messages = [{
    role: 'user',
    content: args.dryCheck
      ? 'Reply with the single word READY. Do not use any tools.'
      : `${readFileSync(briefPath, 'utf8')}\n\n---\nRepository: ${cwd}\nWrite your final report to: ${reportPath}`,
  }];
  const system = systemPrompt(cwd, shell);

  let cost = 0;
  let turns = 0;
  let outcome = 'error_max_turns';
  let lastText = '';
  const started = Date.now();
  try {
    while (turns < (args.dryCheck ? 1 : args.maxTurns)) {
      turns++;
      const response = await client.messages.create({
        model: args.model,
        max_tokens: 16000,
        system,
        tools,
        messages,
        cache_control: { type: 'ephemeral' },
      });
      cost += costOf(args.model, response.usage);
      lastText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') || lastText;
      messages.push({ role: 'assistant', content: response.content });
      log({ event: 'turn', turn: turns, stop: response.stop_reason, cost: Number(cost.toFixed(4)), usage: response.usage });

      if (response.stop_reason === 'refusal') { outcome = 'refusal'; break; }
      if (response.stop_reason === 'pause_turn') continue;
      const calls = response.content.filter((b) => b.type === 'tool_use');
      if (response.stop_reason === 'end_turn' || calls.length === 0) { outcome = 'success'; break; }
      if (cost >= budget) { outcome = 'error_max_budget_usd'; break; }

      const results = [];
      for (const call of calls) {
        const input = call.input ?? {};
        let res;
        if (call.name === 'bash') {
          const why = input.restart ? null : guard('Bash', { command: input.command });
          res = input.restart ? { text: 'Each command already runs in a fresh shell.' } : why ? { text: `Blocked: ${why}`, isError: true } : runCommand(shell, String(input.command ?? ''), cwd);
          log({ event: why ? 'blocked' : 'tool', name: 'bash', input: String(input.command ?? '').slice(0, 300), why: why ?? undefined });
        } else if (call.name === 'str_replace_based_edit_tool') {
          const path = resolve(cwd, String(input.path ?? ''));
          const why = guard(input.command === 'view' ? 'Read' : 'Write', { file_path: path });
          res = why ? { text: `Blocked: ${why}`, isError: true } : runEditor(input, cwd);
          log({ event: why ? 'blocked' : 'tool', name: `editor.${input.command}`, input: path, why: why ?? undefined });
        } else {
          res = { text: `Unknown tool ${call.name}`, isError: true };
        }
        results.push({ type: 'tool_result', tool_use_id: call.id, content: res.text, is_error: res.isError || undefined });
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (err) {
    outcome = 'error';
    lastText = err.message;
    log({ event: 'error', message: err.message });
  }

  const minutes = (Date.now() - started) / 60000;
  log({ event: 'result', outcome, cost: Number(cost.toFixed(4)), turns, minutes: Number(minutes.toFixed(1)) });
  const costsCsv = costsPath();
  if (!existsSync(costsCsv)) writeFileSync(costsCsv, 'finished_at,brief,model,outcome,turns,minutes,cost_usd\n');
  appendFileSync(costsCsv, [new Date().toISOString(), briefPath ? basename(briefPath) : 'dry-check', args.model, outcome,
    turns, minutes.toFixed(1), cost.toFixed(4)].join(',') + '\n');

  return { outcome, costUsd: Number(cost.toFixed(4)), turns, report: reportPath, runDir, summary: lastText.slice(0, 300) };
}
