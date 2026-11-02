// One tiny direct Messages API call (no Claude Code binary) to see which credit pool it bills.
import { readFileSync } from 'node:fs';
const key = readFileSync(new URL('./.env', import.meta.url), 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m)[1].trim();
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 16, messages: [{ role: 'user', content: 'Reply OK' }] }),
});
const body = await res.json();
console.log(res.status, body.type, body.error?.message ?? body.content?.[0]?.text, JSON.stringify(body.usage ?? {}));
