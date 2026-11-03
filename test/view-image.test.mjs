import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeGuard } from '../src/guard.mjs';
import { CONTEXT_LIMIT_TOKENS, MAX_IMAGE_BYTES, contextExceeded, runViewImage } from '../src/worker.mjs';

// 1x1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==', 'base64');
const KEY_FILE = '.' + 'env';
const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ultragent-img-'));
  return { dir, guard: makeGuard([dir]) };
};

test('view_image returns an image block and a text block', () => {
  const { dir, guard } = setup();
  writeFileSync(join(dir, 'shot.png'), PNG);
  const r = runViewImage({ path: 'shot.png' }, dir, guard);
  assert.ok(!r.isError);
  assert.equal(r.content.length, 2);
  assert.deepEqual(r.content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } });
  assert.equal(r.content[1].type, 'text');
  assert.match(r.content[1].text, /^shot\.png \(1x1, 1 KB\)/);
});

test('view_image rejects files over 5 MB and suggests downscaling', () => {
  const { dir, guard } = setup();
  writeFileSync(join(dir, 'big.png'), Buffer.alloc(MAX_IMAGE_BYTES + 1));
  const r = runViewImage({ path: 'big.png' }, dir, guard);
  assert.equal(r.isError, true);
  assert.equal(typeof r.content, 'string');
  assert.match(r.content, /5 MB/);
  assert.match(r.content, /Downscale/);
  assert.match(r.content, /adb exec-out screencap -p/);
});

test('view_image blocks key-file paths', () => {
  const { dir, guard } = setup();
  writeFileSync(join(dir, KEY_FILE), 'X=1');
  const r = runViewImage({ path: KEY_FILE }, dir, guard);
  assert.equal(r.isError, true);
  assert.equal(r.blocked, true);
  assert.match(r.content, /off limits/);
  assert.equal(runViewImage({ path: KEY_FILE + '.png' }, dir, guard).blocked, true);
});

test('view_image rejects unsupported extensions and missing files', () => {
  const { dir, guard } = setup();
  writeFileSync(join(dir, 'a.gif'), PNG);
  const r = runViewImage({ path: 'a.gif' }, dir, guard);
  assert.equal(r.isError, true);
  assert.match(r.content, /Unsupported image type/);
  const missing = runViewImage({ path: 'nope.png' }, dir, guard);
  assert.equal(missing.isError, true);
  assert.match(missing.content, /does not exist/);
});

test('contextExceeded sums all input token kinds against 700,000', () => {
  assert.equal(CONTEXT_LIMIT_TOKENS, 700_000);
  assert.equal(contextExceeded(undefined), false);
  assert.equal(contextExceeded({ input_tokens: 700_000 }), false);
  assert.equal(contextExceeded({ input_tokens: 700_001 }), true);
  assert.equal(contextExceeded({ input_tokens: 100, cache_read_input_tokens: 600_000, cache_creation_input_tokens: 99_900 }), false);
  assert.equal(contextExceeded({ input_tokens: 100, cache_read_input_tokens: 600_000, cache_creation_input_tokens: 99_901 }), true);
  assert.equal(contextExceeded({ input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 700_000 }), true);
  assert.equal(contextExceeded({ output_tokens: 9_999_999 }), false);
});
