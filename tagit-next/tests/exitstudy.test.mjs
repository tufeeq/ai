import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRule, RULES, evaluateSignal, ruleStats, report } from '../pipeline/exit_study.mjs';

const M = 60_000, T0 = Date.parse('2026-09-25T14:00:00Z'), CLOSE = Date.parse('2026-09-25T20:00:00Z');
const bar = (m, o, h, l, c) => ({ t: T0 + m * M, o, h, l, c });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('time exits carry the last trade and cap at the close', () => {
  const path = [bar(0, 10, 10, 10, 10), bar(5, 10, 11, 10, 11), bar(40, 11, 12, 11, 12)];
  near(applyRule(RULES.T30, path, 10, CLOSE), 10 - 0.5); // exit at 11 (the 40-minute bar is after 30)
  near(applyRule(RULES.T60, path, 10, CLOSE), 20 - 0.5);
  near(applyRule(RULES.T60, path, 10, T0 + 20 * M), 10 - 0.5); // close at 20 minutes
});

test('a bar touching both stop and target counts as the stop; a gap through the stop exits at the open', () => {
  near(applyRule(RULES.TP5_SL3_60, [bar(0, 10, 10, 10, 10), bar(1, 10, 10.6, 9.6, 10.2)], 10, CLOSE), -3 - 0.5);
  near(applyRule(RULES.TP5_SL3_60, [bar(0, 10, 10, 10, 10), bar(1, 9.0, 9.2, 8.9, 9.1)], 10, CLOSE), -10 - 0.5);
  near(applyRule(RULES.TP5_SL3_60, [bar(0, 10, 10, 10, 10), bar(1, 10.1, 10.6, 10.0, 10.5)], 10, CLOSE), 5 - 0.5);
});

test('trailing stop follows earlier highs, not the high of the bar that breaks it', () => {
  const path = [bar(0, 10, 10, 10, 10), bar(1, 10, 12, 10, 12), bar(2, 12, 12.2, 11.5, 11.6)];
  near(applyRule(RULES.TRAIL3, path, 10, CLOSE), (12 * 0.97 / 10 - 1) * 100 - 0.5);
});

test('half at +5% then trailing 3% on the rest', () => {
  const path = [bar(0, 10, 10, 10, 10), bar(1, 10, 10.6, 10, 10.6), bar(2, 10.6, 11, 10.6, 11), bar(3, 11, 11, 10.5, 10.6)];
  near(applyRule(RULES.HALF5_TRAIL3, path, 10, CLOSE), (0.5 * 0.05 + 0.5 * (11 * 0.97 / 10 - 1)) * 100 - 0.5);
});

test('detector stop is used only below the entry', () => {
  const path = [bar(0, 10, 10, 10, 10), bar(1, 10, 10, 9.4, 9.5)];
  near(applyRule(RULES.DSTOP60, path, 10, CLOSE, 9.5), -5 - 0.5);
  near(applyRule(RULES.DSTOP60, path, 10, CLOSE, 11), -5 - 0.5); // invalid stop ignored: time exit at 9.5
});

test('evaluateSignal gives both entries; no bar inside the window means no entry', () => {
  const bars = [bar(0, 10, 10, 10, 10), bar(10, 10, 10, 10, 10.5), bar(18, 10.5, 10.5, 10.5, 10.5), bar(30, 11, 11, 11, 11)];
  const r = evaluateSignal(bars, { detected_at: new Date(T0).toISOString(), stop: 9 }, CLOSE);
  assert.equal(Object.keys(r.now).length, Object.keys(RULES).length);
  assert.ok(r.late, 'bar at +18 min is inside the delayed window');
  assert.equal(evaluateSignal(bars, { detected_at: new Date(T0 + 3 * M).toISOString(), stop: 9 }, CLOSE).now, null);
});

test('report selects on development only and resamples whole sessions reproducibly', () => {
  const day = (date, x) => ({ date, signals: Array.from({ length: 1000 }, () => ({ now: Object.fromEntries(Object.keys(RULES).map((k) => [k, k === 'T60' ? x + 1 : x])), late: null })) });
  const r = report([day('2026-01-02', 0.2), day('2026-01-05', -0.1), day('2026-01-06', -5)]);
  assert.equal(r.selected_on_development, 'T60');
  assert.equal(r.split.holdout_from, '2026-01-06');
  assert.equal(r.selected_holdout.mean_pct, -4);
  assert.deepEqual(ruleStats([day('d', 1)], 'now').T10, ruleStats([day('d', 1)], 'now').T10);
});
