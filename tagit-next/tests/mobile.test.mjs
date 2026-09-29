// Mobile, RTL, accessibility and resilience checks (review-mobile).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as f from '../src/format.js';
import { backoffDelay, createGate, breaker } from '../src/backoff.js';
import { ApiError } from '../src/api.js';
import { createState, applyScan, scanFailed } from '../src/state.js';
import { renderStatus, renderNotices, renderMetrics } from '../src/views/status.js';

const now = Date.parse('2026-09-16T15:00:00Z');
const at = (d = 0) => new Date(now + d).toISOString();
const payload = () => ({
  schema_version: 1, status: 'OK', feed: 'iex', server_time: at(), rows: [], alerts: [], gainers: [],
  coverage: { eligible_small_caps: 0, with_prices: 12, fresh_prices: 3 },
});

test('signed, percent and currency tokens are LTR-isolated so Arabic text cannot reorder them', () => {
  for (const s of [f.pct(-5.3), f.pct(0.9), f.usd(3.7), f.usd(-2), f.compactUsd(60000)]) {
    assert.ok(s.startsWith(f.LRI) && s.endsWith(f.PDI), s);
  }
  assert.equal(f.plain(f.pct(-5.3)), '-5.30%');
  assert.equal(f.plain(f.usd(-2)), '-$2.00', 'sign before the currency, not "$-2.00"');
  assert.equal(f.plain(f.compactUsd(60000)), '$60K');
  assert.equal(f.pct(null), f.DASH, 'a dash needs no isolate');
  assert.equal(f.num(12.4), '12.40', 'plain numbers stay plain');
});

test('backoff doubles per failure, is capped, and resets', () => {
  assert.equal(backoffDelay(0, 5000, 60000), 5000);
  assert.equal(backoffDelay(1, 5000, 60000), 10000);
  assert.equal(backoffDelay(3, 5000, 60000), 40000);
  assert.equal(backoffDelay(50, 5000, 60000), 60000);
  const g = createGate(30000, 240000);
  assert.ok(g.ready(now));
  assert.equal(g.fail(now), now + 60000);
  assert.ok(!g.ready(now + 59000));
  assert.ok(g.ready(now + 60000));
  g.fail(now); g.fail(now); g.fail(now);
  assert.equal(g.nextAt, now + 240000, 'capped');
  g.reset();
  assert.ok(g.ready(now));
});

test('relay breaker stops a scan run after the first service failure (no request storm)', async () => {
  let calls = 0;
  const dead = breaker(async () => { calls++; throw new ApiError('NETWORK'); });
  for (let i = 0; i < 10; i++) await dead('u').catch(() => {});
  assert.equal(calls, 1);
  let ok = 0;
  const live = breaker(async () => { ok++; return { bars: {} }; });
  for (let i = 0; i < 3; i++) await live('u');
  assert.equal(ok, 3);
});

test('status pill is not a live region; a separate hidden region announces the phase only', () => {
  const state = createState();
  applyScan(state, payload(), now);
  const a = String(renderStatus(state, now + 3000, { scanning: false }));
  const b = String(renderStatus(state, now + 4000, { scanning: false }));
  assert.ok(!/class="pill conn[^"]*"[^>]*role=/.test(a), 'ticking pill must not carry role=status');
  const live = (s) => /<span class="sr-only" role="status"[^>]*>([^<]*)<\/span>/.exec(s)[1];
  assert.equal(live(a), live(b), 'announced text does not change every second');
});

test('outage notice says how old the data is and when the next try is; offline is explicit', () => {
  const state = createState();
  applyScan(state, payload(), now);
  scanFailed(state, 'NETWORK');
  state.retryAt = now + 125_000 + 45_000;
  const out = String(renderNotices(state, now + 125_000));
  assert.match(out, /آخر مسح ناجح قبل <span aria-live="off">2 د<\/span>/);
  assert.match(out, /المحاولة التالية خلال <span aria-live="off">45 ث<\/span>/);
  assert.match(out, /ليست حالية/);
  state.offline = true;
  const off = String(renderNotices(state, now));
  assert.match(off, /غير متصل بالإنترنت/);
  assert.ok(!off.includes('تعذر الوصول'), 'offline replaces the service error');
  assert.match(String(renderStatus(state, now, { scanning: false })), /لا اتصال بالإنترنت/);
});

test('KPI "shown / current" is laid out right to left so each number sits under its label', () => {
  const state = createState();
  applyScan(state, payload(), now);
  const out = String(renderMetrics(state, now));
  const priced = /data-key="kpi-priced">.*?<strong dir="(\w+)">(.*?)<\/strong>/.exec(out);
  assert.equal(priced[1], 'rtl');
  assert.ok(priced[2].includes(`${f.LRI}`), 'numbers inside stay isolated');
});
