// Audit regression tests (tagit-next/reports/audit.md). Each reproduces a measurement bug that was
// found and fixed, or pins a property the audit verified so it cannot silently regress.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSymbol, regularSession, isRegularBar, scanWindow } from '../src/core/sipscan.js';
import { session, label } from '../pipeline/sip_study.mjs';
import { eligible, scanSymbol, stats } from '../pipeline/daily_study.mjs';
import { applyRule, RULES } from '../pipeline/exit_study.mjs';

const iso = (ms) => new Date(ms).toISOString();

/** Quiet minutes then a 3-minute burst whose last bar starts at `burstEnd`. */
function burstBars(firstMs, burstEnd) {
  const out = [];
  for (let t = firstMs; t <= burstEnd; t += 60_000) {
    const k = (burstEnd - t) / 60_000; // 2, 1, 0 for the burst
    const burst = k <= 2;
    out.push({ t: iso(t), o: 1, h: burst ? 1.05 : 1.001, l: 0.999, c: burst ? 1 + (3 - k) * 0.01 : 1, v: burst ? 20_000 : 1000, n: burst ? 40 : 5, vw: 1 });
  }
  return out;
}

test('A1 regular session: EDT/EST offsets, DST switch and early closes', () => {
  const edt = regularSession(Date.parse('2026-07-01T15:00:00Z'));
  assert.equal(iso(edt.open), '2026-07-01T13:30:00.000Z');
  assert.equal(iso(edt.close), '2026-07-01T20:00:00.000Z');
  const est = regularSession(Date.parse('2026-01-05T15:00:00Z'));
  assert.equal(iso(est.open), '2026-01-05T14:30:00.000Z');
  // DST starts 2026-03-08: the Friday before is EST, the Monday after is EDT.
  assert.equal(iso(session('2026-03-06').open), '2026-03-06T14:30:00.000Z');
  assert.equal(iso(session('2026-03-09').open), '2026-03-09T13:30:00.000Z');
  // Early close 13:00 New York.
  assert.equal(iso(session('2025-11-28').close), '2025-11-28T18:00:00.000Z');
  assert.ok(isRegularBar('2026-07-01T19:59:00Z'));
  assert.ok(!isRegularBar('2026-07-01T20:00:00Z'), 'the 16:00 bar (closing cross / after-hours) is not regular');
  assert.ok(!isRegularBar('2026-07-01T13:29:00Z'), 'pre-market');
});

test('A1 detector never fires on pre-market or after-hours bars (the live SIP window includes them)', () => {
  // Burst in pre-market 08:00–08:02 New York (12:00–12:02Z in EDT).
  const pre = burstBars(Date.parse('2026-07-01T11:00:00Z'), Date.parse('2026-07-01T12:02:00Z'));
  assert.equal(detectSymbol('AAA', pre, { regularOnly: false }).length, 1, 'old behaviour: a pre-market signal');
  assert.equal(detectSymbol('AAA', pre).length, 0, 'fixed: pre-market bars are ignored');
  // Burst on the 16:00–16:02 bars (closing auction print, after-hours): the old code signalled after 16:00.
  const close = burstBars(Date.parse('2026-07-01T19:30:00Z'), Date.parse('2026-07-01T20:02:00Z'));
  const old = detectSymbol('AAA', close, { regularOnly: false });
  assert.ok(old.length && Date.parse(old.at(-1).detected_at) > Date.parse('2026-07-01T20:00:00Z'));
  assert.equal(detectSymbol('AAA', close).length, 0);
  // A regular-session burst is unchanged.
  const reg = burstBars(Date.parse('2026-07-01T14:00:00Z'), Date.parse('2026-07-01T14:30:00Z'));
  assert.deepEqual(detectSymbol('AAA', reg), detectSymbol('AAA', reg, { regularOnly: false }));
});

test('A1 pre-market bars no longer seed the opening baseline (the study starts at 09:30 with no history)', () => {
  // Quiet pre-market bars 08:00–09:29, then a burst 09:30–09:32 New York.
  const bars = burstBars(Date.parse('2026-07-01T12:00:00Z'), Date.parse('2026-07-01T13:32:00Z'));
  assert.equal(detectSymbol('AAA', bars, { regularOnly: false }).length, 1, 'old live behaviour: a 09:33 signal on a pre-market baseline');
  assert.equal(detectSymbol('AAA', bars).length, 0, 'the studied detector needs 13 regular bars first');
  const w = scanWindow(Date.parse('2026-07-01T14:10:00Z')); // 10:10 New York
  assert.ok(Date.parse(w.start) < Date.parse('2026-07-01T13:30:00Z'), 'the live window does reach into pre-market');
});

test('A2 entry is the first trade after the signal bar closed (no same-bar entry)', () => {
  const bars = burstBars(Date.parse('2026-07-01T14:00:00Z'), Date.parse('2026-07-01T14:30:00Z'));
  bars.push({ t: '2026-07-01T14:31:00Z', o: 1.07, h: 1.08, l: 1.06, c: 1.06, v: 1000, n: 5, vw: 1.07 });
  const [s] = detectSymbol('AAA', bars);
  // The burst qualifies after its second bar (14:29), so the decision is at 14:30:00, that bar's close.
  assert.equal(s.detected_at, '2026-07-01T14:30:00.000Z');
  assert.equal(s.price, 1.02, 'signal price = close of the 14:29 bar');
  const { close } = session('2026-07-01');
  const l = label(bars, Date.parse(s.detected_at), close, s);
  assert.equal(l.status, 'RESOLVED');
  // Entry = open of the 14:30 bar (1.00), the first trade after the decision; exit = last close (1.06).
  assert.ok(Math.abs(l.return_pct - ((1.06 / 1 - 1) * 100 - 0.5)) < 1e-9);
});

test('A3 daily eligibility uses the as-traded price, not one adjusted for a future reverse split', () => {
  const b = Array.from({ length: 30 }, (_, i) => ({ d: `2024-01-${String(i + 1).padStart(2, '0')}`, o: 6, h: 6.1, l: 5.9, c: 6, v: 100_000, rc: 0.3 }));
  // Adjusted $6 (after a later 1:20 reverse split) but the stock actually traded at $0.30 that day.
  assert.equal(eligible(b, 25), null);
  const noRaw = b.map(({ rc, ...x }) => x);
  assert.ok(eligible(noRaw, 25), 'without raw data the adjusted close is used (old behaviour)');
  assert.ok(eligible(b.map((x) => ({ ...x, rc: 3 })), 25), 'dollar volume is split invariant');
});

test('A4 daily win rate is net of the cost of its own column', () => {
  const acc = { days: {}, examples: {}, universe: {} };
  const b = Array.from({ length: 30 }, (_, i) => ({ d: `2024-02-${String(i + 1).padStart(2, '0')}`, o: 2, h: 2.02, l: 1.98, c: 2, v: 500_000, rc: 2 }));
  b[26] = { ...b[26], o: 2, c: 2.016 }; // +0.8% gross at H1 for the day-25 signal
  b.symbol = 'AAA';
  scanSymbol(b, acc);
  const cells = [acc.days.baseline.get(b[25].d)];
  assert.equal(stats(cells, 1, 0.5).win_rate, 1, '+0.8% gross wins after 0.5 pp');
  assert.equal(stats(cells, 1, 1.0).win_rate, 0, 'but loses after 1.0 pp');
});

test('exit rules: a stop gapped through fills at the open; cost is charged once, also for half exits', () => {
  const path = [
    { t: 0, o: 10, h: 10.1, l: 9.9, c: 10 },
    { t: 60_000, o: 9, h: 9.2, l: 8.9, c: 9.1 },
  ];
  assert.ok(Math.abs(applyRule(RULES.TP5_SL3_60, path, 10, Infinity, null) - (-10 - 0.5)) < 1e-9);
  const half = [{ t: 0, o: 10, h: 10.6, l: 10, c: 10.5 }, { t: 60_000, o: 10.5, h: 10.5, l: 10.0, c: 10.1 }];
  const expected = (0.5 * 0.05 + 0.5 * (Math.min(10.5, 10.6 * 0.97) / 10 - 1)) * 100 - 0.5;
  assert.ok(Math.abs(applyRule(RULES.HALF5_TRAIL3, half, 10, Infinity, null) - expected) < 1e-9);
});
