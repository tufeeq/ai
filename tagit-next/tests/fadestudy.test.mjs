import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, shortTrade, longTrade, shortNet, scanSymbol, analyze, STOP_SLIP, flagList } from '../pipeline/fade_study.mjs';
import { extensionEvents, fadeWarning } from '../src/core/fade.js';
import { eligible } from '../pipeline/daily_study.mjs';

const addDays = (start, i) => new Date(Date.parse(`${start}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
function series(n, start = '2024-01-01', price = 2, vol = 500_000) {
  const b = Array.from({ length: n }, (_, i) => ({ d: addDays(start, i), o: price, h: price * 1.01, l: price * 0.99, c: price, v: vol }));
  b.symbol = 'AAA';
  return b;
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('short enters at the next open and covers at the close after H sessions', () => {
  const b = series(40);
  b[26] = { ...b[26], o: 2.5, h: 2.6, c: 2.4 };
  b[28] = { ...b[28], c: 2.0 };
  const t = shortTrade(b, 25, 3, 0.25, '2099-01-01');
  assert.equal(t.kind, 'time');
  assert.ok(near(t.gross, (1 - 2.0 / 2.5) * 100));
  assert.equal(t.days, 2);
  assert.ok(near(longTrade(b, 25, 3, '2099-01-01'), (2.0 / 2.5 - 1) * 100));
});

test('stop covers at the stop level plus slippage, or at a gapped open beyond it', () => {
  const b = series(40);
  b[26] = { ...b[26], o: 2.0, h: 2.6, c: 2.1 }; // high reaches 2.5 = +25% on the entry day
  const t = shortTrade(b, 25, 5, 0.25, '2099-01-01');
  assert.equal(t.kind, 'stop');
  assert.ok(near(t.gross, (1 - 2.5 * (1 + STOP_SLIP) / 2.0) * 100));
  const g = series(40);
  g[26] = { ...g[26], o: 2.0, h: 2.1, c: 2.1 };
  g[27] = { ...g[27], o: 4.0, h: 4.2, l: 3.9, c: 4.1 }; // halt/news gap far through the stop
  const t2 = shortTrade(g, 25, 5, 0.25, '2099-01-01');
  assert.equal(t2.kind, 'stop_gap');
  assert.ok(near(t2.gross, (1 - 4.0 * (1 + STOP_SLIP) / 2.0) * 100), 'loss is the gap, not the stop');
  assert.ok(t2.gross < -100, 'shorts can lose more than 100%');
  assert.equal(shortTrade(g, 25, 5, null, '2099-01-01').kind, 'time', 'no stop rides the squeeze');
});

test('delisted names cover at their last close; the end of the data drops the trade', () => {
  const b = series(28);
  const t = shortTrade(b, 25, 5, 0.25, '2099-01-01');
  assert.equal(t.kind, 'ended');
  assert.equal(t.days, 1);
  assert.equal(shortTrade(b, 25, 5, 0.25, b.at(-1).d), null);
  assert.equal(longTrade(b, 25, 5, b.at(-1).d), null);
});

test('net short return subtracts the round trip and borrow by calendar days', () => {
  const t = { gross: 10, days: 73 };
  assert.ok(near(shortNet(t, 0.5), 10 - 0.5 - 0.5 * 0.2 * 100));
  assert.ok(near(shortNet(t, 0), 9.5));
});

test('events use only bars through day t', () => {
  const b = series(40);
  b[25] = { ...b[25], o: 2, h: 3.2, l: 1.98, c: 3.15, v: 3_000_000 };
  const ctx = eligible(b, 25);
  assert.ok(EVENTS.spike_50(b, 25, ctx));
  assert.ok(EVENTS.strong_close(b, 25, ctx));
  b[26] = { ...b[26], c: 99, h: 99 };
  assert.ok(EVENTS.spike_50(b, 25, eligible(b, 25)));
});

function world(devShortWins, holdShortWins) {
  const acc = { trades: [], base: new Map(), universe: {} };
  const sessions = new Set();
  for (let k = 0; k < 80; k++) {
    for (const [start, wins] of [['2019-03-01', holdShortWins], ['2024-03-01', devShortWins]]) {
      const b = series(90, start);
      // Event every 15 sessions; the path after it stays put through H10, then returns to $2.
      for (let i = 22; i < 70; i += 15) {
        b[i] = { ...b[i], o: 2, h: 2.5, l: 1.98, c: 2.48, v: 3_000_000 };
        b[i + 1] = { ...b[i + 1], o: 2.48, h: 2.6, l: 1.9, c: wins ? 2.0 : 2.55 };
        for (let j = i + 2; j <= i + 11; j++) b[j] = { ...b[j], o: b[j - 1].c, h: b[j - 1].c * 1.01, l: b[j - 1].c * 0.99, c: b[j - 1].c };
      }
      b.symbol = `S${k}`;
      scanSymbol(b, acc, '2099-01-01', { etb: k % 2 === 0 });
      for (let i = 21; i < 90; i++) sessions.add(b[i].d);
    }
  }
  return analyze(acc, [...sessions].sort());
}

test('selection happens on development and the untouched holdout decides', () => {
  const bad = world(true, false);
  assert.ok(bad.short.selected, 'a profitable development configuration is selected');
  assert.ok(bad.short.selected.development.mean_pct > 0);
  assert.ok(bad.short.selected.holdout.mean_pct < 0);
  assert.equal(bad.short.holds, false);
  assert.equal(bad.eras.holdout.from.slice(0, 4), '2019');
  const good = world(true, true);
  assert.equal(good.short.holds, true);
  assert.equal(good.avoid.holds, true, 'flagged longs underperform the unflagged baseline');
  assert.ok(good.avoid.primary.holdout.diff_ci95[1] < 0);
  assert.ok(good.short.sensitivity.holdout.none['300'].trades > 0);
  const none = world(false, true);
  assert.equal(none.short.selected, null, 'nothing is selected when no short is positive in development');
  assert.equal(none.short.holds, false);
  assert.equal(none.short.reference.event, 'extended_any');
});

test('the site rules are identical to the tested pipeline rules', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let hits = 0;
  for (let k = 0; k < 40; k++) {
    const b = series(120);
    let p = 2;
    for (let i = 1; i < b.length; i++) {
      const jump = rnd() < 0.08 ? 1 + rnd() * 0.8 : 1 + (rnd() - 0.5) * 0.12;
      const o = p * (rnd() < 0.1 ? 1 + rnd() * 0.3 : 1), c = p * jump;
      b[i] = { d: b[i].d, o, h: Math.max(o, c) * (1 + rnd() * 0.05), l: Math.min(o, c) * (1 - rnd() * 0.05), c, v: 400_000 * (1 + rnd() * 6) };
      p = c > 15 ? 2 : c;
    }
    for (let i = 21; i < b.length; i++) {
      const ctx = eligible(b, i);
      const pipe = ctx ? Object.keys(EVENTS).filter((e) => EVENTS[e](b, i, ctx)) : [];
      assert.deepEqual(extensionEvents(b, i), pipe);
      hits += pipe.length;
    }
  }
  assert.ok(hits > 20, 'the random walk produced events');
});

test('flag list keeps events of the last five completed sessions; the warning expires after them', () => {
  const b = series(40, '2026-08-01');
  b[35] = { ...b[35], o: 2, h: 3.2, l: 1.98, c: 3.15, v: 3_000_000 };
  const out = flagList(new Map([['AAA', b]]), new Date('2026-09-15T12:00:00Z'));
  assert.equal(out.as_of, b[39].d);
  assert.deepEqual(out.symbols.AAA.events, ['strong_close', 'momentum_5d', 'spike_50']);
  assert.equal(fadeWarning(out, 'AAA').sessions_since, 4);
  assert.equal(fadeWarning(out, 'ZZZ'), null);
  const later = flagList(new Map([['AAA', series(41, '2026-08-01').map((x, i) => (i < 40 ? b[i] : x))]]), new Date('2026-09-15T12:00:00Z'));
  assert.equal(fadeWarning(later, 'AAA'), null, 'six sessions later the warning is gone');
});
