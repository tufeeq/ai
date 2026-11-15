import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../src/ratelimit.mjs';

function makeClock(start = 1_700_000_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => {
    t += ms;
  };
  return now;
}

function setup(rateLimitRpm = 3) {
  const now = makeClock();
  const limiter = createLimiter({ config: { rateLimitRpm }, now });
  return { now, limiter };
}

function fakeRes({ headersSent = false, throws = false } = {}) {
  const headers = {};
  return {
    headers,
    headersSent,
    setHeader(name, value) {
      if (throws) throw new Error('ERR_HTTP_HEADERS_SENT');
      headers[name.toLowerCase()] = value;
    },
  };
}

test('allows rateLimitRpm requests per window, then blocks', (t) => {
  const { limiter } = setup(3);
  t.after(() => limiter.close());
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(limiter.check('k1'), { ok: true, retryAfterSec: 0 });
  }
  const blocked = limiter.check('k1');
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec >= 1);
});

test('window slides: slots free up as old requests expire', (t) => {
  const { limiter, now } = setup(2);
  t.after(() => limiter.close());
  assert.equal(limiter.check('k').ok, true); // t = 0
  now.advance(30_000);
  assert.equal(limiter.check('k').ok, true); // t = 30s
  assert.equal(limiter.check('k').ok, false);

  now.advance(30_000); // t = 60s: first request left the window
  assert.equal(limiter.check('k').ok, true);
  assert.equal(limiter.check('k').ok, false); // 30s and 60s still inside

  now.advance(30_000); // t = 90s: the 30s request left
  assert.equal(limiter.check('k').ok, true);
});

test('retryAfterSec reflects the time until the oldest request expires', (t) => {
  const { limiter, now } = setup(1);
  t.after(() => limiter.close());
  assert.equal(limiter.check('k').ok, true);
  assert.deepEqual(limiter.check('k'), { ok: false, retryAfterSec: 60 });
  now.advance(45_500);
  assert.deepEqual(limiter.check('k'), { ok: false, retryAfterSec: 15 });
  now.advance(14_400); // 100 ms left -> still at least 1
  assert.deepEqual(limiter.check('k'), { ok: false, retryAfterSec: 1 });
  now.advance(100);
  assert.deepEqual(limiter.check('k'), { ok: true, retryAfterSec: 0 });
});

test('blocked requests do not extend the block', (t) => {
  const { limiter, now } = setup(1);
  t.after(() => limiter.close());
  limiter.check('k');
  for (let i = 0; i < 50; i++) {
    now.advance(1_000);
    assert.equal(limiter.check('k').ok, false);
  }
  now.advance(10_000);
  assert.equal(limiter.check('k').ok, true);
});

test('ids are limited independently', (t) => {
  const { limiter } = setup(1);
  t.after(() => limiter.close());
  assert.equal(limiter.check('a').ok, true);
  assert.equal(limiter.check('a').ok, false);
  assert.equal(limiter.check('b').ok, true);
  assert.equal(limiter.check('203.0.113.9').ok, true);
  assert.equal(limiter.check('b').ok, false);
});

test('invalid rateLimitRpm falls back to 60', (t) => {
  const now = makeClock();
  const limiter = createLimiter({ config: { rateLimitRpm: 'nope' }, now });
  t.after(() => limiter.close());
  for (let i = 0; i < 60; i++) assert.equal(limiter.check('k').ok, true);
  assert.equal(limiter.check('k').ok, false);
});

test('memory is bounded: idle ids are cleaned up and the id table is capped', (t) => {
  const { limiter, now } = setup(5);
  t.after(() => limiter.close());
  for (let i = 0; i < 500; i++) limiter.check(`id-${i}`);
  assert.equal(limiter.size(), 500);
  now.advance(61_000);
  limiter.cleanup();
  assert.equal(limiter.size(), 0);

  for (let i = 0; i < 10_050; i++) limiter.check(`flood-${i}`);
  assert.ok(limiter.size() <= 10_000);
  // The most recent id is still tracked and limited normally.
  assert.equal(limiter.check('flood-10049').ok, true);
});

test('securityHeaders sets the hardening headers', (t) => {
  const { limiter } = setup();
  t.after(() => limiter.close());
  const res = fakeRes();
  limiter.securityHeaders(res);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
  const pp = res.headers['permissions-policy'];
  for (const feature of ['camera=()', 'microphone=()', 'geolocation=()']) {
    assert.ok(pp.includes(feature), `Permissions-Policy missing ${feature}`);
  }
  assert.equal(
    res.headers['content-security-policy'],
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
      "connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  assert.ok(!res.headers['content-security-policy'].includes('unsafe-inline'));
});

test('securityHeaders never throws when headers were already sent', (t) => {
  const { limiter } = setup();
  t.after(() => limiter.close());
  const sent = fakeRes({ headersSent: true, throws: true });
  assert.doesNotThrow(() => limiter.securityHeaders(sent));
  assert.deepEqual(sent.headers, {});
  assert.doesNotThrow(() => limiter.securityHeaders(fakeRes({ throws: true })));
  assert.doesNotThrow(() => limiter.securityHeaders(undefined));
});

test('clientIp honours the first X-Forwarded-For hop, then the socket address', (t) => {
  const { limiter } = setup();
  t.after(() => limiter.close());
  const socket = { remoteAddress: '10.0.0.5' };
  assert.equal(
    limiter.clientIp({ headers: { 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1, 10.0.0.2' }, socket }),
    '203.0.113.7',
  );
  assert.equal(
    limiter.clientIp({ headers: { 'x-forwarded-for': ['198.51.100.4, 10.0.0.1'] }, socket }),
    '198.51.100.4',
  );
  assert.equal(limiter.clientIp({ headers: {}, socket }), '10.0.0.5');
  assert.equal(limiter.clientIp({ headers: { 'x-forwarded-for': '  ' }, socket }), '10.0.0.5');
  assert.equal(
    limiter.clientIp({ headers: {}, socket: { remoteAddress: '::ffff:192.0.2.1' } }),
    '192.0.2.1',
  );
  assert.equal(limiter.clientIp({ headers: {}, socket: { remoteAddress: '2001:db8::1' } }), '2001:db8::1');
  assert.equal(limiter.clientIp({ headers: {} }), 'unknown');
  assert.equal(limiter.clientIp({}), 'unknown');
});

test('brute force: 20 failed auths in 10 minutes block the IP for 10 minutes', (t) => {
  const { limiter, now } = setup();
  t.after(() => limiter.close());
  const ip = '203.0.113.50';
  for (let i = 0; i < 19; i++) {
    assert.equal(limiter.failedAuth(ip).blocked, false);
    now.advance(1_000);
  }
  assert.equal(limiter.isBlocked(ip), false);
  const res = limiter.failedAuth(ip); // 20th
  assert.deepEqual(res, { blocked: true, retryAfterSec: 600 });
  assert.equal(limiter.isBlocked(ip), true);
  assert.equal(limiter.isBlocked('203.0.113.51'), false);

  now.advance(10 * 60_000 - 1);
  assert.equal(limiter.isBlocked(ip), true);
  now.advance(1);
  assert.equal(limiter.isBlocked(ip), false);
  // Counter starts fresh after the block expires.
  assert.equal(limiter.failedAuth(ip).blocked, false);
});

test('brute force: failures spread over more than 10 minutes do not block', (t) => {
  const { limiter, now } = setup();
  t.after(() => limiter.close());
  const ip = '198.51.100.20';
  for (let i = 0; i < 40; i++) {
    assert.equal(limiter.failedAuth(ip).blocked, false);
    now.advance(35_000); // at most 18 attempts fit in any 10-minute window
  }
  assert.equal(limiter.isBlocked(ip), false);
});

test('factory works without an injected clock and does not keep the process alive', () => {
  const limiter = createLimiter({ config: { rateLimitRpm: 2 } });
  assert.equal(limiter.check('x').ok, true);
  assert.equal(limiter.check('x').ok, true);
  assert.equal(limiter.check('x').ok, false);
  // No close(): the cleanup interval is unref'd, so the test process must still exit.
});
