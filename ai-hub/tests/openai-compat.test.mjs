import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';

import { register } from '../src/openai-compat.mjs';

// ---------- fakes ----------

class FakeRes extends EventEmitter {
  statusCode = 0;
  headers = {};
  body = '';
  headersSent = false;
  writableEnded = false;
  writableFinished = false;
  destroyed = false;
  setHeader(k, v) { this.headers[k.toLowerCase()] = String(v); }
  writeHead(status, headers = {}) {
    this.statusCode = status;
    for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = String(v);
    this.headersSent = true;
    return this;
  }
  write(chunk) { this.headersSent = true; this.body += chunk; return true; }
  end(chunk) {
    if (chunk) this.body += chunk;
    this.headersSent = true;
    this.writableEnded = true;
    this.writableFinished = true;
    this.emit('finish');
  }
  json() { return JSON.parse(this.body); }
  events() {
    return this.body.split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => b.slice(6));
  }
}

class LLMError extends Error {
  constructor(code, message = code) { super(message); this.name = 'LLMError'; this.code = code; }
}

const config = { model: 'qwen2.5:3b' };
const identity = { ok: true, role: 'project', keyId: 'k1', project: 'tagit', name: 'test' };

function setup(overrides = {}, opts = {}) {
  const routes = [];
  const router = { add: (method, pattern, handler) => routes.push({ method, pattern, handler }) };
  const calls = { chat: [], chatStream: [], records: [], limiter: [] };
  const deps = {
    config,
    auth: { guard: () => identity },
    limiter: { check: (id) => { calls.limiter.push(id); return { ok: true, retryAfterSec: 0 }; } },
    llm: {
      models: async () => [{ id: 'qwen2.5:3b' }, { id: 'llama3:latest' }, { id: 'phi3:mini' }],
      chat: async (args) => {
        calls.chat.push(args);
        return { content: 'Hello there', model: args.model, promptTokens: 11, completionTokens: 3, ms: 5 };
      },
      async *chatStream(args) {
        calls.chatStream.push(args);
        yield { delta: 'Hel' };
        yield { delta: 'lo' };
        yield { done: true, model: args.model, promptTokens: 9, completionTokens: 2, ms: 7 };
      },
    },
    usage: {
      estimateTokens: (t) => Math.max(1, Math.ceil(String(t).length / 4)),
      record: (r) => calls.records.push(r),
    },
    ...overrides,
  };
  register(router, deps, { streamHeaderDelayMs: 2000, keepAliveMs: 0, ...opts });
  const find = (method, pattern) => routes.find((r) => r.method === method && r.pattern === pattern).handler;
  return { routes, calls, deps, find };
}

function makeCtx(body) {
  const req = new EventEmitter();
  req.headers = {};
  const res = new FakeRes();
  return {
    req,
    res,
    url: new URL('http://hub.local/v1/chat/completions'),
    params: {},
    query: {},
    config,
    json: async () => (typeof body === 'function' ? body() : body),
  };
}

async function post(env, body) {
  const ctx = makeCtx(body);
  await env.find('POST', '/v1/chat/completions')(ctx);
  return ctx.res;
}

const userMsg = [{ role: 'user', content: 'Hi' }];

// ---------- tests ----------

test('registers both routes', () => {
  const { routes } = setup();
  assert.deepEqual(routes.map((r) => `${r.method} ${r.pattern}`).sort(), ['GET /v1/models', 'POST /v1/chat/completions']);
});

test('GET /v1/models lists installed models in OpenAI shape', async () => {
  const env = setup();
  const ctx = makeCtx();
  await env.find('GET', '/v1/models')(ctx);
  assert.equal(ctx.res.statusCode, 200);
  assert.deepEqual(ctx.res.json(), {
    object: 'list',
    data: [
      { id: 'qwen2.5:3b', object: 'model', owned_by: 'ai-hub' },
      { id: 'llama3:latest', object: 'model', owned_by: 'ai-hub' },
      { id: 'phi3:mini', object: 'model', owned_by: 'ai-hub' },
    ],
  });
  assert.deepEqual(env.calls.limiter, ['k1']);
});

test('GET /v1/models answers 503 in OpenAI shape when the model server is down', async () => {
  const env = setup();
  env.deps.llm.models = async () => { throw new LLMError('unreachable'); };
  const ctx = makeCtx();
  await env.find('GET', '/v1/models')(ctx);
  assert.equal(ctx.res.statusCode, 503);
  assert.equal(ctx.res.json().error.code, 'unreachable');
});

test('non-stream completion returns a chat.completion object and records usage', async () => {
  const env = setup();
  const res = await post(env, { model: 'gpt-4o-mini', messages: userMsg, temperature: 0.7, max_tokens: 200 });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const out = res.json();
  assert.match(out.id, /^chatcmpl-[0-9a-f]{24}$/);
  assert.equal(out.object, 'chat.completion');
  assert.equal(typeof out.created, 'number');
  assert.equal(out.model, 'qwen2.5:3b');
  assert.deepEqual(out.choices, [{ index: 0, message: { role: 'assistant', content: 'Hello there' }, finish_reason: 'stop' }]);
  assert.deepEqual(out.usage, { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 });

  const call = env.calls.chat[0];
  assert.equal(call.model, 'qwen2.5:3b');
  assert.deepEqual(call.messages, [{ role: 'user', content: 'Hi' }]);
  assert.equal(call.temperature, 0.7);
  assert.equal(call.maxTokens, 200);
  assert.ok(!call.json);
  assert.ok(call.signal instanceof AbortSignal);

  assert.equal(env.calls.records.length, 1);
  assert.deepEqual(
    { ...env.calls.records[0], ms: 0 },
    { keyId: 'k1', project: 'tagit', kind: 'openai', model: 'qwen2.5:3b', promptTokens: 11, completionTokens: 3, ms: 0, ok: true },
  );
});

test('max_completion_tokens wins over max_tokens; defaults are left to the llm module', async () => {
  const env = setup();
  await post(env, { messages: userMsg, max_tokens: 50, max_completion_tokens: 80 });
  assert.equal(env.calls.chat[0].maxTokens, 80);
  await post(env, { messages: userMsg });
  assert.ok(!('maxTokens' in env.calls.chat[1]));
  assert.ok(!('temperature' in env.calls.chat[1]));
});

test('token counts of 0 are replaced by usage.estimateTokens', async () => {
  const env = setup();
  env.deps.llm.chat = async (args) => ({ content: '12345678', model: args.model, promptTokens: 0, completionTokens: 0, ms: 1 });
  const res = await post(env, { messages: [{ role: 'user', content: 'abcdefghijkl' }] });
  assert.deepEqual(res.json().usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
  assert.equal(env.calls.records[0].promptTokens, 3);
  assert.equal(env.calls.records[0].completionTokens, 2);
});

test('stream emits role chunk, content deltas, stop chunk and [DONE]', async () => {
  const env = setup();
  const res = await post(env, { model: 'gpt-4o', messages: userMsg, stream: true });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^text\/event-stream/);
  assert.equal(res.headers['cache-control'], 'no-cache');
  assert.equal(res.headers['x-accel-buffering'], 'no');
  assert.ok(res.writableEnded);

  const events = res.events();
  assert.equal(events.at(-1), '[DONE]');
  const chunks = events.slice(0, -1).map((e) => JSON.parse(e));
  assert.equal(chunks.length, 4);
  for (const c of chunks) {
    assert.equal(c.object, 'chat.completion.chunk');
    assert.equal(c.model, 'qwen2.5:3b');
    assert.equal(c.id, chunks[0].id);
    assert.ok(!('usage' in c));
  }
  assert.match(chunks[0].id, /^chatcmpl-/);
  assert.equal(chunks[0].choices[0].delta.role, 'assistant');
  assert.equal(chunks[0].choices[0].finish_reason, null);
  assert.equal(chunks[1].choices[0].delta.content, 'Hel');
  assert.equal(chunks[2].choices[0].delta.content, 'lo');
  assert.deepEqual(chunks[3].choices[0], { index: 0, delta: {}, finish_reason: 'stop' });

  assert.equal(env.calls.chat.length, 0);
  assert.equal(env.calls.records.length, 1);
  assert.equal(env.calls.records[0].ok, true);
  assert.equal(env.calls.records[0].promptTokens, 9);
  assert.equal(env.calls.records[0].completionTokens, 2);
});

test('stream_options.include_usage adds a final usage chunk', async () => {
  const env = setup();
  const res = await post(env, { messages: userMsg, stream: true, stream_options: { include_usage: true } });
  const events = res.events();
  assert.equal(events.at(-1), '[DONE]');
  const chunks = events.slice(0, -1).map((e) => JSON.parse(e));
  const last = chunks.at(-1);
  assert.deepEqual(last.choices, []);
  assert.deepEqual(last.usage, { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 });
  for (const c of chunks.slice(0, -1)) assert.equal(c.usage, null);
  assert.equal(chunks.at(-2).choices[0].finish_reason, 'stop');
});

test('model mapping: installed ids are kept, everything else maps to config.model', async () => {
  const env = setup();
  const used = async (model) => {
    const body = { messages: userMsg };
    if (model !== undefined) body.model = model;
    return (await post(env, body)).json().model;
  };
  assert.equal(await used('phi3:mini'), 'phi3:mini');
  assert.equal(await used('llama3'), 'llama3:latest');
  assert.equal(await used('qwen2.5:3b'), 'qwen2.5:3b');
  for (const name of [undefined, '', 'gpt-4o', 'gpt-3.5-turbo', 'o3-mini', 'claude-3-5-sonnet', 'nope', 42]) {
    assert.equal(await used(name), 'qwen2.5:3b', `model ${String(name)}`);
  }
  assert.equal(env.calls.chat[0].model, 'phi3:mini');
});

test('model mapping falls back to config.model when the model list is unavailable', async () => {
  const env = setup();
  env.deps.llm.models = async () => { throw new LLMError('unreachable'); };
  const res = await post(env, { model: 'phi3:mini', messages: userMsg });
  assert.equal(res.json().model, 'qwen2.5:3b');
});

test('content array form is joined; developer maps to system', async () => {
  const env = setup();
  const res = await post(env, {
    messages: [
      { role: 'developer', content: 'Be brief.' },
      { role: 'user', content: [{ type: 'text', text: 'Part one' }, { type: 'text', text: 'Part two' }] },
      { role: 'assistant', content: null, tool_calls: [] },
      { role: 'user', content: 'again' },
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(env.calls.chat[0].messages, [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Part one\nPart two' },
    { role: 'user', content: 'again' },
  ]);
});

test('invalid requests get a 400 in OpenAI error shape and never reach the model', async () => {
  const env = setup();
  const cases = [
    [{ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }] }, 'unsupported_content_type'],
    [{ messages: [{ role: 'tool', content: 'result', tool_call_id: 'a' }] }, 'unsupported_role'],
    [{ messages: [{ role: 'wizard', content: 'x' }] }, 'invalid_role'],
    [{ messages: [] }, 'invalid_messages'],
    [{}, 'invalid_messages'],
    [{ messages: userMsg, temperature: 'hot' }, 'invalid_temperature'],
    [{ messages: userMsg, max_tokens: 0 }, 'invalid_max_tokens'],
    [{ messages: userMsg, n: 2 }, 'unsupported_n'],
    [{ messages: userMsg, response_format: { type: 'xml' } }, 'invalid_response_format'],
    [[], 'invalid_body'],
  ];
  for (const [body, code] of cases) {
    const res = await post(env, body);
    assert.equal(res.statusCode, 400, code);
    const { error } = res.json();
    assert.deepEqual(Object.keys(error).sort(), ['code', 'message', 'type']);
    assert.equal(error.type, 'invalid_request_error');
    assert.equal(error.code, code);
    assert.ok(error.message.length > 10);
  }
  assert.match((await post(env, cases[0][0])).json().error.message, /image_url/);
  assert.equal(env.calls.chat.length, 0);
  assert.equal(env.calls.records.length, 0);
});

test('body parse errors from ctx.json are reported in OpenAI shape', async () => {
  const env = setup();
  const bad = await post(env, () => { throw Object.assign(new Error('bad json'), { status: 400, code: 'bad_json' }); });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.type, 'invalid_request_error');
  const big = await post(env, () => { throw Object.assign(new Error('too big'), { status: 413, code: 'too_large' }); });
  assert.equal(big.statusCode, 413);
  assert.equal(big.json().error.code, 'too_large');
});

test('auth failure is passed through untouched', async () => {
  const env = setup({
    auth: {
      guard: (ctx) => {
        ctx.res.writeHead(401, { 'Content-Type': 'application/json' });
        ctx.res.end(JSON.stringify({ error: { code: 'unauthorized', message: 'no key' } }));
        return null;
      },
    },
  });
  const res = await post(env, { messages: userMsg });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), { error: { code: 'unauthorized', message: 'no key' } });
  assert.equal(env.calls.chat.length, 0);
  assert.equal(env.calls.limiter.length, 0);

  const ctx = makeCtx();
  await env.find('GET', '/v1/models')(ctx);
  assert.equal(ctx.res.statusCode, 401);
});

test('rate limit answers 429 with Retry-After in OpenAI shape', async () => {
  const env = setup({ limiter: { check: () => ({ ok: false, retryAfterSec: 12.2 }) } });
  const res = await post(env, { messages: userMsg });
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['retry-after'], '13');
  const { error } = res.json();
  assert.equal(error.type, 'rate_limit_error');
  assert.equal(error.code, 'rate_limit_exceeded');
  assert.equal(env.calls.chat.length, 0);

  const ctx = makeCtx();
  await env.find('GET', '/v1/models')(ctx);
  assert.equal(ctx.res.statusCode, 429);
});

test('LLM errors map to 503 / 504 / 502 and are recorded as failures', async () => {
  const table = [
    ['unreachable', 503],
    ['model_missing', 503],
    ['timeout', 504],
    ['bad_response', 502],
  ];
  for (const [code, status] of table) {
    const env = setup();
    env.deps.llm.chat = async () => { throw new LLMError(code, 'http://ollama:11434 secret detail'); };
    const res = await post(env, { messages: userMsg });
    assert.equal(res.statusCode, status, code);
    const { error } = res.json();
    assert.equal(error.code, code);
    assert.equal(error.type, 'server_error');
    assert.ok(!error.message.includes('ollama:11434'));
    if (status === 503) assert.match(error.message, /self-hosted model is not ready yet/);
    assert.equal(env.calls.records.length, 1);
    assert.equal(env.calls.records[0].ok, false);
    assert.equal(env.calls.records[0].kind, 'openai');
    assert.ok(env.calls.records[0].promptTokens > 0);
  }
});

test('unexpected errors become a 500 without leaking details', async () => {
  const env = setup();
  env.deps.llm.chat = async () => { throw new Error('stack secret'); };
  const res = await post(env, { messages: userMsg });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error.code, 'internal_error');
  assert.ok(!res.body.includes('secret'));
});

test('stream: a failure before the first token is a normal HTTP error', async () => {
  const env = setup();
  env.deps.llm.chatStream = async function* () { throw new LLMError('model_missing'); };
  const res = await post(env, { messages: userMsg, stream: true });
  assert.equal(res.statusCode, 503);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(res.json().error.code, 'model_missing');
  assert.equal(env.calls.records[0].ok, false);
});

test('stream: a mid-stream failure emits an error event and ends without [DONE]', async () => {
  const env = setup();
  env.deps.llm.chatStream = async function* () {
    yield { delta: 'partial ' };
    throw new LLMError('timeout');
  };
  const res = await post(env, { messages: userMsg, stream: true });
  assert.equal(res.statusCode, 200);
  assert.ok(res.writableEnded);
  const events = res.events();
  assert.ok(!events.includes('[DONE]'));
  const last = JSON.parse(events.at(-1));
  assert.deepEqual(Object.keys(last), ['error']);
  assert.equal(last.error.code, 'timeout');
  assert.equal(JSON.parse(events[1]).choices[0].delta.content, 'partial ');
  assert.equal(env.calls.records[0].ok, false);
  assert.equal(env.calls.records[0].completionTokens, 2);
});

test('stream: headers open after the delay when the model is slow to start', async () => {
  const env = setup({}, { streamHeaderDelayMs: 10 });
  let release;
  const gate = new Promise((r) => { release = r; });
  env.deps.llm.chatStream = async function* () {
    await gate;
    throw new LLMError('timeout');
  };
  const ctx = makeCtx({ messages: userMsg, stream: true });
  const pending = env.find('POST', '/v1/chat/completions')(ctx);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(ctx.res.statusCode, 200);
  assert.equal(JSON.parse(ctx.res.events()[0]).choices[0].delta.role, 'assistant');
  release();
  await pending;
  assert.equal(JSON.parse(ctx.res.events().at(-1)).error.code, 'timeout');
});

test('response_format json_object / json_schema turn on json mode', async () => {
  const env = setup();
  await post(env, { messages: userMsg, response_format: { type: 'json_object' } });
  assert.equal(env.calls.chat[0].json, true);
  assert.equal(env.calls.chat[0].messages.length, 1);

  await post(env, {
    messages: userMsg,
    response_format: { type: 'json_schema', json_schema: { name: 'x', schema: { type: 'object', required: ['verdict'] } } },
  });
  assert.equal(env.calls.chat[1].json, true);
  assert.equal(env.calls.chat[1].messages.at(-1).role, 'system');
  assert.match(env.calls.chat[1].messages.at(-1).content, /"verdict"/);

  await post(env, { messages: userMsg, response_format: { type: 'text' } });
  assert.ok(!env.calls.chat[2].json);
});

test('stream + json mode generates once and emits a single content chunk', async () => {
  const env = setup();
  env.deps.llm.chat = async (args) => {
    env.calls.chat.push(args);
    return { content: '{"a":1}', model: args.model, promptTokens: 4, completionTokens: 5, ms: 2 };
  };
  const res = await post(env, { messages: userMsg, stream: true, response_format: { type: 'json_object' } });
  assert.equal(env.calls.chatStream.length, 0);
  assert.equal(env.calls.chat[0].json, true);
  const events = res.events();
  assert.equal(events.at(-1), '[DONE]');
  const chunks = events.slice(0, -1).map((e) => JSON.parse(e));
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].choices[0].delta.role, 'assistant');
  assert.equal(chunks[1].choices[0].delta.content, '{"a":1}');
  assert.equal(chunks[2].choices[0].finish_reason, 'stop');
});

test('client disconnect aborts the LLM call (req close)', async () => {
  const env = setup();
  let signal;
  env.deps.llm.chatStream = async function* (args) {
    signal = args.signal;
    yield { delta: 'one' };
    await new Promise((_, reject) => {
      args.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  };
  const ctx = makeCtx({ messages: userMsg, stream: true });
  const pending = env.find('POST', '/v1/chat/completions')(ctx);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(signal.aborted, false);
  ctx.req.emit('close');
  await pending;
  assert.equal(signal.aborted, true);
  assert.ok(!ctx.res.body.includes('[DONE]'));
  assert.ok(!ctx.res.body.includes('"error"'));
  assert.equal(env.calls.records.length, 1);
});

test('client disconnect aborts a non-stream call without writing a response', async () => {
  const env = setup();
  let signal;
  env.deps.llm.chat = (args) => {
    signal = args.signal;
    return new Promise((_, reject) => {
      args.signal.addEventListener('abort', () => reject(new LLMError('timeout')), { once: true });
    });
  };
  const ctx = makeCtx({ messages: userMsg });
  const pending = env.find('POST', '/v1/chat/completions')(ctx);
  await new Promise((r) => setTimeout(r, 10));
  ctx.res.emit('close');
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(ctx.res.body, '');
});

// ---------- real HTTP server: no spurious abort, real disconnect detection ----------

async function withServer(env, fn) {
  const handler = env.find('POST', '/v1/chat/completions');
  const server = http.createServer(async (req, res) => {
    const ctx = {
      req,
      res,
      url: new URL(req.url, 'http://localhost'),
      params: {},
      query: {},
      config,
      json: async () => {
        const parts = [];
        for await (const part of req) parts.push(part);
        return JSON.parse(Buffer.concat(parts).toString('utf8'));
      },
    };
    await handler(ctx);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}/v1/chat/completions`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

test('real HTTP: a streamed completion is not aborted by the request body closing', async () => {
  const env = setup();
  let signal;
  env.deps.llm.chatStream = async function* (args) {
    signal = args.signal;
    for (const delta of ['a', 'b', 'c']) {
      await new Promise((r) => setTimeout(r, 15));
      yield { delta };
    }
    yield { done: true, model: args.model, promptTokens: 1, completionTokens: 3, ms: 45 };
  };
  await withServer(env, async (url) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: userMsg, stream: true }),
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/event-stream/);
    const text = await r.text();
    assert.ok(text.endsWith('data: [DONE]\n\n'));
    const content = text.split('\n\n').filter((b) => b.startsWith('data: {'))
      .map((b) => JSON.parse(b.slice(6)).choices[0]?.delta?.content ?? '').join('');
    assert.equal(content, 'abc');
  });
  assert.equal(signal.aborted, false);
  assert.equal(env.calls.records[0].ok, true);
});

test('real HTTP: closing the connection mid-stream aborts the LLM call', async () => {
  const env = setup();
  let signal;
  let aborted;
  const sawAbort = new Promise((r) => { aborted = r; });
  env.deps.llm.chatStream = async function* (args) {
    signal = args.signal;
    args.signal.addEventListener('abort', aborted, { once: true });
    yield { delta: 'first' };
    await new Promise((_, reject) => {
      args.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  };
  await withServer(env, async (url) => {
    const ac = new AbortController();
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: userMsg, stream: true }),
      signal: ac.signal,
    });
    const reader = r.body.getReader();
    await reader.read();
    ac.abort();
    await Promise.race([sawAbort, new Promise((_, rej) => setTimeout(() => rej(new Error('LLM call was not aborted')), 2000))]);
  });
  assert.equal(signal.aborted, true);
});
