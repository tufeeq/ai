import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createRouter, HttpError, sendJson, sendError, startSSE, serveStatic,
} from '../src/router.mjs';

const config = Object.freeze({ maxBodyBytes: 200 });
let server;
let base;
let tmp;
let publicDir;

/** Raw request so traversal paths are not normalised by a URL parser. */
function rawRequest(port, head) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let data = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${head}\r\nHost: localhost\r\nConnection: close\r\n\r\n`));
    socket.on('data', (d) => { data += d; });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'ai-hub-router-'));
  publicDir = path.join(tmp, 'public');
  await mkdir(path.join(publicDir, 'assets'), { recursive: true });
  await writeFile(path.join(publicDir, 'index.html'), '<!doctype html><title>home</title>');
  await writeFile(path.join(publicDir, 'admin.html'), '<!doctype html><title>admin</title>');
  await writeFile(path.join(publicDir, 'chat.js'), 'console.log(1);');
  await writeFile(path.join(publicDir, 'styles.css'), 'body{}');
  await writeFile(path.join(publicDir, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(path.join(publicDir, 'data.json'), '{"a":1}');
  await writeFile(path.join(publicDir, 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
  await writeFile(path.join(publicDir, '.hidden'), 'nope');
  await writeFile(path.join(tmp, 'secret.txt'), 'TOP SECRET');

  const router = createRouter({ config });
  router.add('GET', '/hello', ({ res }) => sendJson(res, 200, { hello: 'world' }));
  router.add('GET', '/api/items/:id', ({ res, params, query, url, config: cfg }) => {
    sendJson(res, 200, { params, query, isUrl: url instanceof URL, sameConfig: cfg === config });
  });
  router.add('GET', '/api/:a/sub/:b', ({ res, params }) => sendJson(res, 200, params));
  router.add('DELETE', '/api/items/:id', ({ res, params }) => sendJson(res, 200, { deleted: params.id }));
  router.add('POST', '/echo', async (ctx) => {
    const body = await ctx.json();
    const again = await ctx.json(); // must be safe to call twice
    sendJson(ctx.res, 200, { body, same: body === again });
  });
  router.add('GET', '/boom', () => { throw new Error('secret internals'); });
  router.add('GET', '/teapot', () => { throw new HttpError(418, 'teapot', 'I am a teapot'); });
  router.add('GET', '/coded', () => {
    const err = new Error('upstream is down');
    err.code = 'unreachable';
    throw err;
  });
  router.add('GET', '/err', ({ res }) => sendError(res, 409, 'conflict', 'Already there'));
  router.add('GET', '/sse', ({ res }) => {
    const sse = startSSE(res);
    sse.send({ delta: 'a' });
    sse.send({ delta: 'مرحبا' });
    sse.send({ done: true });
    sse.close();
    assert.equal(sse.send({ late: true }), false);
  });
  router.add('GET', '/sse-fail', ({ res }) => {
    const sse = startSSE(res);
    sse.send({ delta: 'x' });
    throw new Error('after headers');
  });

  const staticHandler = serveStatic(publicDir);
  server = http.createServer(async (req, res) => {
    if (await router.handle(req, res)) return;
    if (await staticHandler(req, res)) return;
    sendError(res, 404, 'not_found', 'Not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
  await rm(tmp, { recursive: true, force: true });
});

test('matches a plain route and sends JSON', async () => {
  const r = await fetch(`${base}/hello`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await r.json(), { hello: 'world' });
});

test('extracts :param segments, query object, URL and config', async () => {
  const r = await fetch(`${base}/api/items/a%20b?days=30&q=x%20y`);
  assert.deepEqual(await r.json(), {
    params: { id: 'a b' },
    query: { days: '30', q: 'x y' },
    isUrl: true,
    sameConfig: true,
  });
  const r2 = await fetch(`${base}/api/one/sub/two`);
  assert.deepEqual(await r2.json(), { a: 'one', b: 'two' });
});

test('method must match; trailing slash is tolerated', async () => {
  const del = await fetch(`${base}/api/items/42`, { method: 'DELETE' });
  assert.deepEqual(await del.json(), { deleted: '42' });
  const put = await fetch(`${base}/api/items/42`, { method: 'PUT' });
  assert.equal(put.status, 404);
  const slash = await fetch(`${base}/hello/`);
  assert.equal(slash.status, 200);
});

test('handle() resolves false when nothing matches', async () => {
  const router = createRouter({ config });
  router.add('GET', '/x', () => {});
  assert.equal(await router.handle({ method: 'GET', url: '/nope', headers: {} }, {}), false);
  assert.equal(await router.handle({ method: 'POST', url: '/x', headers: {} }, {}), false);
  assert.equal(await router.handle({ method: 'GET', url: '/x/y', headers: {} }, {}), false);
});

test('add() validates its arguments', () => {
  const router = createRouter({ config });
  assert.throws(() => router.add('GET', 'no-slash', () => {}), TypeError);
  assert.throws(() => router.add('GET', '/x', null), TypeError);
});

test('json() parses the body and is idempotent', async () => {
  const r = await fetch(`${base}/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msg: 'مرحبا', n: 1 }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { body: { msg: 'مرحبا', n: 1 }, same: true });
});

test('json() treats an empty body as {}', async () => {
  const r = await fetch(`${base}/echo`, { method: 'POST' });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).body, {});
});

test('invalid JSON → 400', async () => {
  const r = await fetch(`${base}/echo`, { method: 'POST', body: '{not json' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'invalid_json');
  const r2 = await fetch(`${base}/echo`, { method: 'POST', body: '"just a string"' });
  assert.equal(r2.status, 400);
});

test('body over maxBodyBytes → 413 (declared length)', async () => {
  const r = await fetch(`${base}/echo`, {
    method: 'POST',
    body: JSON.stringify({ pad: 'x'.repeat(500) }),
  });
  assert.equal(r.status, 413);
  assert.equal((await r.json()).error.code, 'payload_too_large');
});

test('body over maxBodyBytes → 413 (chunked, no content-length)', async () => {
  const result = await new Promise((resolve, reject) => {
    const req = http.request(`${base}/echo`, { method: 'POST' }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write('{"pad":"');
    req.write('y'.repeat(400));
    req.end('"}');
  });
  assert.equal(result.status, 413);
  assert.equal(result.body.error.code, 'payload_too_large');
});

test('uncaught errors → 500 internal without leaking the message', async () => {
  const r = await fetch(`${base}/boom`);
  assert.equal(r.status, 500);
  const body = await r.json();
  assert.equal(body.error.code, 'internal');
  assert.doesNotMatch(JSON.stringify(body), /secret internals/);
});

test('HttpError carries status, code and message', async () => {
  const e = new HttpError(418, 'teapot', 'I am a teapot');
  assert.ok(e instanceof Error);
  assert.equal(e.status, 418);
  assert.equal(e.code, 'teapot');
  assert.equal(e.message, 'I am a teapot');

  const r = await fetch(`${base}/teapot`);
  assert.equal(r.status, 418);
  assert.deepEqual(await r.json(), { error: { code: 'teapot', message: 'I am a teapot' } });
});

test('errors with a code but no status → 500 with that code', async () => {
  const r = await fetch(`${base}/coded`);
  assert.equal(r.status, 500);
  assert.equal((await r.json()).error.code, 'unreachable');
});

test('sendError uses the { error: { code, message } } shape', async () => {
  const r = await fetch(`${base}/err`);
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: { code: 'conflict', message: 'Already there' } });
});

test('startSSE streams `data: <json>` frames', async () => {
  const r = await fetch(`${base}/sse`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/event-stream/);
  assert.match(r.headers.get('cache-control'), /no-cache/);
  const text = await r.text();
  assert.equal(text, 'data: {"delta":"a"}\n\ndata: {"delta":"مرحبا"}\n\ndata: {"done":true}\n\n');
});

test('error after SSE headers just ends the stream', async () => {
  const r = await fetch(`${base}/sse-fail`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'data: {"delta":"x"}\n\n');
});

test('HEAD falls back to the GET route without a body', async () => {
  const r = await fetch(`${base}/hello`, { method: 'HEAD' });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '');
});

test('static: / → index.html and /admin → admin.html', async () => {
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(home.headers.get('cache-control'), 'no-cache');
  assert.match(await home.text(), /<title>home<\/title>/);

  const admin = await fetch(`${base}/admin`);
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /<title>admin<\/title>/);

  const redirect = await fetch(`${base}/admin/`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/admin');
});

test('static: content types and modest caching', async () => {
  const expected = {
    '/index.html': 'text/html; charset=utf-8',
    '/chat.js': 'text/javascript; charset=utf-8',
    '/styles.css': 'text/css; charset=utf-8',
    '/assets/logo.svg': 'image/svg+xml',
    '/data.json': 'application/json; charset=utf-8',
    '/favicon.ico': 'image/x-icon',
  };
  for (const [p, type] of Object.entries(expected)) {
    const r = await fetch(`${base}${p}`);
    assert.equal(r.status, 200, p);
    assert.equal(r.headers.get('content-type'), type, p);
    await r.arrayBuffer();
  }
  const js = await fetch(`${base}/chat.js`);
  assert.equal(js.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(await js.text(), 'console.log(1);');
});

test('static: HEAD returns headers only; ETag gives 304', async () => {
  const head = await fetch(`${base}/chat.js`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String('console.log(1);'.length));
  assert.equal(await head.text(), '');

  const etag = head.headers.get('etag');
  assert.ok(etag);
  const cached = await fetch(`${base}/chat.js`, { headers: { 'if-none-match': etag } });
  assert.equal(cached.status, 304);
});

test('static: no path traversal, dotfiles or directories', async () => {
  const port = server.address().port;
  for (const p of [
    '/../secret.txt',
    '/assets/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/..%2fsecret.txt',
    '/%2e%2e%2fsecret.txt',
    '/..%5csecret.txt',
    '/assets/%2e%2e/%2e%2e/secret.txt',
    '//secret.txt',
    '/.hidden',
    '/assets',
    '/assets/',
    '/chat.js%00.html',
    '/missing.js',
  ]) {
    const raw = await rawRequest(port, `GET ${p} HTTP/1.1`);
    assert.match(raw, /^HTTP\/1\.1 404 /, p);
    assert.doesNotMatch(raw, /TOP SECRET/, p);
    assert.doesNotMatch(raw, /nope/, p);
  }
});

test('static: only GET and HEAD are served', async () => {
  const handler = serveStatic(publicDir);
  assert.equal(await handler({ method: 'POST', url: '/', headers: {} }, {}), false);
  const r = await fetch(`${base}/chat.js`, { method: 'POST' });
  assert.equal(r.status, 404);
});
