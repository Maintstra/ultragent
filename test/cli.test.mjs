import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/ultragent.mjs', import.meta.url));
const KEY_FILE = '.' + 'env';
const FAKE_KEY = 'sk-ant-fake-test-key-abcd';

function cli(args, { home, input } = {}) {
  const childEnv = { ...process['env'], ULTRAGENT_HOME: home, ANTHROPIC_API_KEY: '' };
  delete childEnv.AGENT_WORKER_ENV;
  return spawnSync(process.execPath, [BIN, ...args], { env: childEnv, input, encoding: 'utf8' });
}
const tempHome = () => join(mkdtempSync(join(tmpdir(), 'ultragent-test-')), 'home');

test('--help shows usage for the main command and each subcommand', () => {
  const home = tempHome();
  const main = cli(['--help'], { home });
  assert.equal(main.status, 0);
  for (const word of ['init', 'run', 'check', 'costs']) assert.match(main.stdout, new RegExp(`ultragent ${word}`));
  assert.match(main.stdout, /Not affiliated with Anthropic/);
  for (const [cmd, text] of [['init', /Usage: ultragent init/], ['run', /--budget/], ['check', /Usage: ultragent check/], ['costs', /current-month total/]]) {
    const r = cli([cmd, '--help'], { home });
    assert.equal(r.status, 0, cmd);
    assert.match(r.stdout, text);
  }
});

test('unknown command exits 1 and prints usage', () => {
  const r = cli(['frobnicate'], { home: tempHome() });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown command: frobnicate/);
  assert.match(r.stderr, /Usage:/);
});

test('init --no-verify saves the key without printing it', () => {
  const home = tempHome();
  const r = cli(['init', '--no-verify'], { home, input: `${FAKE_KEY}\n` });
  assert.equal(r.status, 0, r.stderr);
  const file = join(home, KEY_FILE);
  assert.equal(readFileSync(file, 'utf8'), `ANTHROPIC_API_KEY=${FAKE_KEY}\n`);
  assert.match(r.stdout, /…abcd/);
  assert.ok(!(r.stdout + r.stderr).includes(FAKE_KEY));
  assert.ok(!(r.stdout + r.stderr).includes(FAKE_KEY.slice(0, -4)));
  if (process.platform !== 'win32') {
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(home).mode & 0o777, 0o700);
  }
});

test('init rejects a key without the sk-ant- prefix and saves nothing', () => {
  const home = tempHome();
  const r = cli(['init', '--no-verify'], { home, input: 'not-a-key\n' });
  assert.equal(r.status, 1);
  assert.ok(!existsSync(join(home, KEY_FILE)));
});

test('init asks before replacing an existing key', () => {
  const home = tempHome();
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, KEY_FILE), 'ANTHROPIC_API_KEY=sk-ant-old-key-1111\n');
  const keep = cli(['init', '--no-verify'], { home, input: `n\n${FAKE_KEY}\n` });
  assert.equal(keep.status, 0);
  assert.match(readFileSync(join(home, KEY_FILE), 'utf8'), /1111/);
  const replace = cli(['init', '--no-verify'], { home, input: `y\n${FAKE_KEY}\n` });
  assert.equal(replace.status, 0);
  assert.match(readFileSync(join(home, KEY_FILE), 'utf8'), /abcd/);
});

test('costs handles a missing file and prints a table with a month total', () => {
  const home = tempHome();
  const missing = cli(['costs'], { home });
  assert.equal(missing.status, 0);
  assert.match(missing.stdout, /No costs recorded yet/);

  mkdirSync(home, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(join(home, 'costs.csv'),
    'finished_at,brief,model,outcome,turns,minutes,cost_usd\n'
    + '2020-01-01T00:00:00.000Z,old,claude-sonnet-5-5,success,1,0.1,9.0000\n'
    + `${now},a,b.md,claude-sonnet-5-5,success,3,0.5,0.2500\n`);
  const r = cli(['costs'], { home });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /a,b\.md/);
  assert.match(r.stdout, /Month to date .*US\$0\.2500 over 1 run/);
  rmSync(home, { recursive: true, force: true });
});
