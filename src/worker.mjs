// Local coding worker on the Claude Messages API (no Claude Code binary).
// A manager writes a Markdown brief; the worker runs it in one repo directory,
// under a USD budget and a tool guard, then writes a report and stops.
// Exports runWorker(options); bin/ultragent.mjs and the root worker.mjs wrapper call it.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
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
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const CONTEXT_LIMIT_TOKENS = 700_000;
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

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

// Width and height from the file header, or null when not cheaply known.
function imageSize(buf, mediaType) {
  try {
    if (mediaType === 'image/png' && buf.length >= 24 && buf.toString('latin1', 12, 16) === 'IHDR') {
      return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    }
    if (mediaType === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    if (mediaType === 'image/webp' && buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
      const kind = buf.toString('latin1', 12, 16);
      if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
      if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
      if (kind === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1];
      }
    }
  } catch { /* fall through */ }
  return null;
}

// Client-side custom tool view_image. Returns { content, isError } where content is a string
// (errors) or an array of image + text blocks. The guard is applied as a Read.
export function runViewImage(input, cwd, guard) {
  const path = resolve(cwd, String(input.path ?? ''));
  const why = guard('Read', { file_path: path });
  if (why) return { path, blocked: true, content: `Blocked: ${why}`, isError: true };
  const mediaType = IMAGE_TYPES[extname(path).toLowerCase()];
  if (!mediaType) return { path, content: `Unsupported image type "${extname(path)}"; use .png, .jpg, .jpeg or .webp`, isError: true };
  if (!existsSync(path) || !statSync(path).isFile()) return { path, content: `${path} does not exist or is not a file`, isError: true };
  const bytes = statSync(path).size;
  if (bytes > MAX_IMAGE_BYTES) {
    return {
      path,
      content: `${path} is ${(bytes / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB. Downscale it first (for example capture with `
        + '`adb exec-out screencap -p` and resize on the device side, or resize with a local tool) or view a cropped copy.',
      isError: true,
    };
  }
  const buf = readFileSync(path);
  const size = imageSize(buf, mediaType);
  const label = `${input.path} (${size ? `${size[0]}x${size[1]}, ` : ''}${Math.max(1, Math.round(bytes / 1024))} KB)`;
  const note = input.note ? ` ${String(input.note).slice(0, 300)}` : '';
  return {
    path,
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') } },
      { type: 'text', text: label + note },
    ],
  };
}

// Input tokens of one request, including cached ones. True when it is over the limit.
export function contextExceeded(usage, limit = CONTEXT_LIMIT_TOKENS) {
  const u = usage ?? {};
  return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) > limit;
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
- Use view_image to look at screenshots or other images when you need to check layout or text visually. Prefer text (uiautomator dumps, logs) when it answers the question; images cost more.
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
    {
      name: 'view_image',
      description: 'Look at an image file (png, jpg, jpeg or webp, at most 5 MB), for example a screenshot. Returns the image to you.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the image, relative to the repository root or absolute.' },
          note: { type: 'string', description: 'Optional: what you want to check in the image.' },
        },
        required: ['path'],
      },
    },
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
      if (contextExceeded(response.usage)) {
        outcome = 'error_context_limit';
        lastText = `Stopped: a single request used more than ${CONTEXT_LIMIT_TOKENS.toLocaleString('en-US')} input tokens (context limit), for example after many screenshots.`;
        break;
      }
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
        } else if (call.name === 'view_image') {
          const r = runViewImage(input, cwd, guard);
          res = { text: r.content, isError: r.isError };
          log({ event: r.blocked ? 'blocked' : 'tool', name: 'editor.view_image', tool: 'view_image', input: r.path, why: r.blocked ? r.content : undefined });
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
