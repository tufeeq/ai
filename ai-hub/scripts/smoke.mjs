#!/usr/bin/env node
// Smoke test for a deployed AI Hub.
//   node scripts/smoke.mjs <baseUrl> <key>
//   AI_HUB_URL=https://hub.example.com AI_HUB_KEY=hub_... node scripts/smoke.mjs
// Checks /health, /api/me, /v1/models and one short non-stream chat completion.
// Exits 0 when every check passes, 1 otherwise. The key is never printed.

const CHAT_TIMEOUT_MS = 300_000; // a cold CPU-only model can take minutes for the first answer
const QUICK_TIMEOUT_MS = 20_000;

const [argUrl, argKey] = process.argv.slice(2);
const baseUrl = String(argUrl || process.env.AI_HUB_URL || '').trim().replace(/\/+$/, '');
const key = String(argKey || process.env.AI_HUB_KEY || '').trim();

if (!baseUrl || !key || !/^https?:\/\//i.test(baseUrl)) {
  console.error('Usage: node scripts/smoke.mjs <baseUrl> <key>');
  console.error('   or: AI_HUB_URL=<baseUrl> AI_HUB_KEY=<key> node scripts/smoke.mjs');
  console.error('baseUrl must start with http:// or https://');
  process.exit(2);
}

// Removes the key from any text before it is printed.
function redact(text) {
  return String(text ?? '').split(key).join('[key hidden]');
}

function short(text, max = 160) {
  const s = redact(text).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

async function request(method, path, { auth = true, body, timeoutMs = QUICK_TIMEOUT_MS } = {}) {
  const headers = { accept: 'application/json' };
  if (auth) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error', // never forward the key to another host
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, json };
}

function fail(r, what) {
  const detail = r.json?.error?.message || r.json?.error?.code || r.text;
  throw new Error(`${what}: HTTP ${r.status}${detail ? ` — ${short(detail, 120)}` : ''}`);
}

let hubModel = '';

const checks = [
  {
    name: 'GET /health',
    async run() {
      const r = await request('GET', '/health', { auth: false });
      if (r.status !== 200 || !r.json || r.json.ok !== true) fail(r, 'hub not healthy');
      const llm = r.json.llm || {};
      hubModel = typeof llm.defaultModel === 'string' ? llm.defaultModel : '';
      if (llm.ok !== true) throw new Error(`hub is up but Ollama is not reachable (${short(llm.error || 'no detail', 60)})`);
      if (llm.defaultModelReady !== true) {
        throw new Error(`model ${hubModel || '(unknown)'} is not ready${llm.pulling ? ' (still pulling)' : ''}`);
      }
      return `v${r.json.version}, model ${hubModel} ready`;
    },
  },
  {
    name: 'GET /api/me',
    async run() {
      const r = await request('GET', '/api/me');
      if (r.status !== 200 || !r.json || !r.json.role) fail(r, 'key rejected');
      return `role ${r.json.role}, project ${r.json.project}`;
    },
  },
  {
    name: 'GET /v1/models',
    async run() {
      const r = await request('GET', '/v1/models');
      if (r.status !== 200 || !r.json || !Array.isArray(r.json.data)) fail(r, 'unexpected response');
      const ids = r.json.data.map((m) => m && m.id).filter(Boolean);
      if (ids.length === 0) throw new Error('model list is empty');
      if (!hubModel) hubModel = ids[0];
      return `${ids.length} model(s): ${short(ids.slice(0, 3).join(', '), 80)}`;
    },
  },
  {
    name: 'POST /v1/chat/completions',
    async run() {
      const r = await request('POST', '/v1/chat/completions', {
        timeoutMs: CHAT_TIMEOUT_MS,
        body: {
          model: hubModel || 'gpt-4o-mini', // unknown names map to the hub model
          messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
          max_tokens: 16,
          temperature: 0,
          stream: false,
        },
      });
      const content = r.json?.choices?.[0]?.message?.content;
      if (r.status !== 200 || typeof content !== 'string') fail(r, 'no completion');
      if (content.trim() === '') throw new Error('model returned an empty answer');
      const u = r.json.usage || {};
      return `"${short(content, 40)}" (${u.prompt_tokens ?? '?'} in / ${u.completion_tokens ?? '?'} out tokens)`;
    },
  },
];

function describeError(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timed out';
  const cause = err?.cause && (err.cause.code || err.cause.message);
  return short(cause ? `${err.message} (${cause})` : err?.message || String(err), 200);
}

const results = [];
for (const check of checks) {
  const started = Date.now();
  try {
    const detail = await check.run();
    results.push({ name: check.name, ok: true, ms: Date.now() - started, detail: redact(detail) });
  } catch (err) {
    results.push({ name: check.name, ok: false, ms: Date.now() - started, detail: describeError(err) });
  }
}

const nameWidth = Math.max(...results.map((r) => r.name.length));
console.log(`AI Hub smoke test — ${redact(baseUrl)}`);
for (const r of results) {
  const time = `${(r.ms / 1000).toFixed(1)}s`.padStart(7);
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(nameWidth)}  ${time}  ${r.detail}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `All ${results.length} checks passed.` : `${failed} of ${results.length} checks failed.`);
process.exit(failed === 0 ? 0 : 1);
