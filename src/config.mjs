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
