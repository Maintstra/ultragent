import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');
const banned = /claude|anthropic/i;

test('marketplace.json has required fields and clean names', () => {
  const m = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(typeof m.name, 'string');
  assert.ok(m.owner && typeof m.owner.name === 'string');
  assert.ok(Array.isArray(m.plugins) && m.plugins.length > 0);
  assert.doesNotMatch(m.name, banned);
  for (const p of m.plugins) {
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.source, 'string');
    assert.equal(typeof p.description, 'string');
    assert.doesNotMatch(p.name, banned);
  }
});

test('plugin.json has required fields and clean name', () => {
  const p = JSON.parse(read('plugins/ultragent/.claude-plugin/plugin.json'));
  assert.equal(p.name, 'ultragent');
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof p.description, 'string');
  assert.equal(p.license, 'MIT');
  assert.doesNotMatch(p.name, banned);
  const m = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(m.plugins[0].name, p.name);
});

test('SKILL.md has frontmatter with name, description and allowed-tools', () => {
  const text = read('plugins/ultragent/skills/ultragent/SKILL.md').replace(/\r\n/g, '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'frontmatter present');
  const fm = Object.fromEntries(
    match[1].split('\n').map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
  assert.equal(fm.name, 'ultragent');
  assert.ok(fm.description && fm.description.length > 20);
  assert.ok(fm['allowed-tools'].includes('Bash(npx ultragent *)'));
  assert.doesNotMatch(fm.name, banned);
});
