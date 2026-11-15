// End-to-end tests for the Anthropic Messages compatibility layer: real HTTP, mock Ollama, no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMockOllama } from './mock-ollama.mjs';
import { parseObject } from '../src/anthropic-compat.mjs';

const ADMIN_KEY = 'test-admin-key-anthropic';
const MODEL = 'gemma3:4b';
const s = {};

async function post(pathname, body, { key = s.key, headers = {} } = {}) {
  const res = await fetch(s.base + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...(key ? { 'x-api-key': key } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* SSE or empty */ }
  return { status: res.status, headers: res.headers, text, json };
}

function sseEvents(text) {
  return text.split('\n\n').filter(Boolean).map((chunk) => {
    const event = /^event: (.+)$/m.exec(chunk);
    const data = /^data: (.+)$/m.exec(chunk);
    return { event: event && event[1], data: data && JSON.parse(data[1]) };
  });
}

before(async () => {
  s.mock = await startMockOllama({ models: [MODEL], reply: 'مرحبا من النموذج المحلي.', jsonReply: '{"title":"عنوان","score":7}' });
  s.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-anthropic-'));
  const { createApp } = await import('../server.mjs');
  s.app = await createApp({
    config: { dataDir: s.dataDir, ollamaUrl: s.mock.url, adminKey: ADMIN_KEY, autoPullModel: false, rateLimitRpm: 1000, model: MODEL, numCtx: 4096 },
    log: false,
  });
  await new Promise((resolve, reject) => {
    s.app.server.once('error', reject);
    s.app.server.listen(0, '127.0.0.1', resolve);
  });
  s.base = `http://127.0.0.1:${s.app.server.address().port}`;
  const created = await fetch(s.base + '/api/admin/keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_KEY}` },
    body: JSON.stringify({ name: 'iyan server', project: 'iyan' }),
  });
  assert.equal(created.status, 201);
  s.key = (await created.json()).key;
});

after(async () => {
  await s.app.close();
  await s.mock.close();
  fs.rmSync(s.dataDir, { recursive: true, force: true });
});

test('plain text message in Anthropic shape; Claude model names map to the hub model', async () => {
  const r = await post('/v1/messages', {
    model: 'claude-haiku-5-5', max_tokens: 300, system: [{ type: 'text', text: 'كن موجزًا', cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'مرحبا' }] }],
    thinking: { type: 'disabled' }, output_config: { effort: 'low' }, metadata: { user_id: 'x' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.type, 'message');
  assert.equal(r.json.role, 'assistant');
  assert.equal(r.json.model, MODEL);
  assert.match(r.json.id, /^msg_/);
  assert.deepEqual(r.json.content, [{ type: 'text', text: 'مرحبا من النموذج المحلي.' }]);
  assert.equal(r.json.stop_reason, 'end_turn');
  assert.ok(r.json.usage.input_tokens > 0 && r.json.usage.output_tokens > 0);
  const sent = s.mock.requests.filter((q) => q.path === '/api/chat').at(-1).body;
  assert.equal(sent.model, MODEL);
  assert.equal(sent.messages[0].role, 'system');
  assert.equal(sent.options.num_predict, 300);
});

test('output_config.format json_schema returns JSON text and passes the schema to the model', async () => {
  const schema = { type: 'object', properties: { title: { type: 'string' }, score: { type: 'integer' } }, required: ['title', 'score'] };
  const r = await post('/v1/messages', {
    model: 'claude-sonnet-5-5', max_tokens: 500, messages: [{ role: 'user', content: 'قيّم هذا الخبر' }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.content[0].type, 'text');
  assert.deepEqual(JSON.parse(r.json.content[0].text), { title: 'عنوان', score: 7 });
  const sent = s.mock.requests.filter((q) => q.path === '/api/chat').at(-1).body;
  assert.deepEqual(sent.format, schema);
  assert.match(sent.messages[0].content, /JSON Schema/);
});

test('one custom tool returns a tool_use block with the parsed input', async () => {
  const r = await post('/v1/messages', {
    model: 'claude-sonnet-5-5', max_tokens: 500, messages: [{ role: 'user', content: 'أخرج النتيجة' }],
    tools: [{ name: 'result', description: 'أعد النتيجة', input_schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }],
    tool_choice: { type: 'auto' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.stop_reason, 'tool_use');
  const block = r.json.content[0];
  assert.equal(block.type, 'tool_use');
  assert.equal(block.name, 'result');
  assert.match(block.id, /^toolu_/);
  assert.deepEqual(block.input, { title: 'عنوان', score: 7 });
});

test('invalid JSON twice from the model is an explicit 502, never a made-up object', async () => {
  s.mock.set({ jsonReply: 'عذرًا لا أستطيع' });
  const r = await post('/v1/messages', {
    max_tokens: 200, messages: [{ role: 'user', content: 'x' }],
    output_config: { format: { type: 'json_schema', schema: { type: 'object', required: ['a'] } } },
  });
  s.mock.set({ jsonReply: '{"title":"عنوان","score":7}' });
  assert.equal(r.status, 502);
  assert.equal(r.json.type, 'error');
  assert.equal(r.json.error.type, 'api_error');
});

test('streaming emits the Anthropic event sequence', async () => {
  const r = await post('/v1/messages', { model: 'claude-haiku-5-5', max_tokens: 200, stream: true, messages: [{ role: 'user', content: 'مرحبا' }] });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  const events = sseEvents(r.text);
  const names = events.map((e) => e.event);
  assert.equal(names[0], 'message_start');
  assert.equal(names[1], 'content_block_start');
  assert.deepEqual(names.slice(-3), ['content_block_stop', 'message_delta', 'message_stop']);
  const text = events.filter((e) => e.event === 'content_block_delta').map((e) => e.data.delta.text).join('');
  assert.equal(text, 'مرحبا من النموذج المحلي.');
  assert.equal(events.find((e) => e.event === 'message_delta').data.delta.stop_reason, 'end_turn');
});

test('streamed tool output uses input_json_delta', async () => {
  const r = await post('/v1/messages', {
    max_tokens: 200, stream: true, messages: [{ role: 'user', content: 'x' }],
    tools: [{ name: 'result', input_schema: { type: 'object' } }],
  });
  const events = sseEvents(r.text);
  assert.equal(events.find((e) => e.event === 'content_block_start').data.content_block.type, 'tool_use');
  const delta = events.find((e) => e.event === 'content_block_delta').data.delta;
  assert.equal(delta.type, 'input_json_delta');
  assert.deepEqual(JSON.parse(delta.partial_json), { title: 'عنوان', score: 7 });
  assert.equal(events.find((e) => e.event === 'message_delta').data.delta.stop_reason, 'tool_use');
});

test('unsupported features are refused with a clear 400 instead of a degraded answer', async () => {
  const cases = [
    [{ messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } }, { type: 'text', text: 'ما هذا؟' }] }] }, /Images and documents/],
    [{ messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'AA==' } }] }] }, /Images and documents/],
    [{ messages: [{ role: 'user', content: 'ابحث' }], tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }] }, /Server tools/],
    [{ messages: [{ role: 'user', content: 'x' }], tools: [{ name: 'a', input_schema: { type: 'object' } }, { name: 'b', input_schema: { type: 'object' } }] }, /Several tools/],
    [{ messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'a', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'r' }] }] }, /Multi-step tool use/],
    [{ messages: [] }, /at least one message/],
    [{ messages: [{ role: 'user', content: 'كلمة '.repeat(20000) }] }, /too long/],
  ];
  for (const [body, pattern] of cases) {
    const r = await post('/v1/messages', { max_tokens: 100, ...body });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(r.json.error.type, 'invalid_request_error');
    assert.match(r.json.error.message, pattern);
  }
});

test('two tools with tool_choice naming one are accepted', async () => {
  const r = await post('/v1/messages', {
    max_tokens: 100, messages: [{ role: 'user', content: 'x' }],
    tools: [{ name: 'a', input_schema: { type: 'object' } }, { name: 'b', input_schema: { type: 'object' } }],
    tool_choice: { type: 'tool', name: 'b' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.content[0].name, 'b');
});

test('auth, bad JSON, model outage and count_tokens', async () => {
  const noKey = await post('/v1/messages', { max_tokens: 10, messages: [{ role: 'user', content: 'x' }] }, { key: null });
  assert.equal(noKey.status, 401);
  assert.equal(noKey.json.error.type, 'authentication_error');

  const badJson = await post('/v1/messages', '{not json');
  assert.equal(badJson.status, 400);

  const count = await post('/v1/messages/count_tokens', { model: 'claude-haiku-5-5', system: 'abc', messages: [{ role: 'user', content: 'hello world' }] });
  assert.equal(count.status, 200);
  assert.ok(count.json.input_tokens > 0);

  s.mock.set({ failChat: true });
  const down = await post('/v1/messages', { max_tokens: 10, messages: [{ role: 'user', content: 'x' }] });
  const downStream = await post('/v1/messages', { max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'x' }] });
  s.mock.set({ failChat: false });
  assert.ok(down.status >= 500 && down.json.type === 'error');
  assert.ok(downStream.status >= 500, 'a stream that fails before the first token gets a real error status');
});

test('usage is recorded under the key project with kind anthropic', async () => {
  const r = await fetch(s.base + '/api/admin/usage?days=1', { headers: { authorization: `Bearer ${ADMIN_KEY}` } });
  const summary = await r.json();
  assert.ok(summary.byKind.some((k) => k.kind === 'anthropic' && k.requests >= 5));
  assert.ok(summary.byProject.some((p) => p.project === 'iyan'));
});

test('parseObject tolerates fences and prose, rejects arrays and garbage', () => {
  assert.deepEqual(parseObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseObject('Here it is: {"a":{"b":2}} done'), { a: { b: 2 } });
  assert.equal(parseObject('[1,2]'), null);
  assert.equal(parseObject('nothing'), null);
});
