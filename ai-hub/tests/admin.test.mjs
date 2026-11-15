import { test } from 'node:test';
import assert from 'node:assert/strict';

import { register, clampDays } from '../src/admin.mjs';

const ADMIN_SECRET = 'super-secret-admin-key';

// ---- fakes -----------------------------------------------------------------

function fakeRouter() {
  const routes = [];
  return {
    routes,
    add(method, pattern, handler) { routes.push({ method, pattern, handler }); },
    find(method, pattern) {
      const route = routes.find((r) => r.method === method && r.pattern === pattern);
      assert.ok(route, `route ${method} ${pattern} is registered`);
      return route.handler;
    },
  };
}

function fakeRes() {
  return {
    status: null,
    headers: {},
    body: '',
    headersSent: false,
    writableEnded: false,
    writeHead(status, headers = {}) {
      this.status = status;
      for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v;
      this.headersSent = true;
      return this;
    },
    end(chunk = '') { this.body += chunk; this.writableEnded = true; },
    json() { return JSON.parse(this.body); },
  };
}

function makeDeps(overrides = {}) {
  const calls = { limiter: [], created: [], revoked: [], summary: [], guardRoles: [] };
  const keys = [
    { id: 'key_1', name: 'tagit prod', project: 'tagit', createdAt: '2026-01-01T00:00:00.000Z', revoked: false, hash: 'deadbeef' },
  ];
  const deps = {
    config: {
      version: '1.2.3', model: 'qwen2.5:3b', numCtx: 4096, rateLimitRpm: 60,
      adminKey: ADMIN_SECRET, dataDir: '/data', ollamaUrl: 'http://ollama:11434',
    },
    auth: {
      identity: { ok: true, role: 'admin', keyId: 'admin', project: '*', name: 'admin' },
      guard(ctx, role) {
        calls.guardRoles.push(role);
        if (!this.identity) {
          ctx.res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
          ctx.res.end(JSON.stringify({ error: { code: 'forbidden', message: 'Admin key required' } }));
          return null;
        }
        return this.identity;
      },
      listKeys() { return keys; },
      createKey({ name, project }) {
        calls.created.push({ name, project });
        if (name === 'boom') {
          const err = new Error('name is not allowed');
          err.status = 400;
          err.code = 'invalid_request';
          throw err;
        }
        if (name === 'crash') throw new Error('disk exploded at /data/keys.json');
        return { id: 'key_new', key: 'hub_' + 'a'.repeat(32), name, project, createdAt: '2026-11-15T00:00:00.000Z', hash: 'x' };
      },
      revokeKey(id) { calls.revoked.push(id); return id === 'key_1'; },
    },
    usage: {
      summary(opts) { calls.summary.push(opts); return { days: opts.days, totals: { requests: 7 } }; },
    },
    llm: {
      async health() { return { ok: true, defaultModel: 'qwen2.5:3b', defaultModelReady: true, models: ['qwen2.5:3b'], pulling: false }; },
    },
    knowledge: {
      stats() { return { chunks: 12, builtAt: '2026-11-01T00:00:00.000Z', projects: { general: 4, tagit: 8 } }; },
    },
    projects: {
      list() { return [{ id: 'general', name: 'General' }, { id: 'tagit', name: 'TAGit' }]; },
    },
    limiter: {
      result: { ok: true, retryAfterSec: 0 },
      check(id) { calls.limiter.push(id); return this.result; },
    },
    ...overrides,
  };
  return { deps, calls };
}

function setup(overrides) {
  const { deps, calls } = makeDeps(overrides);
  const router = fakeRouter();
  register(router, deps);
  return { router, deps, calls };
}

function makeCtx(deps, { params = {}, query = {}, body, jsonError } = {}) {
  const res = fakeRes();
  return {
    req: { headers: {} },
    res,
    url: new URL('http://localhost/api/admin'),
    params,
    query,
    config: deps.config,
    async json() {
      if (jsonError) throw jsonError;
      return body;
    },
  };
}

const ALL_ROUTES = [
  ['GET', '/api/admin/keys'],
  ['POST', '/api/admin/keys'],
  ['DELETE', '/api/admin/keys/:id'],
  ['GET', '/api/admin/usage'],
  ['GET', '/api/admin/status'],
];

// ---- registration, guard, rate limit --------------------------------------

test('registers exactly the five admin routes', () => {
  const { router } = setup();
  const got = router.routes.map((r) => `${r.method} ${r.pattern}`).sort();
  assert.deepEqual(got, ALL_ROUTES.map(([m, p]) => `${m} ${p}`).sort());
});

test('non-admin is rejected on every route and the handler stops', async () => {
  for (const [method, pattern] of ALL_ROUTES) {
    const { router, deps, calls } = setup();
    deps.auth.identity = null;
    let jsonRead = false;
    const ctx = makeCtx(deps, { params: { id: 'key_1' }, body: { name: 'x', project: 'tagit' } });
    ctx.json = async () => { jsonRead = true; return {}; };
    await router.find(method, pattern)(ctx);

    assert.equal(ctx.res.status, 403, `${method} ${pattern}`);
    assert.equal(ctx.res.json().error.code, 'forbidden');
    assert.deepEqual(calls.guardRoles, ['admin'], 'guard is called with the admin role');
    assert.equal(calls.limiter.length, 0, 'limiter not reached');
    assert.equal(calls.created.length + calls.revoked.length + calls.summary.length, 0, 'no side effects');
    assert.equal(jsonRead, false, 'body not read');
  }
});

test('rate limited requests get 429 with Retry-After on every route', async () => {
  for (const [method, pattern] of ALL_ROUTES) {
    const { router, deps, calls } = setup();
    deps.limiter.result = { ok: false, retryAfterSec: 17 };
    const ctx = makeCtx(deps, { params: { id: 'key_1' }, body: { name: 'x', project: 'tagit' } });
    await router.find(method, pattern)(ctx);

    assert.equal(ctx.res.status, 429, `${method} ${pattern}`);
    assert.equal(ctx.res.headers['retry-after'], '17');
    assert.equal(ctx.res.json().error.code, 'rate_limited');
    assert.deepEqual(calls.limiter, ['admin:admin']);
    assert.equal(calls.created.length + calls.revoked.length + calls.summary.length, 0);
  }
});

// ---- GET /api/admin/keys ---------------------------------------------------

test('GET keys lists keys without hashes, as no-store JSON', async () => {
  const { router, deps } = setup();
  const ctx = makeCtx(deps);
  await router.find('GET', '/api/admin/keys')(ctx);

  assert.equal(ctx.res.status, 200);
  assert.equal(ctx.res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(ctx.res.headers['cache-control'], 'no-store');
  assert.deepEqual(ctx.res.json(), {
    keys: [{ id: 'key_1', name: 'tagit prod', project: 'tagit', createdAt: '2026-01-01T00:00:00.000Z', revoked: false }],
  });
  assert.ok(!ctx.res.body.includes('deadbeef'), 'hash never leaves the server');
});

// ---- POST /api/admin/keys --------------------------------------------------

test('POST keys creates a key and returns 201 with the plain key once', async () => {
  const { router, deps, calls } = setup();
  const ctx = makeCtx(deps, { body: { name: '  TAGit prod  ', project: 'tagit' } });
  await router.find('POST', '/api/admin/keys')(ctx);

  assert.equal(ctx.res.status, 201);
  assert.equal(ctx.res.headers['cache-control'], 'no-store');
  assert.deepEqual(ctx.res.json(), {
    id: 'key_new', key: 'hub_' + 'a'.repeat(32), name: 'TAGit prod', project: 'tagit',
    createdAt: '2026-11-15T00:00:00.000Z',
  });
  assert.deepEqual(calls.created, [{ name: 'TAGit prod', project: 'tagit' }]);
});

test('POST keys validates the body shape and name', async () => {
  const bad = [undefined, null, [], 'text', {}, { project: 'tagit' }, { name: '', project: 'tagit' },
    { name: '   ', project: 'tagit' }, { name: 42, project: 'tagit' }, { name: 'x'.repeat(81), project: 'tagit' }];
  for (const body of bad) {
    const { router, deps, calls } = setup();
    const ctx = makeCtx(deps, { body });
    await router.find('POST', '/api/admin/keys')(ctx);
    assert.equal(ctx.res.status, 400, JSON.stringify(body));
    assert.equal(ctx.res.json().error.code, 'invalid_request');
    assert.equal(typeof ctx.res.json().error.message, 'string');
    assert.equal(calls.created.length, 0);
  }
});

test('POST keys rejects an unknown project and lists the valid ids', async () => {
  for (const project of ['nope', '*', undefined, 7]) {
    const { router, deps, calls } = setup();
    const ctx = makeCtx(deps, { body: { name: 'x', project } });
    await router.find('POST', '/api/admin/keys')(ctx);
    assert.equal(ctx.res.status, 400);
    const { error } = ctx.res.json();
    assert.equal(error.code, 'invalid_project');
    assert.match(error.message, /general, tagit/);
    assert.equal(calls.created.length, 0);
  }
});

test('POST keys maps a 400 thrown by auth.createKey to a 400 JSON error', async () => {
  const { router, deps } = setup();
  const ctx = makeCtx(deps, { body: { name: 'boom', project: 'tagit' } });
  await router.find('POST', '/api/admin/keys')(ctx);
  assert.equal(ctx.res.status, 400);
  assert.deepEqual(ctx.res.json(), { error: { code: 'invalid_request', message: 'name is not allowed' } });
});

test('POST keys maps body parse errors (400 / 413) and hides unexpected errors', async () => {
  for (const [status, code] of [[400, 'bad_json'], [413, 'body_too_large']]) {
    const { router, deps } = setup();
    const jsonError = Object.assign(new Error('bad body'), { status, code });
    const ctx = makeCtx(deps, { jsonError });
    await router.find('POST', '/api/admin/keys')(ctx);
    assert.equal(ctx.res.status, status);
    assert.equal(ctx.res.json().error.code, code);
  }

  const { router, deps } = setup();
  const ctx = makeCtx(deps, { body: { name: 'crash', project: 'tagit' } });
  await router.find('POST', '/api/admin/keys')(ctx);
  assert.equal(ctx.res.status, 500);
  assert.deepEqual(ctx.res.json(), { error: { code: 'internal', message: 'Internal error' } });
  assert.ok(!ctx.res.body.includes('/data/keys.json'), 'internal detail is not leaked');
});

// ---- DELETE /api/admin/keys/:id -------------------------------------------

test('DELETE key revokes an existing key', async () => {
  const { router, deps, calls } = setup();
  const ctx = makeCtx(deps, { params: { id: 'key_1' } });
  await router.find('DELETE', '/api/admin/keys/:id')(ctx);
  assert.equal(ctx.res.status, 200);
  assert.deepEqual(ctx.res.json(), { revoked: true });
  assert.deepEqual(calls.revoked, ['key_1']);
});

test('DELETE key returns 404 for an unknown or missing id', async () => {
  for (const params of [{ id: 'key_missing' }, {}, { id: '' }]) {
    const { router, deps } = setup();
    const ctx = makeCtx(deps, { params });
    await router.find('DELETE', '/api/admin/keys/:id')(ctx);
    assert.equal(ctx.res.status, 404);
    assert.equal(ctx.res.json().error.code, 'not_found');
  }
});

// ---- GET /api/admin/usage --------------------------------------------------

test('GET usage passes clamped days to usage.summary', async () => {
  const cases = [
    [{}, 30], [{ days: '' }, 30], [{ days: 'abc' }, 30], [{ days: '7' }, 7], [{ days: '0' }, 1],
    [{ days: '-5' }, 1], [{ days: '9999' }, 365], [{ days: '365' }, 365], [{ days: '2.9' }, 2],
    [{ days: 'Infinity' }, 30], [{ days: ['14', '3'] }, 14],
  ];
  for (const [query, expected] of cases) {
    const { router, deps, calls } = setup();
    const ctx = makeCtx(deps, { query });
    await router.find('GET', '/api/admin/usage')(ctx);
    assert.equal(ctx.res.status, 200);
    assert.deepEqual(calls.summary, [{ days: expected }], JSON.stringify(query));
    assert.deepEqual(ctx.res.json(), { days: expected, totals: { requests: 7 } });
  }
});

test('clampDays handles missing and out-of-range values', () => {
  assert.equal(clampDays(undefined), 30);
  assert.equal(clampDays(null), 30);
  assert.equal(clampDays(1), 1);
  assert.equal(clampDays(366), 365);
  assert.equal(clampDays('NaN'), 30);
});

// ---- GET /api/admin/status -------------------------------------------------

test('GET status returns the SPEC shape and leaks no secret', async () => {
  const { router, deps } = setup();
  const ctx = makeCtx(deps);
  await router.find('GET', '/api/admin/status')(ctx);

  assert.equal(ctx.res.status, 200);
  const body = ctx.res.json();
  assert.deepEqual(Object.keys(body).sort(), ['config', 'knowledge', 'llm', 'projects', 'uptimeSec', 'version']);
  assert.equal(body.version, '1.2.3');
  assert.ok(Number.isInteger(body.uptimeSec) && body.uptimeSec >= 0);
  assert.equal(body.llm.ok, true);
  assert.equal(body.knowledge.chunks, 12);
  assert.equal(body.projects, 2);
  assert.deepEqual(body.config, { model: 'qwen2.5:3b', numCtx: 4096, rateLimitRpm: 60 });
  assert.ok(!ctx.res.body.includes(ADMIN_SECRET), 'admin key is never exposed');
  assert.ok(!ctx.res.body.includes('adminKey'));
  assert.ok(!ctx.res.body.includes('/data'));
});

test('GET status survives llm.health and knowledge.stats failures', async () => {
  const { router, deps } = setup({
    llm: { async health() { throw new Error('ollama unreachable'); } },
    knowledge: { stats() { throw new Error('index corrupt'); } },
    projects: { list() { throw new Error('projects.json missing'); } },
  });
  const ctx = makeCtx(deps);
  await router.find('GET', '/api/admin/status')(ctx);

  assert.equal(ctx.res.status, 200);
  const body = ctx.res.json();
  assert.deepEqual(body.llm, { ok: false, error: 'ollama unreachable' });
  assert.deepEqual(body.knowledge, { chunks: 0, error: 'index corrupt' });
  assert.equal(body.projects, 0);
  assert.equal(body.version, '1.2.3');
});
