#!/usr/bin/env node
// Compatibility wrapper: `node worker.mjs --brief ... --cwd ...` still works.
// The logic lives in src/worker.mjs (also used by bin/ultragent.mjs).
//
// Usage:
//   node worker.mjs --brief path/to/brief.md --cwd path/to/repo [--budget 5]
//                   [--model claude-sonnet-5-5] [--max-turns 200] [--report out.md]
//                   [--allow-dir extra/writable/dir] [--dry-check]
import { parseArgs, runWorker } from './src/worker.mjs';

try {
  const result = await runWorker(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result));
  process.exitCode = result.outcome === 'success' ? 0 : 1;
} catch (err) {
  console.error(`worker failed: ${err.message}`);
  process.exitCode = 2;
}
