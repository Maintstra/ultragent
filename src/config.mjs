// Per-user configuration: key file, run logs and cost log live outside the package
// (npx installs into a cache), by default in ~/.ultragent/.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_FILE = '.' + 'env';

export function homeDir() {
  return process.env.ULTRAGENT_HOME ? resolve(process.env.ULTRAGENT_HOME) : join(homedir(), '.ultragent');
}
export const keyPath = () => join(homeDir(), KEY_FILE);
export const runsDir = () => join(homeDir(), 'runs');
export const costsPath = () => join(homeDir(), 'costs.csv');

export function ensureHome() {
  const dir = homeDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* best effort (Windows) */ }
  return dir;
}

function readKeyFrom(path) {
  const line = readFileSync(path, 'utf8').split(/\r?\n/).find((l) => l.startsWith('ANTHROPIC_API_KEY='));
  const key = line?.slice('ANTHROPIC_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  if (!key || !key.startsWith('sk-ant-')) throw new Error(`No valid ANTHROPIC_API_KEY in ${path}`);
  return key;
}

// Order: AGENT_WORKER_ENV (old override), the per-user key file, then the package-root key file
// (current dev setup) only when the per-user file does not exist. Nothing is copied or moved.
export function keySource() {
  if (process.env.AGENT_WORKER_ENV) return process.env.AGENT_WORKER_ENV;
  if (existsSync(keyPath())) return keyPath();
  const legacy = join(PACKAGE_ROOT, KEY_FILE);
  return existsSync(legacy) ? legacy : null;
}

export function loadKey() {
  const src = keySource();
  if (!src || !existsSync(src)) throw new Error(`No API key found. Run "ultragent init" (expected ${keyPath()}).`);
  return readKeyFrom(src);
}

export const hasKeyFile = () => existsSync(keyPath());
export const maskKey = (key) => `…${key.slice(-4)}`;

export function saveKey(key) {
  ensureHome();
  const path = keyPath();
  writeFileSync(path, `ANTHROPIC_API_KEY=${key}\n`, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort (Windows) */ }
  return path;
}

// ---- Local settings (~/.ultragent/config.json) and month-to-date spend ----
export const DEFAULTS = { monthlyCap: 100, defaultBudget: 1 };
export const configPath = () => join(homeDir(), 'config.json');

function toNumber(text) {
  const t = String(text).trim().replace(/^US?\$/i, '');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}
export function parseCap(text) {
  const n = toNumber(text);
  if (!Number.isFinite(n)) throw new Error(`Invalid monthly cap "${text}": use a number of USD, 0 or more (0 = no local cap).`);
  return n;
}
export function parseDefaultBudget(text) {
  const n = toNumber(text);
  if (!Number.isFinite(n) || n <= 0 || n > 50) throw new Error(`Invalid default budget "${text}": use a number of USD above 0 and at most 50.`);
  return n;
}

// CLI name -> stored key, with validation. monthly-cap 0 means no local cap.
export const SETTINGS = {
  'monthly-cap': { key: 'monthlyCap', parse: parseCap },
  'default-budget': { key: 'defaultBudget', parse: parseDefaultBudget },
};

export function loadSettings() {
  const path = configPath();
  let stored = {};
  if (existsSync(path)) {
    try { stored = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error(`${path} is not valid JSON. Fix or delete it.`); }
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) throw new Error(`${path} must contain a JSON object.`);
  }
  const out = { ...DEFAULTS };
  if (stored.monthlyCap !== undefined) out.monthlyCap = parseCap(stored.monthlyCap);
  if (stored.defaultBudget !== undefined) out.defaultBudget = parseDefaultBudget(stored.defaultBudget);
  return out;
}

export function saveSettings(partial) {
  ensureHome();
  const path = configPath();
  let stored = {};
  if (existsSync(path)) { try { stored = JSON.parse(readFileSync(path, 'utf8')) ?? {}; } catch { stored = {}; } }
  writeFileSync(path, JSON.stringify({ ...stored, ...partial }, null, 2) + '\n', { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort (Windows) */ }
  return path;
}

// A CSV row is finished_at,brief,model,outcome,turns,minutes,cost_usd; the brief name may contain commas.
export function parseCostRow(line) {
  const f = line.split(',');
  if (f.length < 7) return null;
  const tail = f.slice(-5);
  return { at: f[0], brief: f.slice(1, -5).join(','), model: tail[0], outcome: tail[1], turns: tail[2], minutes: tail[3], cost: Number(tail[4]) };
}

export function readCostRows() {
  const path = costsPath();
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(parseCostRow).filter(Boolean);
}

// Spend in the current UTC month, from costs.csv.
export function monthToDate(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const rows = readCostRows().filter((r) => { const d = new Date(r.at); return d.getUTCFullYear() === y && d.getUTCMonth() === m && Number.isFinite(r.cost); });
  return { total: rows.reduce((sum, r) => sum + r.cost, 0), runs: rows.length, label: `${y}-${String(m + 1).padStart(2, '0')}` };
}
