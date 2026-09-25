import test from 'node:test';
import assert from 'node:assert/strict';
import { session, label, summarize, buildReport } from '../pipeline/sip_study.mjs';

const bar = (iso, o, h, l, c) => ({ t: iso, o, h, l, c, v: 1000, n: 10, vw: c });

test('regular session follows daylight saving time', () => {
  assert.equal(new Date(session('2026-09-25').open).toISOString(), '2026-09-25T13:30:00.000Z');
  assert.equal(new Date(session('2026-12-01').open).toISOString(), '2026-12-01T14:30:00.000Z');
  assert.equal(session('2026-09-25').close - session('2026-09-25').open, 390 * 60_000);
});

test('label carries the last trade, caps at the close and records the plan outcome', () => {
  const close = Date.parse('2026-09-25T20:00:00Z');
  const signal = { plan_valid: true, trigger: 2.0, stop: 1.9 };
  const bars = [bar('2026-09-25T19:40:00Z', 2.0, 2.05, 1.99, 2.02), bar('2026-09-25T19:52:00Z', 2.02, 2.21, 2.0, 2.2), bar('2026-09-25T19:59:00Z', 2.2, 2.2, 2.1, 2.1)];
  const l = label(bars, Date.parse('2026-09-25T19:40:00Z'), close, signal);
  assert.equal(l.exit_kind, 'SESSION_END');
  assert.ok(Math.abs(l.return_pct - 4.5) < 1e-9);
  assert.deepEqual(l.plan, { status: 'TARGET_2R', r: 2 });
  assert.deepEqual(label(bars, Date.parse('2026-09-25T19:43:00Z'), close, signal), { status: 'NO_ENTRY' });
  assert.equal(label(bars, Date.parse('2026-09-25T19:40:00Z'), close, { ...signal, trigger: 1.5 }).plan.status, 'CHASED');
  const stop = label([bar('2026-09-25T15:00:00Z', 2.0, 2.3, 1.85, 2.2)], Date.parse('2026-09-25T15:00:00Z'), close, signal);
  assert.equal(stop.plan.status, 'STOP', 'a bar touching both stop and target counts as a stop');
});

test('summaries count no-entry signals and the holdout is the last third of sessions', () => {
  const ev = (ret) => ({ at: '2026-09-25T15:00:00Z', price: 2, vr: 3, usd3: 60000, bo: true, now: ret === null ? { s: 'NO_ENTRY' } : { s: 'R', ret, up: 6, dn: -1, plan: 'TIME', r: 0.1 }, late: { s: 'NO_ENTRY' } });
  const s = summarize([ev(1), ev(-2), ev(null)], 'now');
  assert.deepEqual([s.signals, s.resolved, s.no_entry, s.mean_return_pct, s.win_rate], [3, 2, 1, -0.5, 0.5]);
  const days = ['2026-09-21', '2026-09-22', '2026-09-23'].map((date, i) => ({ date, symbols: 10, with_bars: 9, failed: 0, events: [ev(i)] }));
  const r = buildReport(days, 10);
  assert.equal(r.split.holdout_from, '2026-09-23');
  assert.equal(r.holdout.at_detection.signals, 1);
  assert.equal(r.totals.delayed.no_entry, 3);
  assert.equal(r.profitability_claim_allowed, false);
});
