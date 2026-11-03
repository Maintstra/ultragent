import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCommand, takeSteer, STEER_FILE } from '../src/worker.mjs';

const BIN = fileURLToPath(new URL('../bin/ultragent.mjs', import.meta.url));
const shell = process.platform === 'win32'
  ? { file: 'C:\\Program Files\\Git\\bin\\bash.exe', args: (c) => ['-lc', c] }
  : { file: 'bash', args: (c) => ['-lc', c] };

test('a command that outlives its timeout is stopped with its child processes', async () => {
  const started = Date.now();
  // The grandchild sleep keeps the pipe open; a sync spawn would wait for it.
  const r = await runCommand(shell, 'echo before; (sleep 60; echo late) & sleep 60', tmpdir(), 15);
  const seconds = (Date.now() - started) / 1000;
  assert.ok(seconds < 30, `took ${seconds}s`);
  assert.match(r.text, /before/);
  assert.match(r.text, /timed out after 15s/);
  assert.doesNotMatch(r.text, /late/);
  assert.equal(r.isError, true);
});

test('a normal command returns its output and exit code', async () => {
  const r = await runCommand(shell, 'echo hello; exit 3', tmpdir(), 30);
  assert.match(r.text, /hello/);
  assert.match(r.text, /\[exit code 3\]/);
  assert.equal(r.isError, true);
});

test('a steer note is delivered once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ua-steer-'));
  assert.equal(takeSteer(dir, 1), null);
  writeFileSync(join(dir, STEER_FILE), '  Write the scripts now.  \n');
  assert.equal(takeSteer(dir, 2), 'Write the scripts now.');
  assert.equal(existsSync(join(dir, STEER_FILE)), false);
  assert.equal(existsSync(join(dir, 'steer-2.delivered.md')), true);
  assert.equal(takeSteer(dir, 3), null);
});

test('ultragent steer writes to the newest run and appends notes', () => {
  const home = mkdtempSync(join(tmpdir(), 'ua-home-'));
  for (const name of ['2026-11-01T00-00-00-000Z-old', '2026-11-02T00-00-00-000Z-new']) mkdirSync(join(home, 'runs', name), { recursive: true });
  const env = { ...process.env, ULTRAGENT_HOME: home };
  const run = (...a) => spawnSync(process.execPath, [BIN, 'steer', ...a], { env, encoding: 'utf8' });
  assert.equal(run('first note').status, 0);
  assert.equal(run('second', 'note').status, 0);
  const file = join(home, 'runs', '2026-11-02T00-00-00-000Z-new', 'steer.md');
  assert.equal(readFileSync(file, 'utf8'), 'first note\n\nsecond note\n');
  assert.notEqual(run().status, 0);
});

test('month-to-date counts runs that were killed before writing costs.csv', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ua-mtd-'));
  process.env.ULTRAGENT_HOME = home;
  const { monthToDate } = await import(`../src/config.mjs?mtd=${Date.now()}`);
  mkdirSync(join(home, 'runs', 'killed'), { recursive: true });
  writeFileSync(join(home, 'runs', 'killed', 'cost.json'), JSON.stringify({ cost: 4.48, turns: 90, final: false }));
  mkdirSync(join(home, 'runs', 'done'), { recursive: true });
  writeFileSync(join(home, 'runs', 'done', 'cost.json'), JSON.stringify({ cost: 9, turns: 9, final: true }));
  const mtd = monthToDate();
  assert.equal(mtd.unfinished, 1);
  assert.ok(Math.abs(mtd.total - 4.48) < 1e-9);
  delete process.env.ULTRAGENT_HOME;
});
