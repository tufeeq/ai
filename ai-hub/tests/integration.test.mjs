// End-to-end test: boots the real app (server.mjs + every src module) against an
// in-process mock Ollama and talks to it over real HTTP. No network, no real model.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { startMockOllama } from './mock-ollama.mjs';

const ADMIN_KEY = 'test-admin-key-123';
const HUB_MODEL = 'qwen2.5:3b';
const REPLY = 'مرحبا! Hello from mock.';
const VERDICTS = ['WATCH', 'CONFIRMED_WITH_RISK', 'EXTENDED', 'AVOID', 'INSUFFICIENT_EVIDENCE'];

// Fixed research data: the only URLs an analysis may cite.
const NEWS = [
  { title: 'ACME wins large supply contract', publisher: 'Example Wire', date: '2025-01-15T12:00:00.000Z', url: 'https://news.example.test/acme-contract' },
  { title: 'ACME reports record quarter', publisher: 'Example Daily', date: '2025-01-14T09:30:00.000Z', url: 'https://news.example.test/acme-quarter' },
];
const FILINGS = [
  { form: '8-K', date: '2025-01-15', title: 'ACME Corp 8-K current report', url: 'https://sec.example.test/acme-8k' },
];
const RESEARCH_URLS = new Set([...NEWS, ...FILINGS].map((s) => s.url));
const INVENTED_URL = 'https://invented.example.test/not-from-research';

// What the mock model answers to the TAGit JSON call: one valid research source
// plus one invented source that the hub must drop.
const TAGIT_MODEL_JSON = JSON.stringify({
  ticker: 'ACME',
  company: 'ACME Corp',
  asOf: '2025-01-15T14:30:00Z',
  executiveSummary: 'ACME is moving on a contract headline with above-average volume.',
  shortTermSetup: 'Breakout above the prior range; needs follow-through.',
  liquidityRead: 'Volume well above the recent average.',
  technicalRead: 'Price above the short moving averages.',
  fundamentalGrowth: 'Record quarter reported in the latest release.',
  catalysts: ['Supply contract announcement'],
  risks: ['Extended after a sharp move'],
  dilutionAndFinancing: 'No financing mentioned in the provided filings.',
  latestNewsTake: 'Contract news is the main driver.',
  confidence: 62,
  verdict: 'WATCH',
  sources: [
    { title: NEWS[0].title, url: NEWS[0].url, publisher: NEWS[0].publisher, date: NEWS[0].date },
    { title: 'Invented source', url: INVENTED_URL, publisher: 'Nowhere', date: '2025-01-15' },
  ],
});

const state = {
  mock: null, app: null, base: '', port: 0, dataDir: '',
  researchCalls: { news: [], filings: [] },
  tagit: null,   // { id, key }
  general: null, // { id, key }
};

before(async () => {
  state.dataDir = await mkdtemp(path.join(os.tmpdir(), 'ai-hub-it-'));
  const knowledgePath = path.join(state.dataDir, 'knowledge-fixture.json');
  await writeFile(knowledgePath, JSON.stringify({
    builtAt: '2025-01-01T00:00:00.000Z',
    chunks: [
      { id: 'general-1', project: 'general', source: 'fixture/hub.md', title: 'Hub fixture', text: 'The zebracorn gateway forwards every request to the self hosted model.' },
      { id: 'tagit-1', project: 'tagit', source: 'fixture/tagit.md', title: 'TAGit fixture', text: 'The zebracorn scanner ranks stock signals by liquidity.' },
    ],
  }));

  state.mock = await startMockOllama({ models: [HUB_MODEL], reply: REPLY, jsonReply: TAGIT_MODEL_JSON });

  const research = {
    async news(ticker) { state.researchCalls.news.push(ticker); return NEWS.map((n) => ({ ...n })); },
    async filings(ticker) { state.researchCalls.filings.push(ticker); return FILINGS.map((f) => ({ ...f })); },
  };

  const { createApp } = await import('../server.mjs');
  state.app = await createApp({
    config: {
      dataDir: state.dataDir,
      ollamaUrl: state.mock.url,
      adminKey: ADMIN_KEY,
      autoPullModel: false,
      rateLimitRpm: 1000,
      model: HUB_MODEL,
      knowledgePath,
    },
    research,
    log: false,
  });
  await new Promise((resolve, reject) => {
    state.app.server.once('error', reject);
    state.app.server.listen(0, '127.0.0.1', resolve);
  });
  state.port = state.app.server.address().port;
  state.base = `http://127.0.0.1:${state.port}`;
});

after(async () => {
  if (state.app) await state.app.close();
  if (state.mock) await state.mock.close();
  if (state.dataDir) await rm(state.dataDir, { recursive: true, force: true });
});

// ---- helpers ----------------------------------------------------------------

async function call(method, pathname, { key, body, headers = {} } = {}) {
  const h = { ...headers };
  if (key) h.authorization = `Bearer ${key}`;
  let payload;
  if (body !== undefined) {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(state.base + pathname, {
    method, headers: h, body: payload, signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json };
}

// Payloads of every `data:` line in an SSE body, in order.
function sseData(text) {
  return text.split(/\r?\n\r?\n/)
    .flatMap((block) => block.split(/\r?\n/))
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());
}

// Raw request: sends the path exactly as given (fetch would normalise `..`).
function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: state.port, method: 'GET', path: rawPath }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(10000, () => req.destroy(new Error('raw request timed out')));
    req.on('error', reject);
    req.end();
  });
}

function chatRequests() {
  return state.mock.requests.filter((r) => r.path === '/api/chat');
}

function needKeys() {
  assert.ok(state.tagit && state.general, 'project keys were not created (see the admin key test)');
}

// ---- tests (run in order; later ones reuse the keys created earlier) ----------

test('GET /health is public and reports the model', async () => {
  const r = await call('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(typeof r.json.version, 'string');
  assert.equal(r.json.llm.ok, true);
  assert.equal(r.json.llm.defaultModel, HUB_MODEL);
  assert.equal(r.json.llm.defaultModelReady, true);
  assert.ok(r.json.llm.models.includes(HUB_MODEL));
  assert.ok(!r.text.includes(ADMIN_KEY), 'health must not leak the admin key');
});

test('protected routes answer 401 without a key or with a wrong key', async () => {
  for (const [method, p, body] of [
    ['GET', '/api/me'],
    ['GET', '/api/projects'],
    ['GET', '/v1/models'],
    ['POST', '/v1/chat/completions', { model: HUB_MODEL, messages: [{ role: 'user', content: 'hi' }] }],
    ['POST', '/api/chat', { messages: [{ role: 'user', content: 'hi' }] }],
    ['POST', '/api/tagit/analyze', { rows: [] }],
    ['GET', '/api/admin/keys'],
    ['GET', '/api/admin/usage'],
  ]) {
    const r = await call(method, p, { body });
    assert.equal(r.status, 401, `${method} ${p} without key`);
    assert.ok(r.json && r.json.error, `${method} ${p} must answer a JSON error`);
  }
  const wrong = await call('GET', '/api/me', { key: 'hub_' + 'x'.repeat(32) });
  assert.equal(wrong.status, 401);
  assert.equal(chatRequests().length, 0, 'unauthenticated calls must never reach the model');
});

test('admin creates a tagit key and a general key', async () => {
  for (const project of ['tagit', 'general']) {
    const r = await call('POST', '/api/admin/keys', { key: ADMIN_KEY, body: { name: `it-${project}`, project } });
    assert.equal(r.status, 201, r.text);
    assert.match(r.json.key, /^hub_[A-Za-z0-9_-]{32}$/);
    assert.equal(r.json.project, project);
    assert.equal(r.json.name, `it-${project}`);
    assert.ok(r.json.id);
    state[project] = { id: r.json.id, key: r.json.key };
  }

  const list = await call('GET', '/api/admin/keys', { key: ADMIN_KEY });
  assert.equal(list.status, 200);
  const keys = Array.isArray(list.json) ? list.json : list.json.keys;
  assert.ok(Array.isArray(keys));
  assert.ok(keys.some((k) => k.id === state.tagit.id) && keys.some((k) => k.id === state.general.id));
  assert.ok(!list.text.includes(state.tagit.key), 'key list must not contain plain keys');
  assert.ok(keys.every((k) => !('hash' in k)), 'key list must not contain hashes');

  // A project key is not an admin.
  const denied = await call('GET', '/api/admin/keys', { key: state.general.key });
  assert.equal(denied.status, 403);
  // x-api-key header works as well as Bearer.
  const viaHeader = await call('GET', '/api/me', { headers: { 'x-api-key': state.general.key } });
  assert.equal(viaHeader.status, 200);
});

test('GET /v1/models lists the hub model', async () => {
  needKeys();
  const r = await call('GET', '/v1/models', { key: state.general.key });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.object, 'list');
  const entry = r.json.data.find((m) => m.id === HUB_MODEL);
  assert.ok(entry, 'hub model missing from /v1/models');
  assert.equal(entry.object, 'model');
  assert.equal(entry.owned_by, 'ai-hub');
});

test('POST /v1/chat/completions non-stream returns a chat.completion', async () => {
  needKeys();
  const r = await call('POST', '/v1/chat/completions', {
    key: state.general.key,
    body: { model: HUB_MODEL, messages: [{ role: 'user', content: 'Say hello' }], temperature: 0.2, max_tokens: 64 },
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.object, 'chat.completion');
  assert.equal(r.json.model, HUB_MODEL);
  assert.equal(r.json.choices.length, 1);
  assert.equal(r.json.choices[0].message.role, 'assistant');
  assert.equal(r.json.choices[0].message.content, REPLY);
  assert.equal(r.json.choices[0].finish_reason, 'stop');
  assert.ok(r.json.usage.prompt_tokens > 0);
  assert.ok(r.json.usage.completion_tokens > 0);
  assert.equal(r.json.usage.total_tokens, r.json.usage.prompt_tokens + r.json.usage.completion_tokens);

  const upstream = chatRequests().at(-1).body;
  assert.equal(upstream.model, HUB_MODEL);
  assert.equal(upstream.stream, false);
  assert.equal(upstream.options.num_predict, 64);
  assert.equal(upstream.messages.at(-1).content, 'Say hello');
});

test('POST /v1/chat/completions stream sends chunks and ends with [DONE]', async () => {
  needKeys();
  const r = await call('POST', '/v1/chat/completions', {
    key: state.general.key,
    body: { model: HUB_MODEL, messages: [{ role: 'user', content: 'Say hello' }], stream: true },
  });
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.get('content-type') || '', /text\/event-stream/);
  const data = sseData(r.text);
  assert.ok(data.length >= 3, `expected several SSE events, got ${data.length}`);
  assert.equal(data.at(-1), '[DONE]');
  const chunks = data.slice(0, -1).map((d) => JSON.parse(d));
  assert.ok(chunks.every((c) => c.object === 'chat.completion.chunk'));
  const text = chunks.map((c) => c.choices?.[0]?.delta?.content || '').join('');
  assert.equal(text, REPLY);
  assert.ok(chunks.some((c) => c.choices?.[0]?.finish_reason === 'stop'), 'a chunk must carry finish_reason "stop"');
});

test("OpenAI model name 'gpt-4o' maps to the hub model", async () => {
  needKeys();
  const r = await call('POST', '/v1/chat/completions', {
    key: state.general.key,
    body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'ping' }] },
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.choices[0].message.content, REPLY);
  // The mock answers 404 for any model it does not have, so the upstream name is what matters.
  assert.equal(chatRequests().at(-1).body.model, HUB_MODEL);
});

test('GET /api/me returns the identity of each key', async () => {
  needKeys();
  const t = await call('GET', '/api/me', { key: state.tagit.key });
  assert.equal(t.status, 200);
  assert.deepEqual(t.json, { role: 'project', project: 'tagit', name: 'it-tagit' });
  const a = await call('GET', '/api/me', { key: ADMIN_KEY });
  assert.equal(a.status, 200);
  assert.equal(a.json.role, 'admin');
  assert.equal(a.json.project, '*');
});

test('GET /api/projects is scoped to the key', async () => {
  needKeys();
  const ids = async (key) => {
    const r = await call('GET', '/api/projects', { key });
    assert.equal(r.status, 200, r.text);
    assert.ok(Array.isArray(r.json));
    assert.ok(r.json.every((p) => !('systemPrompt' in p) && !('systemPromptAr' in p)), 'list must not expose prompts');
    return r.json.map((p) => p.id).sort();
  };
  assert.deepEqual(await ids(state.tagit.key), ['general', 'tagit']);
  assert.deepEqual(await ids(state.general.key), ['general']);
  const all = await ids(ADMIN_KEY);
  for (const id of ['general', 'tagit', 'operon', 'marginos', 'myai', 'dont-chaos']) {
    assert.ok(all.includes(id), `admin must see project ${id}`);
  }
});

test('POST /api/chat stream yields deltas then done with sources', async () => {
  needKeys();
  const r = await call('POST', '/api/chat', {
    key: state.tagit.key,
    body: { project: 'tagit', lang: 'en', messages: [{ role: 'user', content: 'What does the zebracorn scanner do?' }] },
  });
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.get('content-type') || '', /text\/event-stream/);
  const events = sseData(r.text).map((d) => JSON.parse(d));
  assert.ok(events.length >= 2);
  const last = events.at(-1);
  assert.equal(last.done, true, `last event must be done, got ${JSON.stringify(last)}`);
  const deltas = events.slice(0, -1);
  assert.ok(deltas.length >= 1 && deltas.every((e) => typeof e.delta === 'string'));
  assert.equal(deltas.map((e) => e.delta).join(''), REPLY);
  assert.ok(Array.isArray(last.sources));
  assert.ok(last.sources.some((s) => s.source === 'fixture/tagit.md' && s.project === 'tagit'),
    'sources must include the matching knowledge chunk');
  assert.ok(last.usage && typeof last.usage === 'object');

  const upstream = chatRequests().at(-1).body;
  assert.equal(upstream.model, HUB_MODEL);
  assert.equal(upstream.messages[0].role, 'system');
  assert.ok(upstream.messages.some((m) => m.content.includes('zebracorn scanner ranks')),
    'knowledge excerpt must be passed to the model');
});

test('POST /api/chat non-stream and project scoping', async () => {
  needKeys();
  const r = await call('POST', '/api/chat', {
    key: state.general.key,
    body: { stream: false, messages: [{ role: 'user', content: 'ما هي بوابة zebracorn؟' }] },
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.content, REPLY);
  assert.ok(Array.isArray(r.json.sources));
  assert.ok(r.json.sources.every((s) => s.project === 'general'), 'a general key must only see general knowledge');
  assert.ok(r.json.usage);

  const before = chatRequests().length;
  const denied = await call('POST', '/api/chat', {
    key: state.general.key,
    body: { project: 'tagit', stream: false, messages: [{ role: 'user', content: 'hi' }] },
  });
  assert.equal(denied.status, 403, denied.text);
  assert.equal(chatRequests().length, before, 'a forbidden chat must not reach the model');
});

test('POST /api/tagit/analyze returns schemaVersion 4 with research-only sources', async () => {
  needKeys();
  const live = '2025-01-15T14:30:00Z';
  const r = await call('POST', '/api/tagit/analyze', {
    key: state.tagit.key,
    body: {
      lang: 'en',
      liveFeedUpdatedAtUTC: live,
      rows: [{ ticker: 'ACME', signalType: 'BREAKOUT', price: 12.34, changePct: 5.6, volume: 1234567 }],
    },
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.schemaVersion, 4);
  assert.equal(r.json.provider, 'SELF_HOSTED_OLLAMA');
  assert.equal(r.json.model, HUB_MODEL);
  assert.equal(r.json.status, 'OK');
  assert.equal(r.json.liveFeedUpdatedAtUTC, live);
  assert.ok(!Number.isNaN(Date.parse(r.json.updatedAtUTC)));
  assert.equal(r.json.analysisCount, 1);
  assert.deepEqual(Object.keys(r.json.analyses), ['ACME']);

  const a = r.json.analyses.ACME;
  assert.equal(a.ticker, 'ACME');
  assert.ok(VERDICTS.includes(a.verdict), `unexpected verdict ${a.verdict}`);
  assert.equal(a.verdict, 'WATCH');
  assert.ok(Number.isInteger(a.confidence) && a.confidence >= 0 && a.confidence <= 100);
  assert.notEqual(a.aiStatus, 'MODEL_FAILED');
  for (const field of ['executiveSummary', 'shortTermSetup', 'liquidityRead', 'technicalRead',
    'fundamentalGrowth', 'dilutionAndFinancing', 'latestNewsTake']) {
    assert.equal(typeof a[field], 'string', `${field} must be a string`);
  }
  assert.ok(a.executiveSummary.length > 0);
  assert.ok(Array.isArray(a.catalysts) && Array.isArray(a.risks));

  assert.ok(Array.isArray(a.sources) && a.sources.length >= 1, 'the valid research source must survive');
  for (const s of a.sources) {
    assert.ok(RESEARCH_URLS.has(s.url), `source not from research: ${s.url}`);
  }
  assert.ok(!r.text.includes(INVENTED_URL), 'invented source URL must be dropped');

  assert.deepEqual(state.researchCalls.news, ['ACME']);
  assert.deepEqual(state.researchCalls.filings, ['ACME']);
  const upstream = chatRequests().at(-1).body;
  assert.equal(upstream.format, 'json');
  assert.equal(upstream.stream, false);
  // The hub may hand the model titles only (URLs are attached server-side), so check the headline.
  assert.ok(JSON.stringify(upstream.messages).includes(NEWS[0].title), 'research headlines must be given to the model');
});

test('TAGit endpoint rejects the general key with 403', async () => {
  needKeys();
  const before = chatRequests().length;
  const r = await call('POST', '/api/tagit/analyze', {
    key: state.general.key,
    body: { rows: [{ ticker: 'ACME', signalType: 'BREAKOUT', price: 12.34, changePct: 5.6 }] },
  });
  assert.equal(r.status, 403, r.text);
  assert.ok(r.json.error);
  assert.equal(chatRequests().length, before);
});

test('admin usage summary shows the requests made', async () => {
  needKeys();
  const r = await call('GET', '/api/admin/usage?days=7', { key: ADMIN_KEY });
  assert.equal(r.status, 200, r.text);
  const s = r.json;
  assert.equal(s.days, 7);
  // 3 OpenAI calls + 2 chat calls + 1 TAGit call reached the model.
  assert.ok(s.totals.requests >= 6, `expected >= 6 requests, got ${s.totals.requests}`);
  assert.ok(s.totals.promptTokens > 0 && s.totals.completionTokens > 0);
  assert.equal(typeof s.totals.savedUSD, 'number');
  assert.ok(s.totals.savedUSD > 0);
  assert.equal(typeof s.reference.inPerM, 'number');
  const kind = (k) => (s.byKind.find((x) => x.kind === k) || {}).requests || 0;
  assert.ok(kind('openai') >= 3, `openai requests: ${kind('openai')}`);
  assert.ok(kind('chat') >= 2, `chat requests: ${kind('chat')}`);
  assert.ok(kind('tagit') >= 1, `tagit requests: ${kind('tagit')}`);
  const projects = s.byProject.map((p) => p.project);
  assert.ok(projects.includes('tagit') && projects.includes('general'));
  assert.equal(s.byDay.length >= 1, true);
  assert.match(s.byDay.at(-1).day, /^\d{4}-\d{2}-\d{2}$/);

  const status = await call('GET', '/api/admin/status', { key: ADMIN_KEY });
  assert.equal(status.status, 200);
  assert.equal(status.json.config.model, HUB_MODEL);
  assert.equal(status.json.knowledge.chunks, 2);
  assert.ok(!status.text.includes(ADMIN_KEY), 'status must not leak the admin key');
});

test('a revoked key answers 401', async () => {
  needKeys();
  const ok = await call('GET', '/api/me', { key: state.general.key });
  assert.equal(ok.status, 200);
  const del = await call('DELETE', `/api/admin/keys/${encodeURIComponent(state.general.id)}`, { key: ADMIN_KEY });
  assert.equal(del.status, 200, del.text);
  const gone = await call('GET', '/api/me', { key: state.general.key });
  assert.equal(gone.status, 401);
  const gone2 = await call('GET', '/v1/models', { key: state.general.key });
  assert.equal(gone2.status, 401);
  // The other key keeps working.
  const other = await call('GET', '/api/me', { key: state.tagit.key });
  assert.equal(other.status, 200);
});

test('static / and /admin return HTML with security headers', async () => {
  for (const p of ['/', '/admin']) {
    const r = await call('GET', p);
    assert.equal(r.status, 200, `${p} -> ${r.status}`);
    assert.match(r.headers.get('content-type') || '', /text\/html/);
    assert.match(r.text, /<html/i);
    const csp = r.headers.get('content-security-policy') || '';
    assert.ok(csp, `${p} must carry a CSP header`);
    assert.match(csp, /'self'/);
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), 'CSP must not allow inline scripts');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(r.text), `${p} must not contain inline <script>`);
  }
});

test('unknown /api and /v1 paths answer 404 JSON', async () => {
  for (const [method, p] of [['GET', '/api/nope'], ['POST', '/api/nope'], ['GET', '/v1/nope'], ['GET', '/api']]) {
    const r = await call(method, p, { key: ADMIN_KEY });
    assert.equal(r.status, 404, `${method} ${p}`);
    assert.match(r.headers.get('content-type') || '', /application\/json/);
    assert.ok(r.json && r.json.error && r.json.error.code, `${method} ${p} must answer a JSON error`);
  }
  const missing = await call('GET', '/no-such-file.html');
  assert.equal(missing.status, 404);
});

test('path traversal on static files is not served', async () => {
  for (const p of [
    '/../server.mjs',
    '/../package.json',
    '/..%2fserver.mjs',
    '/%2e%2e/server.mjs',
    '/%2e%2e%2fpackage.json',
    '/..%5cserver.mjs',
    '/styles.css/../../server.mjs',
    '/../../../../etc/passwd',
    '/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
    '//../src/auth.mjs',
    '/.env',
  ]) {
    const r = await rawGet(p);
    assert.ok(r.status >= 400 && r.status < 500, `${p} -> ${r.status}`);
    assert.ok(!r.text.includes('createApp'), `${p} leaked server source`);
    assert.ok(!r.text.includes('"dependencies"') && !r.text.includes('"scripts"'), `${p} leaked package.json`);
    assert.ok(!r.text.includes('root:'), `${p} leaked a system file`);
  }
});
