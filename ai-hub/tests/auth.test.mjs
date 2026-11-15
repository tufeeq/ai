import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAuth } from '../src/auth.mjs';

const ADMIN = 'test-admin-key-not-a-real-secret';

function fakeStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get: (name, fallback) => (data.has(name) ? data.get(name) : fallback),
    set: (name, value) => { data.set(name, value); },
  };
}

function fakeRes() {
  return {
    status: null,
    headers: null,
    body: null,
    headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
    end(body) { this.body = body; },
  };
}

const bearer = (key) => ({ headers: { authorization: `Bearer ${key}` } });
const apiKey = (key) => ({ headers: { 'x-api-key': key } });

function setup() {
  const store = fakeStore();
  const logs = [];
  const auth = createAuth({ config: { adminKey: ADMIN, dataDir: '/nonexistent' }, store, log: (l) => logs.push(l) });
  return { auth, store, logs };
}

test('admin key from config verifies as admin with project *', () => {
  const { auth, logs } = setup();
  assert.deepEqual(auth.verify(bearer(ADMIN)), {
    ok: true, role: 'admin', keyId: 'admin', project: '*', name: 'admin',
  });
  assert.equal(logs.length, 0, 'configured admin key must not be logged');
});

test('createKey returns a well-formed key and stores only its sha256', () => {
  const { auth, store } = setup();
  const created = auth.createKey({ name: 'TAGit prod', project: 'tagit' });

  assert.match(created.key, /^hub_[A-Za-z0-9_-]{32}$/);
  assert.equal(created.name, 'TAGit prod');
  assert.equal(created.project, 'tagit');
  assert.ok(created.id);
  assert.ok(!Number.isNaN(Date.parse(created.createdAt)));
  assert.deepEqual(Object.keys(created).sort(), ['createdAt', 'id', 'key', 'name', 'project']);

  const stored = store.get('keys', []);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].hash, createHash('sha256').update(created.key).digest('hex'));
  assert.equal(stored[0].revoked, false);
  assert.ok(!JSON.stringify(stored).includes(created.key), 'plain key must never be stored');
});

test('project key verifies through both header variants', () => {
  const { auth } = setup();
  const { id, key } = auth.createKey({ name: 'operon', project: 'operon' });
  const expected = { ok: true, role: 'project', keyId: id, project: 'operon', name: 'operon' };

  assert.deepEqual(auth.verify(bearer(key)), expected);
  assert.deepEqual(auth.verify(apiKey(key)), expected);
  assert.deepEqual(auth.verify({ headers: { authorization: `bearer   ${key}` } }), expected);
  assert.deepEqual(auth.verify({ headers: { Authorization: `Bearer ${key}` } }), expected);
  assert.equal(auth.verify(apiKey(ADMIN)).role, 'admin');
});

test('wrong, malformed or missing keys are rejected', () => {
  const { auth } = setup();
  const { key } = auth.createKey({ name: 'a', project: 'general' });

  assert.deepEqual(auth.verify(bearer('hub_' + 'A'.repeat(32))), { ok: false });
  assert.deepEqual(auth.verify(bearer(key.slice(0, -1))), { ok: false });
  assert.deepEqual(auth.verify(bearer(key + 'x')), { ok: false });
  assert.deepEqual(auth.verify({ headers: { authorization: `Basic ${key}` } }), { ok: false });
  assert.deepEqual(auth.verify({ headers: { authorization: 'Bearer ' } }), { ok: false });
  assert.deepEqual(auth.verify(apiKey('')), { ok: false });
  assert.deepEqual(auth.verify(apiKey('x'.repeat(5000))), { ok: false });
  assert.deepEqual(auth.verify({ headers: {} }), { ok: false });
  assert.deepEqual(auth.verify({}), { ok: false });
  assert.deepEqual(auth.verify(undefined), { ok: false });
});

test('a stored hash cannot be used as a key', () => {
  const { auth, store } = setup();
  auth.createKey({ name: 'a', project: 'general' });
  assert.deepEqual(auth.verify(bearer(store.get('keys')[0].hash)), { ok: false });
});

test('revokeKey rejects the key afterwards and reports unknown ids', () => {
  const { auth } = setup();
  const a = auth.createKey({ name: 'a', project: 'tagit' });
  const b = auth.createKey({ name: 'b', project: 'myai' });

  assert.equal(auth.revokeKey('nope'), false);
  assert.equal(auth.revokeKey(undefined), false);
  assert.equal(auth.revokeKey(a.id), true);

  assert.deepEqual(auth.verify(bearer(a.key)), { ok: false });
  assert.equal(auth.verify(bearer(b.key)).ok, true);
  assert.equal(auth.revokeKey(a.id), true, 'revoking twice is idempotent');
});

test('listKeys exposes metadata without hashes or plain keys', () => {
  const { auth } = setup();
  const a = auth.createKey({ name: 'a', project: 'tagit' });
  auth.createKey({ name: 'b', project: 'myai' });
  auth.revokeKey(a.id);

  const list = auth.listKeys();
  assert.equal(list.length, 2);
  for (const item of list) {
    assert.deepEqual(Object.keys(item).sort(), ['createdAt', 'id', 'name', 'project', 'revoked']);
  }
  assert.deepEqual(list.map((k) => [k.name, k.project, k.revoked]), [['a', 'tagit', true], ['b', 'myai', false]]);
  assert.ok(!JSON.stringify(list).includes(a.key));
});

test('createKey validates name and project', () => {
  const { auth } = setup();
  const bad = [
    {},
    { name: '', project: 'tagit' },
    { name: '   ', project: 'tagit' },
    { name: 'x'.repeat(81), project: 'tagit' },
    { name: 42, project: 'tagit' },
    { name: 'ok' },
    { name: 'ok', project: '*' },
    { name: 'ok', project: '' },
    { name: 'ok', project: 'Has_Upper' },
    { name: 'ok', project: 'a'.repeat(41) },
    { name: 'ok', project: 'a b' },
  ];
  for (const input of bad) {
    assert.throws(() => auth.createKey(input), (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.status, 400);
      assert.equal(err.code, 'invalid_request');
      return true;
    }, JSON.stringify(input));
  }
  assert.throws(() => auth.createKey(), { status: 400, code: 'invalid_request' });
  assert.equal(auth.listKeys().length, 0);

  assert.equal(auth.createKey({ name: 'x'.repeat(80), project: 'a'.repeat(40) }).name.length, 80);
  assert.equal(auth.createKey({ name: '  padded  ', project: 'dont-chaos' }).name, 'padded');
});

test('guard sends 401 JSON when the key is missing or wrong', () => {
  const { auth } = setup();
  for (const req of [{ headers: {} }, bearer('hub_wrong')]) {
    const res = fakeRes();
    assert.equal(auth.guard({ req, res }), null);
    assert.equal(res.status, 401);
    assert.match(res.headers['Content-Type'], /application\/json/);
    const body = JSON.parse(res.body);
    assert.equal(body.error.code, 'unauthorized');
    assert.equal(typeof body.error.message, 'string');
  }
});

test('guard sends 403 JSON when a project key hits an admin route', () => {
  const { auth } = setup();
  const { key } = auth.createKey({ name: 'a', project: 'tagit' });
  const res = fakeRes();
  assert.equal(auth.guard({ req: bearer(key), res }, 'admin'), null);
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).error.code, 'forbidden');
});

test('guard returns the identity and leaves the response untouched on success', () => {
  const { auth } = setup();
  const { id, key } = auth.createKey({ name: 'a', project: 'tagit' });

  const res1 = fakeRes();
  assert.deepEqual(auth.guard({ req: bearer(key), res: res1 }), {
    ok: true, role: 'project', keyId: id, project: 'tagit', name: 'a',
  });
  assert.equal(res1.status, null);

  for (const role of [undefined, 'project', 'admin']) {
    const res = fakeRes();
    const identity = auth.guard({ req: bearer(ADMIN), res }, role);
    assert.equal(identity.role, 'admin');
    assert.equal(identity.project, '*');
    assert.equal(res.status, null);
  }
});

test('guard does not write twice when headers were already sent', () => {
  const { auth } = setup();
  const res = fakeRes();
  res.headersSent = true;
  assert.equal(auth.guard({ req: { headers: {} }, res }), null);
  assert.equal(res.status, null);
});

test('admin key is generated, persisted with mode 600 and logged once', () => {
  const root = mkdtempSync(join(tmpdir(), 'ai-hub-auth-'));
  const dataDir = join(root, 'nested', 'data'); // must be created on demand
  try {
    const logs = [];
    const log = (line) => logs.push(line);
    const auth1 = createAuth({ config: { adminKey: '', dataDir }, store: fakeStore(), log });

    const file = join(dataDir, 'admin.key');
    assert.ok(existsSync(file));
    const generated = readFileSync(file, 'utf8').trim();
    assert.match(generated, /^hub_[A-Za-z0-9_-]{32}$/);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(logs, [`ADMIN KEY (save it): ${generated}`]);
    assert.equal(auth1.verify(bearer(generated)).role, 'admin');

    // Second boot loads the same key and stays silent.
    const auth2 = createAuth({ config: { adminKey: '', dataDir }, store: fakeStore(), log });
    assert.equal(logs.length, 1);
    assert.equal(auth2.verify(apiKey(generated)).role, 'admin');
    assert.equal(readFileSync(file, 'utf8').trim(), generated);

    // A configured admin key takes precedence over the file.
    const auth3 = createAuth({ config: { adminKey: ADMIN, dataDir }, store: fakeStore(), log });
    assert.equal(auth3.verify(bearer(ADMIN)).role, 'admin');
    assert.deepEqual(auth3.verify(bearer(generated)), { ok: false });
    assert.equal(logs.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keys survive a restart through the store and tolerate a corrupt collection', () => {
  const store = fakeStore();
  const config = { adminKey: ADMIN, dataDir: '/nonexistent' };
  const { id, key } = createAuth({ config, store }).createKey({ name: 'a', project: 'marginos' });
  assert.equal(createAuth({ config, store }).verify(bearer(key)).keyId, id);

  const broken = createAuth({ config, store: fakeStore({ keys: 'garbage' }) });
  assert.deepEqual(broken.verify(bearer(key)), { ok: false });
  assert.deepEqual(broken.listKeys(), []);
  assert.equal(broken.verify(bearer(ADMIN)).role, 'admin');
});
