import test from 'node:test';
import assert from 'node:assert/strict';
import { features, outcomes, stats, analyze, CONDITIONS } from '../pipeline/filter_study.mjs';

const M = 60_000, at = Date.parse('2026-09-24T15:00:00Z'), close = Date.parse('2026-09-24T20:00:00Z');
const signal = { symbol: 'AAA', detected_at: new Date(at).toISOString(), price: 2.2, volume_ratio: 4, dollars_3m: 60000, breakout: true, stop: 2.1 };
const ctx = (over = {}) => ({
  news: new Map([['AAA', [at - 2 * 60 * M, at + 5 * M]]]), // one before, one after the signal
  daily: new Map([['AAA', [{ date: '2026-09-22', o: 1.8, c: 1.9, v: 1e6 }, { date: '2026-09-23', o: 1.9, c: 2.0, v: 2e6 }, { date: '2026-09-24', o: 2.2, c: 9, v: 9e9 }]]]),
  offerings: new Map([['AAA', ['2026-09-10', '2026-09-24']]]), // the same-day filing must not count
  short: new Map([['AAA', [{ date: '2026-08-31', short: 300, adv: 100 }, { date: '2026-09-15', short: 999, adv: 1 }]]]),
  bars: [{ t: at - 40 * M, c: 2.0 }, { t: at - 30 * M, c: 2.1 }, { t: at - 5 * M, c: 2.15 }],
  nth: 1, ...over,
});

test('features only use information from before the signal', () => {
  const f = features(signal, ctx());
  assert.equal(f.news24, 1, 'the article after the signal is ignored');
  assert.equal(f.news1, 0);
  assert.ok(Math.abs(f.gap - 10) < 1e-9, 'gap uses today open vs previous close');
  assert.ok(Math.abs(f.day - 10) < 1e-9, 'day change uses the signal price, never today\'s close');
  assert.equal(f.prevUsd, 4e6);
  assert.equal(f.offering30, true, 'a filing 14 days earlier counts');
  assert.equal(f.dtc, 3, 'the 2026-09-15 settlement is inside the 14-day publication lag and ignored');
  assert.ok(Math.abs(f.runup - (2.2 / 2.1 - 1) * 100) < 1e-9);
  const noEarly = features(signal, ctx({ offerings: new Map([['AAA', ['2026-09-24']]]) }));
  assert.equal(noEarly.offering30, false);
});

test('conditions read the features they name', () => {
  const f = features(signal, ctx());
  assert.ok(CONDITIONS.news_24h(f) && CONDITIONS.gap_up_10(f) && CONDITIONS.day_10_30(f) && CONDITIONS.dtc_ge3(f) && CONDITIONS.first_today(f));
  assert.ok(!CONDITIONS.news_1h(f) && !CONDITIONS.usd3_ge250k(f));
});

test('delayed and immediate outcomes come from the right entry bars', () => {
  const bars = [0, 1, 17, 18, 27, 30].map((m) => ({ t: at + m * M, o: 2 + m / 100, h: 2 + m / 100, l: 2 + m / 100, c: 2 + m / 100 }));
  const o = outcomes(bars, signal, close);
  assert.ok(Math.abs(o.now_T10 - ((2.01 / 2 - 1) * 100 - 0.5)) < 1e-6);
  assert.ok(Math.abs(o.late_T10 - ((2.18 / 2.17 - 1) * 100 - 0.5)) < 1e-3);
});

test('selection happens on development; candidates hold only if the holdout interval is above zero', () => {
  const mk = (date, good) => ({ date, rows: Array.from({ length: 400 }, (_, i) => ({
    f: { ...features(signal, ctx()), bo: i % 2 === 0 }, o: { late_T10: i % 2 === 0 ? (good ? 1 : -1) : -0.5, now_T10: 0, now_T30: 0 },
  })) });
  const days = [...Array.from({ length: 6 }, (_, i) => mk(`2026-01-0${i + 1}`, true)), ...Array.from({ length: 3 }, (_, i) => mk(`2026-02-0${i + 1}`, false))];
  const r = analyze(days);
  assert.equal(r.split.holdout_from, '2026-02-01');
  assert.ok(r.top_development[0].name.includes('breakout'));
  assert.equal(r.candidates[0].development.mean_pct, 1);
  assert.equal(r.candidates[0].holdout.mean_pct, -1);
  assert.equal(r.any_candidate_holds, false);
  assert.deepEqual(stats([[]], () => true, 'late_T10').trades, 0);
});
