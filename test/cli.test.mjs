import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

// ---- config, monthly cap, plan choice ----
const COSTS_HEADER = 'finished_at,brief,model,outcome,turns,minutes,cost_usd\n';
function seed(home, spent) {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, KEY_FILE), `ANTHROPIC_API_KEY=${FAKE_KEY}\n`);
  writeFileSync(join(home, 'costs.csv'), COSTS_HEADER
    + '2020-01-01T00:00:00.000Z,old.md,claude-sonnet-5-5,success,1,0.1,50.0000\n'
    + `${new Date().toISOString()},now.md,claude-sonnet-5-5,success,3,0.5,${spent.toFixed(4)}\n`);
}
const briefFile = (home) => { const f = join(home, 'brief.md'); writeFileSync(f, 'Say hi.\n'); return f; };

test('config shows defaults, set saves to config.json, 0 means no cap', () => {
  const home = tempHome();
  const d = cli(['config'], { home });
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stdout, /monthly-cap:\s+100/);
  assert.match(d.stdout, /default-budget:\s+1\b/);
  assert.equal(cli(['config', 'set', 'monthly-cap', '200'], { home }).status, 0);
  assert.equal(cli(['config', 'set', 'default-budget', '2.5'], { home }).status, 0);
  const file = join(home, 'config.json');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { monthlyCap: 200, defaultBudget: 2.5 });
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  const shown = cli(['config'], { home });
  assert.match(shown.stdout, /monthly-cap:\s+200/);
  assert.match(shown.stdout, /default-budget:\s+2\.5/);
  assert.equal(cli(['config', 'set', 'monthly-cap', '0'], { home }).status, 0);
  assert.match(cli(['config'], { home }).stdout, /monthly-cap:\s+0 \(no local cap\)/);
});

test('config rejects invalid values and unknown settings, and saves nothing', () => {
  const home = tempHome();
  for (const args of [['monthly-cap', 'abc'], ['monthly-cap', '-5'], ['default-budget', '0'], ['default-budget', '51'], ['default-budget', 'x'], ['nope', '1']]) {
    const r = cli(['config', 'set', ...args], { home });
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /Invalid|Unknown setting/);
  }
  assert.ok(!existsSync(join(home, 'config.json')));
});

test('run is refused before any API call when the cap would be exceeded', () => {
  const home = tempHome();
  seed(home, 99.5);
  const brief = briefFile(home);
  // Any API call would hit this dead address; a refusal must not get that far.
  const r = spawnSync(process.execPath, [BIN, 'run', brief, '--budget', '1'], {
    env: { ...process['env'], ULTRAGENT_HOME: home, ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' }, encoding: 'utf8',
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Refusing to run/);
  assert.match(r.stderr, /US\$99\.5000/);
  assert.match(r.stderr, /monthly cap is US\$100\.00/);
  assert.match(r.stderr, /ultragent config set monthly-cap/);
  assert.ok(!r.stdout.includes('Outcome:'));
  assert.ok(!existsSync(join(home, 'runs')), 'no run directory should have been created');
  assert.equal(readFileSync(join(home, 'costs.csv'), 'utf8').trim().split('\n').length, 3, 'costs.csv unchanged');
});

test('run with default budget 1 and 99.5 spent is refused (default-budget is used when --budget is absent)', () => {
  const home = tempHome();
  seed(home, 99.5);
  const r = spawnSync(process.execPath, [BIN, 'run', briefFile(home)], {
    env: { ...process['env'], ULTRAGENT_HOME: home, ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' }, encoding: 'utf8',
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /this run's budget is US\$1\.00/);
});

test('costs shows the cap and the remaining amount', () => {
  const home = tempHome();
  seed(home, 12.25);
  const r = cli(['costs'], { home });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Month to date .*US\$12\.2500/);
  assert.match(r.stdout, /Monthly cap: US\$100\.0000, remaining: US\$87\.7500/);
  assert.match(r.stdout, /other usage on the same key is not included/);
});

test('an allowed run passes its budget on to the worker (fake local API server)', async () => {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 5 },
      }));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const home = tempHome();
  seed(home, 99.25);
  const brief = briefFile(home);
  try {
    const child = spawn(process.execPath, [BIN, 'run', brief, '--budget', '0.5', '--cwd', home], {
      env: { ...process['env'], ULTRAGENT_HOME: home, ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}` },
    });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    const code = await new Promise((ok) => child.on('close', ok));
    assert.equal(code, 0, out);
    const runs = join(home, 'runs');
    const events = readFileSync(join(runs, readdirSync(runs)[0], 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(events.find((e) => e.event === 'start').budget, 0.5);
    // Without --budget, the default-budget setting is what gets passed on.
    cli(['config', 'set', 'default-budget', '0.25'], { home });
    const child2 = spawn(process.execPath, [BIN, 'run', brief, '--cwd', home], {
      env: { ...process['env'], ULTRAGENT_HOME: home, ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}` },
    });
    const code2 = await new Promise((ok) => child2.on('close', ok));
    assert.equal(code2, 0);
    const budgets = readdirSync(runs).sort().map((dir) => readFileSync(join(runs, dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.event === 'start').budget);
    assert.deepEqual(budgets, [0.5, 0.25]);
  } finally { server.close(); }
});

test('init asks for the plan: 1 = 100, 2 = 200, 3 = own number, empty keeps 100', () => {
  const cases = [['1\n', 100], ['2\n', 200], ['3\n150\n', 150], ['3\n0\n', 0], ['\n', 100], ['', 100]];
  for (const [answers, expected] of cases) {
    const home = tempHome();
    const r = cli(['init', '--no-verify'], { home, input: `${FAKE_KEY}\n${answers}` });
    assert.equal(r.status, 0, `${JSON.stringify(answers)}: ${r.stderr}`);
    assert.match(r.stdout, /Which plan are you on\?/);
    assert.match(r.stdout, /\[1\] Max \(US\$100\/month credit\)/);
    assert.match(r.stdout, /\[2\] Ultra \(US\$200\/month\)/);
    assert.match(r.stdout, /\[3\] Other/);
    const file = join(home, 'config.json');
    const cap = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).monthlyCap ?? 100) : 100;
    assert.equal(cap, expected, JSON.stringify(answers));
  }
});

test('init keeps the current cap when the own-number answer is invalid', () => {
  const home = tempHome();
  const r = cli(['init', '--no-verify'], { home, input: `${FAKE_KEY}\n3\nlots\n` });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Invalid monthly cap/);
  assert.match(cli(['config'], { home }).stdout, /monthly-cap:\s+100/);
});

