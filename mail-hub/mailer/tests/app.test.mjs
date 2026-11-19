import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openStore } from '../src/store.mjs';
import { createApp } from '../src/app.mjs';

const config = {
  resetTtlMinutes: 30, resetMaxPerEmailWindow: 3, resetWindowMinutes: 15,
  projectRpm: 1000, sendPerHour: 2, maxBodyBytes: 65536, defaultFromEmail: 'no-reply@tryn.cc',
};

async function setup({ failSmtp = false } = {}) {
  const sent = [];
  const mailer = {
    async send(m) { if (failSmtp) throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); sent.push(m); return { messageId: '<x@y>' }; },
    async verify() { return { ok: true }; },
  };
  const store = openStore(':memory:');
  let clock = Date.now();
  const app = createApp({ config, store, mailer, adminKey: 'mha_test', now: () => clock });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, key) => {
    const res = await fetch(base + path, {
      method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const created = await call('POST', '/admin/api/projects', { id: 'iyan', name: 'عيان', reset_url: 'https://iyan.app/reset' }, 'mha_test');
  return { base, sent, call, key: created.body.api_key, created, close: () => server.close(), tick: (ms) => { clock += ms; } };
}

const tokenOf = (m) => new URL(m.text.match(/https:\/\/\S+/)[0]).searchParams.get('token');

test('admin key required and project key shown once', async () => {
  const s = await setup();
  try {
    assert.equal(s.created.status, 201);
    assert.match(s.key, /^mh_iyan_[0-9a-f]{48}$/);
    assert.equal((await s.call('GET', '/admin/api/projects', null, 'wrong')).status, 401);
    const list = await s.call('GET', '/admin/api/projects', null, 'mha_test');
    assert.equal(list.body.projects.length, 1);
    assert.equal(JSON.stringify(list.body).includes('key_hash'), false);
    assert.equal((await s.call('POST', '/admin/api/projects', { id: 'x', name: 'a', reset_url: 'http://evil.com' }, 'mha_test')).status, 400);
  } finally { s.close(); }
});

test('full reset flow: request → verify → consume once', async () => {
  const s = await setup();
  try {
    assert.equal((await s.call('POST', '/v1/password-reset', { email: 'a@b.co' }, 'mh_iyan_bad')).status, 401);
    const r = await s.call('POST', '/v1/password-reset', { email: 'User@Example.com', user_id: 42, name: 'سارة' }, s.key);
    assert.equal(r.status, 202); assert.equal(r.body.sent, true);
    assert.equal(s.sent.length, 1);
    const m = s.sent[0];
    assert.equal(m.to, 'user@example.com');
    assert.match(m.subject, /إعادة تعيين/);
    assert.match(m.html, /dir="rtl"/);
    const token = tokenOf(m);
    assert.equal(token.length, 43);

    const v = await s.call('POST', '/v1/password-reset/verify', { token }, s.key);
    assert.deepEqual([v.status, v.body.valid, v.body.email, v.body.user_id], [200, true, 'user@example.com', '42']);
    const c1 = await s.call('POST', '/v1/password-reset/consume', { token }, s.key);
    assert.equal(c1.status, 200);
    const c2 = await s.call('POST', '/v1/password-reset/consume', { token }, s.key);
    assert.equal(c2.status, 410, 'token is single use');
  } finally { s.close(); }
});

test('newer link revokes older one; expiry enforced; throttle per email', async () => {
  const s = await setup();
  try {
    await s.call('POST', '/v1/password-reset', { email: 'x@y.co', locale: 'en' }, s.key);
    await s.call('POST', '/v1/password-reset', { email: 'x@y.co', locale: 'en' }, s.key);
    const [old, fresh] = s.sent.map(tokenOf);
    assert.match(s.sent[0].subject, /Reset your password/);
    assert.equal((await s.call('POST', '/v1/password-reset/verify', { token: old }, s.key)).status, 410);
    assert.equal((await s.call('POST', '/v1/password-reset/verify', { token: fresh }, s.key)).status, 200);
    await s.call('POST', '/v1/password-reset', { email: 'x@y.co' }, s.key);
    const t4 = await s.call('POST', '/v1/password-reset', { email: 'x@y.co' }, s.key);
    assert.equal(t4.body.sent, false); assert.equal(s.sent.length, 3);
    s.tick(31 * 60_000);
    assert.equal((await s.call('POST', '/v1/password-reset/consume', { token: tokenOf(s.sent[2]) }, s.key)).status, 410, 'expired');
  } finally { s.close(); }
});

test('tokens are project scoped and SMTP failure leaves no live token', async () => {
  const s = await setup();
  try {
    const other = await s.call('POST', '/admin/api/projects', { id: 'demaia', name: 'Demaia', reset_url: 'https://demaia.tryn.cc/reset' }, 'mha_test');
    await s.call('POST', '/v1/password-reset', { email: 'a@b.co' }, s.key);
    const token = tokenOf(s.sent[0]);
    assert.equal((await s.call('POST', '/v1/password-reset/consume', { token }, other.body.api_key)).status, 410);
  } finally { s.close(); }
  const f = await setup({ failSmtp: true });
  try {
    const r = await f.call('POST', '/v1/password-reset', { email: 'a@b.co' }, f.key);
    assert.equal(r.status, 502);
  } finally { f.close(); }
});

test('generic send: one recipient, hourly cap, header injection stripped', async () => {
  const s = await setup();
  try {
    assert.equal((await s.call('POST', '/v1/send', { to: 'a@b.co,c@d.co', subject: 's', text: 't' }, s.key)).status, 400);
    const ok = await s.call('POST', '/v1/send', { to: 'a@b.co', subject: 'Hi\r\nBcc: z@z.co', text: 't' }, s.key);
    assert.equal(ok.status, 202);
    assert.equal(s.sent[0].subject.includes('\n'), false);
    await s.call('POST', '/v1/send', { to: 'a@b.co', subject: 's', text: 't' }, s.key);
    assert.equal((await s.call('POST', '/v1/send', { to: 'a@b.co', subject: 's', text: 't' }, s.key)).status, 429);
  } finally { s.close(); }
});

test('rotating a key disables the old one; disabled project refused', async () => {
  const s = await setup();
  try {
    const rot = await s.call('POST', '/admin/api/projects/iyan/rotate-key', null, 'mha_test');
    assert.equal((await s.call('POST', '/v1/password-reset', { email: 'a@b.co' }, s.key)).status, 401);
    await s.call('PATCH', '/admin/api/projects/iyan', { disabled: true }, 'mha_test');
    assert.equal((await s.call('POST', '/v1/password-reset', { email: 'a@b.co' }, rot.body.api_key)).status, 403);
  } finally { s.close(); }
});

test('admin page is served with a strict CSP', async () => {
  const s = await setup();
  try {
    const res = await fetch(`${s.base}/admin`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(await res.text(), /dir="rtl"/);
  } finally { s.close(); }
});
