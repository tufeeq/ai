// Outcome-measurement pipeline (review-outcomes, 2026-09-29): labels, day accounting and the
// independent recompute of every published summary from its raw file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { label, summarize, buildReport, dropAfterClose } from '../pipeline/sip_study.mjs';
import { session, buildLedger, liveAlertsFor, needsRerun, summarizeBook } from '../pipeline/paper_ledger.mjs';
import { recompute } from '../research/recompute-outcomes.mjs';

const bar = (iso, o, h, l, c) => ({ t: iso, o, h, l, c, v: 1000, n: 10, vw: c });
const close = Date.parse('2026-09-25T20:00:00Z');
const signal = { plan_valid: true, trigger: 2.0, stop: 1.9 };

test('SIP label: a later bar gapping below the stop exits at its open, and the cost is carried in R', () => {
  const bars = [bar('2026-09-25T15:00:00Z', 2.0, 2.05, 1.95, 2.0), bar('2026-09-25T15:01:00Z', 1.7, 1.75, 1.6, 1.7)];
  const l = label(bars, Date.parse('2026-09-25T15:00:00Z'), close, signal);
  assert.equal(l.plan.status, 'STOP');
  assert.ok(Math.abs(l.plan.r + 3) < 1e-9, `gap to 1.70 from 2.00 with 0.10 risk is -3R, got ${l.plan.r}`);
  assert.ok(Math.abs(l.plan.cost_r - 0.1) < 1e-9);
  const touch = label([bar('2026-09-25T15:00:00Z', 2.0, 2.05, 1.89, 1.95)], Date.parse('2026-09-25T15:00:00Z'), close, signal);
  assert.ok(Math.abs(touch.plan.r + 1) < 1e-9, 'a stop touched inside the entry bar fills at the stop');
});

test('SIP summaries: after-close signals are dropped and plan R after cost is reported beside gross', () => {
  const ev = (at) => ({ at, price: 2, vr: 3, usd3: 60000, bo: true, now: { s: 'R', ret: -1, up: 1, dn: -1, plan: 'TIME', r: 0.2, rc: 0.3 }, late: { s: 'NO_ENTRY' } });
  const day = { date: '2026-09-25', symbols: 1, with_bars: 1, failed: 0, events: [ev('2026-09-25T19:59:00.000Z'), ev('2026-09-25T20:00:00.000Z'), ev('2026-09-25T20:01:00.000Z')] };
  assert.deepEqual(dropAfterClose(day).events.map((e) => e.at), ['2026-09-25T19:59:00.000Z', '2026-09-25T20:00:00.000Z']);
  const r = buildReport([day], 1);
  assert.equal(r.totals.at_detection.signals, 2);
  const s = summarize(dropAfterClose(day).events, 'now');
  assert.equal(s.plan_mean_r, 0.2);
  assert.equal(s.plan_mean_r_after_cost, -0.1);
  assert.equal(s.plan_costed, 2);
});

test('paper ledger: early closes end the session at 13:00 and the live book ignores unrecorded days', () => {
  assert.equal(new Date(session('2026-11-27').close).toISOString(), '2026-11-27T18:00:00.000Z');
  assert.equal(new Date(session('2026-12-01').open).toISOString(), '2026-12-01T14:30:00.000Z');
  const report = { days: [
    { summary: { date: '2026-09-28', recorded: false, health: { samples: 0 } }, events: [] },
    { summary: { date: '2026-09-29', recorded: true, health: { samples: 90 } }, events: [{ symbol: 'AAA' }] },
    { summary: { date: '2026-09-30', health: { samples: 3 } }, events: [] },
  ] };
  assert.deepEqual(liveAlertsFor('2026-09-28', report), { source: 'MISSING', events: [] });
  assert.equal(liveAlertsFor('2026-09-29', report).events.length, 1);
  assert.equal(liveAlertsFor('2026-09-30', report).source, 'FORWARD_OUTCOMES');
  assert.equal(liveAlertsFor('2026-10-01', report).source, 'MISSING');

  const stored = { failed: 0, live_source: 'MISSING', live_alerts_input: 0 };
  assert.equal(needsRerun(undefined, { source: 'MISSING', events: [] }), true);
  assert.equal(needsRerun(stored, { source: 'MISSING', events: [] }), false);
  assert.equal(needsRerun(stored, liveAlertsFor('2026-09-29', report)), true, 'live alerts that arrived later re-run the day');
  assert.equal(needsRerun({ ...stored, failed: 100 }, { source: 'MISSING', events: [] }), true, 'a failed bar batch is retried');
  assert.equal(needsRerun({ failed: 0, live_source: 'FORWARD_OUTCOMES', live_alerts_input: 1 }, liveAlertsFor('2026-09-29', report)), false);

  const tr = { status: 'TRADED', net_usd: -20, gross_usd: -5, cost_usd: 15, net_r: -0.2, gross_r: -0.05, cost_r: 0.15, exit_kind: 'STOP', spread_source: 'QUOTE', gate: 'PASSED' };
  const l = buildLedger([
    { date: '2026-09-28', live_source: 'MISSING', records: [{ book: 'SIP_DELAYED', ...tr }] },
    { date: '2026-09-29', live_source: 'FORWARD_OUTCOMES', records: [{ book: 'SIP_DELAYED', ...tr }, { book: 'LIVE_ALERTS', ...tr }] },
  ]);
  assert.equal(l.books.SIP_DELAYED.all.sessions, 2);
  assert.equal(l.books.LIVE_ALERTS.all.sessions, 1, 'a day forward.py never recorded is not a live session with zero alerts');
  assert.equal(l.books.LIVE_ALERTS.all.trades, 1);
});

test('paper book reports the median R and dollars per trade beside the outlier-driven mean', () => {
  const t = (r) => ({ net_usd: r * 10, gross_usd: 0, cost_usd: 0, net_r: r, gross_r: 0, cost_r: 0, exit_kind: 'STOP', spread_source: 'QUOTE' });
  const s = summarizeBook([{ date: '2026-09-28', trades: [t(-1), t(-1.2), t(-70)] }]);
  assert.equal(s.median_net_r, -1.2);
  assert.ok(s.mean_net_r < -24);
  assert.equal(s.net_usd_per_trade, -240.67);
});

test('every published outcome summary recomputes from its committed raw file, with no integrity problem', () => {
  const r = recompute();
  assert.ok(r.checked > 90, `only ${r.checked} numbers checked`);
  assert.deepEqual(r.problems, []);
});
