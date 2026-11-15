import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLLM, LLMError } from '../src/llm.mjs';

const config = Object.freeze({
  ollamaUrl: 'http://ollama.test:11434/',
  model: 'qwen2.5:3b',
  numCtx: 4096,
  llmTimeoutMs: 2000,
});

const enc = new TextEncoder();

function streamOf(parts) {
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(typeof p === 'string' ? enc.encode(p) : p);
      controller.close();
    },
  });
}

function jsonRes(obj, status = 200) {
  return new Response(streamOf([JSON.stringify(obj)]), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function ndjsonRes(parts, status = 200) {
  return new Response(streamOf(parts), { status, headers: { 'content-type': 'application/x-ndjson' } });
}

// Fake fetch: routes by "<METHOD> <path>", records every call.
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const u = new URL(url);
    const call = {
      url: String(url),
      path: u.pathname,
      method: init.method || 'GET',
      body: init.body ? JSON.parse(init.body) : undefined,
      signal: init.signal,
    };
    calls.push(call);
    const handler = routes[`${call.method} ${call.path}`];
    if (!handler) throw new TypeError('fetch failed');
    return handler(call);
  };
  impl.calls = calls;
  return impl;
}

// A fetch that never answers until its signal aborts (like a hung socket).
function hangingFetch() {
  return (url, init = {}) =>
    new Promise((_, reject) => {
      const fail = () => reject(new DOMException('This operation was aborted', 'AbortError'));
      if (init.signal.aborted) fail();
      else init.signal.addEventListener('abort', fail, { once: true });
    });
}

const tags = (...names) => () => jsonRes({ models: names.map((name) => ({ name, model: name })) });

async function collect(gen) {
  const out = [];
  for await (const item of gen) out.push(item);
  return out;
}

// ---- chat ------------------------------------------------------------------------------------

test('chat: success, default model and request body', async () => {
  const fetchImpl = fakeFetch({
    'POST /api/chat': () =>
      jsonRes({
        model: 'qwen2.5:3b',
        message: { role: 'assistant', content: 'مرحبا' },
        done: true,
        prompt_eval_count: 12,
        eval_count: 5,
      }),
  });
  const llm = createLLM({ config, fetchImpl });
  const out = await llm.chat({ messages: [{ role: 'user', content: 'hi' }] });

  assert.equal(out.content, 'مرحبا');
  assert.equal(out.model, 'qwen2.5:3b');
  assert.equal(out.promptTokens, 12);
  assert.equal(out.completionTokens, 5);
  assert.equal(typeof out.ms, 'number');
  assert.ok(out.ms >= 0);

  assert.equal(fetchImpl.calls.length, 1);
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'http://ollama.test:11434/api/chat'); // trailing slash of ollamaUrl handled
  assert.equal(call.method, 'POST');
  assert.deepEqual(call.body, {
    model: 'qwen2.5:3b',
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
    options: { temperature: 0.3, num_predict: 1024, num_ctx: 4096 },
  });
  assert.equal('format' in call.body, false);
});

test('chat: json flag sets format, explicit model/temperature/maxTokens are forwarded', async () => {
  const fetchImpl = fakeFetch({
    'POST /api/chat': () => jsonRes({ model: 'other:1b', message: { role: 'assistant', content: '{"a":1}' }, done: true }),
  });
  const llm = createLLM({ config, fetchImpl });
  const out = await llm.chat({
    model: 'other:1b',
    messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }],
    temperature: 0,
    maxTokens: 200,
    json: true,
  });
  const body = fetchImpl.calls[0].body;
  assert.equal(body.format, 'json');
  assert.equal(body.model, 'other:1b');
  assert.equal(body.stream, false);
  assert.deepEqual(body.options, { temperature: 0, num_predict: 200, num_ctx: 4096 });
  assert.equal(out.content, '{"a":1}');
  // token counts missing -> 0
  assert.equal(out.promptTokens, 0);
  assert.equal(out.completionTokens, 0);
});

test('chat: network failure -> unreachable', async () => {
  const llm = createLLM({
    config,
    fetchImpl: async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) });
    },
  });
  await assert.rejects(llm.chat({ messages: [] }), (err) => {
    assert.ok(err instanceof LLMError);
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'LLMError');
    assert.equal(err.code, 'unreachable');
    return true;
  });
});

test('chat: 404 / "model not found" -> model_missing', async () => {
  const llm404 = createLLM({
    config,
    fetchImpl: fakeFetch({ 'POST /api/chat': () => jsonRes({ error: "model 'qwen2.5:3b' not found" }, 404) }),
  });
  await assert.rejects(llm404.chat({ messages: [] }), (err) => err instanceof LLMError && err.code === 'model_missing');

  const llmText = createLLM({
    config,
    fetchImpl: fakeFetch({
      'POST /api/chat': () => jsonRes({ error: 'model "x" not found, try pulling it first' }, 400),
    }),
  });
  await assert.rejects(llmText.chat({ messages: [] }), (err) => err instanceof LLMError && err.code === 'model_missing');
});

test('chat: other failures -> bad_response', async () => {
  const cases = {
    'http 500': () => jsonRes({ error: 'boom' }, 500),
    'invalid json': () => new Response(streamOf(['<html>nope']), { status: 200 }),
    'no message': () => jsonRes({ model: 'm', done: true }),
    'error field with 200': () => jsonRes({ error: 'something broke' }),
  };
  for (const [name, handler] of Object.entries(cases)) {
    const llm = createLLM({ config, fetchImpl: fakeFetch({ 'POST /api/chat': handler }) });
    await assert.rejects(
      llm.chat({ messages: [] }),
      (err) => err instanceof LLMError && err.code === 'bad_response',
      name,
    );
  }
});

test('chat: timeout -> timeout', async () => {
  const llm = createLLM({ config: { ...config, llmTimeoutMs: 30 }, fetchImpl: hangingFetch() });
  const started = Date.now();
  await assert.rejects(llm.chat({ messages: [] }), (err) => {
    assert.ok(err instanceof LLMError);
    assert.equal(err.code, 'timeout');
    assert.equal(err.aborted, false);
    return true;
  });
  assert.ok(Date.now() - started < 1500);
});

test('chat: caller signal aborts the request with an LLMError', async () => {
  const llm = createLLM({ config, fetchImpl: hangingFetch() });
  const ac = new AbortController();
  const pending = llm.chat({ messages: [], signal: ac.signal });
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(pending, (err) => err instanceof LLMError && err.code === 'timeout' && err.aborted === true);

  const already = new AbortController();
  already.abort();
  await assert.rejects(llm.chat({ messages: [], signal: already.signal }), (err) => err instanceof LLMError);
});

// ---- chatStream ------------------------------------------------------------------------------

test('chatStream: parses NDJSON split across chunk and multi-byte boundaries', async () => {
  const lines =
    [
      { model: 'qwen2.5:3b', message: { role: 'assistant', content: 'مر' }, done: false },
      { model: 'qwen2.5:3b', message: { role: 'assistant', content: 'حبا' }, done: false },
      { model: 'qwen2.5:3b', message: { role: 'assistant', content: '' }, done: false },
      { model: 'qwen2.5:3b', message: { role: 'assistant', content: ' world' }, done: false },
      {
        model: 'qwen2.5:3b',
        message: { role: 'assistant', content: '' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 20,
        eval_count: 7,
      },
    ]
      .map((o) => JSON.stringify(o))
      .join('\r\n') + '\n';
  const bytes = enc.encode(lines);
  // 5-byte slices cut both JSON objects and 2-byte Arabic characters in half.
  const parts = [];
  for (let i = 0; i < bytes.length; i += 5) parts.push(bytes.slice(i, i + 5));

  const fetchImpl = fakeFetch({ 'POST /api/chat': () => ndjsonRes(parts) });
  const llm = createLLM({ config, fetchImpl });
  const events = await collect(llm.chatStream({ messages: [{ role: 'user', content: 'hi' }] }));

  const deltas = events.filter((e) => 'delta' in e);
  assert.deepEqual(deltas.map((e) => e.delta), ['مر', 'حبا', ' world']); // empty delta dropped
  const finals = events.filter((e) => e.done);
  assert.equal(finals.length, 1);
  const last = events[events.length - 1];
  assert.equal(last.done, true);
  assert.equal(last.model, 'qwen2.5:3b');
  assert.equal(last.promptTokens, 20);
  assert.equal(last.completionTokens, 7);
  assert.equal(typeof last.ms, 'number');

  const body = fetchImpl.calls[0].body;
  assert.equal(body.stream, true);
  assert.equal(body.model, 'qwen2.5:3b');
  assert.deepEqual(body.options, { temperature: 0.3, num_predict: 1024, num_ctx: 4096 });
  assert.equal('format' in body, false);
});

test('chatStream: several objects in one chunk, no trailing newline, missing counts -> 0', async () => {
  const a = JSON.stringify({ model: 'm:1', message: { content: 'A' }, done: false });
  const b = JSON.stringify({ model: 'm:1', message: { content: 'B' }, done: false });
  const c = JSON.stringify({ model: 'm:1', message: { content: '' }, done: true });
  const llm = createLLM({
    config,
    fetchImpl: fakeFetch({ 'POST /api/chat': () => ndjsonRes([`${a}\n${b}\n\n`, c]) }),
  });
  const events = await collect(llm.chatStream({ model: 'm:1', messages: [], temperature: 0.9, maxTokens: 50 }));
  assert.deepEqual(events.slice(0, 2), [{ delta: 'A' }, { delta: 'B' }]);
  assert.equal(events.length, 3);
  assert.equal(events[2].done, true);
  assert.equal(events[2].model, 'm:1');
  assert.equal(events[2].promptTokens, 0);
  assert.equal(events[2].completionTokens, 0);
});

test('chatStream: error mapping (404, mid-stream error, unreachable, empty stream, idle timeout)', async () => {
  const missing = createLLM({
    config,
    fetchImpl: fakeFetch({ 'POST /api/chat': () => jsonRes({ error: 'model "x" not found' }, 404) }),
  });
  await assert.rejects(collect(missing.chatStream({ messages: [] })), (e) => e instanceof LLMError && e.code === 'model_missing');

  const midStream = createLLM({
    config,
    fetchImpl: fakeFetch({
      'POST /api/chat': () =>
        ndjsonRes([
          `${JSON.stringify({ message: { content: 'x' }, done: false })}\n`,
          `${JSON.stringify({ error: 'llama runner process has terminated' })}\n`,
        ]),
    }),
  });
  const got = [];
  await assert.rejects(
    (async () => {
      for await (const e of midStream.chatStream({ messages: [] })) got.push(e);
    })(),
    (e) => e instanceof LLMError && e.code === 'bad_response',
  );
  assert.deepEqual(got, [{ delta: 'x' }]);

  const down = createLLM({ config, fetchImpl: fakeFetch({}) });
  await assert.rejects(collect(down.chatStream({ messages: [] })), (e) => e instanceof LLMError && e.code === 'unreachable');

  const empty = createLLM({ config, fetchImpl: fakeFetch({ 'POST /api/chat': () => ndjsonRes([]) }) });
  await assert.rejects(collect(empty.chatStream({ messages: [] })), (e) => e instanceof LLMError && e.code === 'bad_response');

  // Body opens, sends one token, then stalls forever -> idle timeout.
  const stalled = createLLM({
    config: { ...config, llmTimeoutMs: 40 },
    fetchImpl: fakeFetch({
      'POST /api/chat': () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(enc.encode(`${JSON.stringify({ message: { content: 'x' }, done: false })}\n`));
            },
          }),
          { status: 200 },
        ),
    }),
  });
  await assert.rejects(collect(stalled.chatStream({ messages: [] })), (e) => e instanceof LLMError && e.code === 'timeout');
});

test('chatStream: consumer can stop early without leaks', async () => {
  const line = (s) => `${JSON.stringify({ message: { content: s }, done: false })}\n`;
  const llm = createLLM({
    config,
    fetchImpl: fakeFetch({ 'POST /api/chat': () => ndjsonRes([line('a'), line('b'), line('c')]) }),
  });
  const seen = [];
  for await (const e of llm.chatStream({ messages: [] })) {
    seen.push(e);
    break;
  }
  assert.deepEqual(seen, [{ delta: 'a' }]);
});

// ---- models / health -------------------------------------------------------------------------

test('models: lists ids from /api/tags and throws LLMError when down', async () => {
  const fetchImpl = fakeFetch({ 'GET /api/tags': tags('qwen2.5:3b', 'llama3.2:latest') });
  const llm = createLLM({ config, fetchImpl });
  assert.deepEqual(await llm.models(), [{ id: 'qwen2.5:3b' }, { id: 'llama3.2:latest' }]);
  assert.equal(fetchImpl.calls[0].method, 'GET');
  assert.equal(fetchImpl.calls[0].url, 'http://ollama.test:11434/api/tags');

  const down = createLLM({ config, fetchImpl: fakeFetch({}) });
  await assert.rejects(down.models(), (e) => e instanceof LLMError && e.code === 'unreachable');
});

test('health: ready, not ready, :latest equivalence', async () => {
  const ready = createLLM({ config, fetchImpl: fakeFetch({ 'GET /api/tags': tags('qwen2.5:3b', 'x:latest') }) });
  assert.deepEqual(await ready.health(), {
    ok: true,
    defaultModel: 'qwen2.5:3b',
    defaultModelReady: true,
    models: ['qwen2.5:3b', 'x:latest'],
    pulling: false,
  });

  const notReady = createLLM({ config, fetchImpl: fakeFetch({ 'GET /api/tags': tags('x:latest') }) });
  const h = await notReady.health();
  assert.equal(h.ok, true);
  assert.equal(h.defaultModelReady, false);
  assert.deepEqual(h.models, ['x:latest']);

  // config "llama3.2" matches installed "llama3.2:latest" ...
  const bare = createLLM({
    config: { ...config, model: 'llama3.2' },
    fetchImpl: fakeFetch({ 'GET /api/tags': tags('llama3.2:latest') }),
  });
  assert.equal((await bare.health()).defaultModelReady, true);
  // ... and config "llama3.2:latest" matches installed "llama3.2".
  const suffixed = createLLM({
    config: { ...config, model: 'llama3.2:latest' },
    fetchImpl: fakeFetch({ 'GET /api/tags': tags('llama3.2') }),
  });
  assert.equal((await suffixed.health()).defaultModelReady, true);
  // A different tag is NOT the same model.
  const otherTag = createLLM({
    config: { ...config, model: 'qwen2.5' },
    fetchImpl: fakeFetch({ 'GET /api/tags': tags('qwen2.5:3b') }),
  });
  assert.equal((await otherTag.health()).defaultModelReady, false);
});

test('health: never throws (unreachable, bad status, garbage body)', async () => {
  const down = await createLLM({ config, fetchImpl: fakeFetch({}) }).health();
  assert.deepEqual(down, {
    ok: false,
    defaultModel: 'qwen2.5:3b',
    defaultModelReady: false,
    models: [],
    pulling: false,
    error: 'unreachable',
  });

  const bad = await createLLM({
    config,
    fetchImpl: fakeFetch({ 'GET /api/tags': () => jsonRes({ error: 'x' }, 500) }),
  }).health();
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'bad_response');

  const garbage = await createLLM({
    config,
    fetchImpl: fakeFetch({ 'GET /api/tags': () => new Response('not json', { status: 200 }) }),
  }).health();
  assert.equal(garbage.ok, false);
  assert.equal(garbage.error, 'bad_response');

  const thrower = await createLLM({
    config,
    fetchImpl: () => {
      throw new Error('sync explosion');
    },
  }).health();
  assert.equal(thrower.ok, false);
  assert.equal(typeof thrower.error, 'string');
});

// ---- ensureModel -----------------------------------------------------------------------------

test('ensureModel: present -> true without pulling', async () => {
  const fetchImpl = fakeFetch({ 'GET /api/tags': tags('qwen2.5:3b') });
  const llm = createLLM({ config, fetchImpl });
  assert.equal(await llm.ensureModel('qwen2.5:3b'), true);
  assert.equal(await llm.ensureModel(), true); // defaults to config.model
  assert.equal(fetchImpl.calls.some((c) => c.path === '/api/pull'), false);
  assert.equal((await llm.health()).pulling, false);
});

test('ensureModel: absent -> pulls (streamed), sets pulling, idempotent while in flight', async () => {
  let installed = false;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let pullStarted;
  const started = new Promise((resolve) => {
    pullStarted = resolve;
  });

  const fetchImpl = fakeFetch({
    'GET /api/tags': () => jsonRes({ models: installed ? [{ name: 'qwen2.5:3b' }] : [] }),
    'POST /api/pull': () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(enc.encode('{"status":"pulling manifest"}\n{"status":"pulling abc","total":10,'));
            pullStarted();
            await gate;
            installed = true;
            controller.enqueue(enc.encode('"completed":10}\n{"status":"verifying sha256 digest"}\n{"status":"succ'));
            controller.enqueue(enc.encode('ess"}\n'));
            controller.close();
          },
        }),
        { status: 200 },
      ),
  });
  const llm = createLLM({ config, fetchImpl });

  const p1 = llm.ensureModel('qwen2.5:3b');
  const p2 = llm.ensureModel('qwen2.5:3b');
  assert.equal(p1, p2); // same promise while in flight
  assert.ok(p1 instanceof Promise);

  await started;
  assert.equal(llm.pulling, true);
  const during = await llm.health();
  assert.equal(during.ok, true);
  assert.equal(during.pulling, true);
  assert.equal(during.defaultModelReady, false);
  assert.equal(llm.ensureModel('qwen2.5:3b'), p1);

  release();
  assert.equal(await p1, true);
  assert.equal(await p2, true);

  const pulls = fetchImpl.calls.filter((c) => c.path === '/api/pull');
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0].method, 'POST');
  assert.equal(pulls[0].body.model, 'qwen2.5:3b');
  assert.notEqual(pulls[0].body.stream, false);

  const after = await llm.health();
  assert.equal(after.pulling, false);
  assert.equal(after.defaultModelReady, true);
  assert.equal(llm.pulling, false);

  // Finished work is not cached: a new call re-checks and resolves true without another pull.
  assert.equal(await llm.ensureModel('qwen2.5:3b'), true);
  assert.equal(fetchImpl.calls.filter((c) => c.path === '/api/pull').length, 1);
});

test('ensureModel: never throws (pull error, http error, unreachable)', async () => {
  const pullError = createLLM({
    config,
    fetchImpl: fakeFetch({
      'GET /api/tags': tags(),
      'POST /api/pull': () =>
        ndjsonRes(['{"status":"pulling manifest"}\n', '{"error":"pull model manifest: file does not exist"}\n']),
    }),
  });
  assert.equal(await pullError.ensureModel('nope:1b'), false);
  assert.equal((await pullError.health()).pulling, false);

  const httpError = createLLM({
    config,
    fetchImpl: fakeFetch({ 'GET /api/tags': tags(), 'POST /api/pull': () => jsonRes({ error: 'boom' }, 500) }),
  });
  assert.equal(await httpError.ensureModel('qwen2.5:3b'), false);
  assert.equal(httpError.pulling, false);

  const down = createLLM({ config, fetchImpl: fakeFetch({}) });
  assert.equal(await down.ensureModel('qwen2.5:3b'), false);

  const noSuccess = createLLM({
    config,
    fetchImpl: fakeFetch({ 'GET /api/tags': tags(), 'POST /api/pull': () => ndjsonRes(['{"status":"pulling manifest"}\n']) }),
  });
  assert.equal(await noSuccess.ensureModel('qwen2.5:3b'), false);
});

test('num_thread is sent only when configured', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ model: 'm', message: { role: 'assistant', content: 'ok' }, done: true, prompt_eval_count: 1, eval_count: 1 }), { status: 200 });
  };
  const base = { ollamaUrl: 'http://x', model: 'm', numCtx: 2048, llmTimeoutMs: 5000 };
  await createLLM({ config: { ...base, numThread: 4 }, fetchImpl }).chat({ messages: [{ role: 'user', content: 'hi' }] });
  await createLLM({ config: base, fetchImpl }).chat({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(seen[0].options.num_thread, 4);
  assert.equal('num_thread' in seen[1].options, false);
});
