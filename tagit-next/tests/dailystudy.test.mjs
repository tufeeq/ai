import test from 'node:test';
import assert from 'node:assert/strict';
import { HYPOTHESES, eligible, outcome, scanSymbol, analyze, stats } from '../pipeline/daily_study.mjs';

const day = (i) => new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
function series(n, price = 2, vol = 500_000) {
  const b = Array.from({ length: n }, (_, i) => ({ d: day(i), o: price, h: price * 1.01, l: price * 0.99, c: price, v: vol }));
  b.symbol = 'AAA';
  return b;
}

test('eligibility is point in time: price band, average dollar volume and history', () => {
  const b = series(30);
  assert.equal(eligible(b, 10), null, 'needs 21 prior bars');
  assert.ok(eligible(b, 25));
  const thin = series(30, 2, 1000);
  assert.equal(eligible(thin, 25), null);
  const pricey = series(30, 25);
  assert.equal(eligible(pricey, 25), null);
});

test('strong_close fires on a 20%+ day closing near the high with a volume burst, using only that day', () => {
  const b = series(30);
  b[25] = { d: day(25), o: 2, h: 2.5, l: 1.98, c: 2.48, v: 2_000_000 };
  const ctx = eligible(b, 25);
  assert.ok(HYPOTHESES.strong_close(b, 25, ctx));
  b[26] = { ...b[26], c: 99 }; // the future never changes the decision
  assert.ok(HYPOTHESES.strong_close(b, 25, eligible(b, 25)));
  assert.ok(!HYPOTHESES.flush_rebound(b, 25, ctx));
});

test('outcome enters at the next open and exits at later closes', () => {
  const b = series(30);
  b[26] = { ...b[26], o: 2.5 };
  b[26].c = 2.75; b[28].c = 2.0; b[30] = undefined;
  const o = outcome(b, 25, 0.5);
  assert.ok(Math.abs(o[1] - (10 - 0.5)) < 1e-9);
  assert.ok(Math.abs(o[3] - (-20 - 0.5)) < 1e-9);
  assert.equal(o[5], null);
});

test('analysis selects on development and requires the holdout interval above zero and above baseline', () => {
  const acc = { days: {}, examples: {}, universe: {} };
  const sessions = [];
  for (let k = 0; k < 80; k++) {
    const b = series(60);
    // A strong close each 5th day; the next open is flat and later closes rise in the first 40 days only.
    for (let i = 22; i < 55; i += 5) {
      b[i] = { d: day(i), o: 2, h: 2.5, l: 1.98, c: 2.48, v: 3_000_000 };
      b[i + 1] = { d: day(i + 1), o: 2.48, h: 3, l: 2.4, c: i < 40 ? 2.9 : 2.2, v: 500_000 };
    }
    b.symbol = `S${k}`;
    scanSymbol(b, acc);
  }
  for (let i = 21; i < 59; i++) sessions.push(day(i));
  const r = analyze(acc, sessions);
  assert.ok(r.selected, 'a hypothesis is selected');
  assert.equal(r.selected.hypothesis, 'strong_close');
  assert.ok(r.selected.development.mean_pct > 0);
  assert.ok(r.selected.holdout.mean_pct < 0);
  assert.equal(r.holds, false);
  assert.equal(stats([], 1, 0.5).trades, 0);
  const none = analyze({ days: { baseline: acc.days.baseline }, examples: {}, universe: {} }, sessions);
  assert.equal(none.selected, null, 'nothing is selected when no hypothesis is positive in development');
});
