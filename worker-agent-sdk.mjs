#!/usr/bin/env node
// Alternative worker on the Claude Agent SDK. Note: Agent SDK traffic is billed
// as Claude Code usage, so plan-included API credits do not cover it.
// Local coding worker on the Claude Agent SDK.
// A manager writes a Markdown brief; the worker runs it in one repo directory,
// under a USD budget and a tool guard, then writes a report and stops.
//
// Usage:
//   node worker-agent-sdk.mjs --brief path/to/brief.md --cwd path/to/repo [--budget 5]
//                   [--model claude-sonnet-5-5] [--max-turns 200] [--report out.md]
//                   [--allow-dir extra/writable/dir] [--dry-check]

import { query } from '@anthropic-ai/claude-agent-sdk';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { makeGuard } from './src/guard.mjs';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { budget: 5, model: 'claude-sonnet-5-5', maxTurns: 200, allowDirs: [] };
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
  if (!out.brief || !out.cwd) throw new Error('--brief and --cwd are required');
  if (!(out.budget > 0 && out.budget <= 50)) throw new Error('--budget must be between 0 and 50 USD');
  return out;
}

// The key lives only in a local .env next to this script and is passed to the
// SDK process alone. It is never exported to the parent shell or written anywhere.
function loadKey() {
  const envPath = process.env.AGENT_WORKER_ENV ?? join(HERE, '.env');
  if (!existsSync(envPath)) throw new Error(`Missing ${envPath} (put ANTHROPIC_API_KEY=... in it)`);
  const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find((l) => l.startsWith('ANTHROPIC_API_KEY='));
  const key = line?.slice('ANTHROPIC_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  if (!key || !key.startsWith('sk-ant-')) throw new Error(`No valid ANTHROPIC_API_KEY in ${envPath}`);
  return key;
}

function childEnv(key) {
  const env = { ...process.env, ANTHROPIC_API_KEY: key };
  // Make sure nothing outranks the key or silently falls back to a subscription login.
  for (const name of ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL',
    'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) delete env[name];
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'local-agent-worker/0.1';
  return env;
}

const SYSTEM_APPEND = `
You are a background coding worker. A manager wrote the task brief below and will review your work.
- Work only inside the given repository directory. Follow its AGENTS.md / CLAUDE.md.
- Do not push, publish, deploy, send messages or touch credentials. If the brief needs that, stop and say so in the report.
- Keep changes focused on the brief. Run the relevant tests and typecheck before finishing.
- If you are blocked or the brief is ambiguous, write the question in the report instead of guessing.
- Finish by writing the report file the brief or the manager asked for (max 30 lines): what changed (files), test results, open questions.`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = resolve(args.cwd);
  const briefPath = resolve(args.brief);
  const brief = readFileSync(briefPath, 'utf8');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(HERE, 'runs', `${stamp}-${basename(briefPath, '.md')}`);
  mkdirSync(runDir, { recursive: true });
  const reportPath = resolve(args.report ?? join(runDir, 'report.md'));
  const writableRoots = [cwd, dirname(reportPath), runDir, ...args.allowDirs.map((d) => resolve(d))];
  const logPath = join(runDir, 'events.jsonl');
  const log = (obj) => appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), ...obj }) + '\n');

  const guard = makeGuard(writableRoots);
  const key = loadKey();
  log({ event: 'start', cwd, brief: briefPath, model: args.model, budget: args.budget, report: reportPath });

  const prompt = args.dryCheck
    ? 'Reply with the single word READY. Do not use any tools.'
    : `${brief}\n\n---\nRepository: ${cwd}\nWrite your final report to: ${reportPath}`;

  let result = null;
  let keySource = null;
  let failure = null;
  try {
  for await (const msg of query({
    prompt,
    options: {
      cwd,
      model: args.model,
      env: childEnv(key),
      maxBudgetUsd: args.dryCheck ? 0.25 : args.budget,
      maxTurns: args.dryCheck ? 1 : args.maxTurns,
      settingSources: ['project'],
      permissionMode: 'default',
      // canUseTool answers permission prompts; the PreToolUse hook also runs when a
      // project allow-rule would skip the prompt, so the guard cannot be bypassed.
      canUseTool: async (name, input) => {
        const why = guard(name, input);
        return why ? { behavior: 'deny', message: why } : { behavior: 'allow', updatedInput: input };
      },
      hooks: {
        PreToolUse: [{
          hooks: [async (input) => {
            const why = guard(input.tool_name, input.tool_input ?? {});
            if (!why) return { continue: true };
            log({ event: 'blocked', tool: input.tool_name, why });
            return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } };
          }],
        }],
      },
      systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_APPEND },
    },
  })) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      keySource = msg.apiKeySource;
      log({ event: 'init', apiKeySource: keySource, model: msg.model });
      if (keySource !== 'ANTHROPIC_API_KEY') {
        throw new Error(`Refusing to run: credentials came from "${keySource}", not the worker's API key`);
      }
    } else if (msg.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'tool_use') log({ event: 'tool', name: block.name, input: summarise(block.input) });
      }
    } else if (msg.type === 'result') {
      result = msg;
      log({ event: 'result', subtype: msg.subtype, cost: msg.total_cost_usd, turns: msg.num_turns, ms: msg.duration_ms });
    }
  }
  } catch (err) {
    // The SDK throws on error results (e.g. budget reached) after the result
    // message arrived, so the cost is still recorded below.
    failure = err.message;
    log({ event: 'error', message: failure });
  }

  const cost = result?.total_cost_usd ?? 0;
  const costsCsv = join(HERE, 'costs.csv');
  if (!existsSync(costsCsv)) writeFileSync(costsCsv, 'finished_at,brief,model,outcome,turns,minutes,cost_usd\n');
  appendFileSync(costsCsv, [new Date().toISOString(), basename(briefPath), args.model, result?.subtype ?? 'none',
    result?.num_turns ?? 0, ((result?.duration_ms ?? 0) / 60000).toFixed(1), cost.toFixed(4)].join(',') + '\n');

  const outcome = failure ? (result?.subtype === 'success' ? 'error' : (result?.subtype ?? 'error')) : (result?.subtype ?? 'no_result');
  console.log(JSON.stringify({ outcome, costUsd: Number(cost.toFixed(4)), turns: result?.num_turns, report: reportPath, runDir, keySource, failure }));
  if (args.dryCheck) console.log(`reply: ${result?.result ?? ''}`);
  process.exitCode = outcome === 'success' ? 0 : 1;
}

function summarise(input) {
  const s = JSON.stringify(input ?? {});
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

main().catch((err) => {
  console.error(`worker failed: ${err.message}`);
  process.exitCode = 2;
});
