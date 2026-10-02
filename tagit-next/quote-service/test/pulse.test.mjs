import test from 'node:test';
import assert from 'node:assert/strict';
import { chartBars, consolidatedSignal, rankCandidates, applySignals, completePlans, createPulse, regularMinute, chartUrl } from '../src/pulse.mjs';

// Monday 2026-09-28, 10:00 New York (EDT) = 14:00 UTC.
const open = Date.parse('2026-09-28T13:30:00Z');
const at = (min) => open + min * 60_000;
/** 30 quiet minutes around $5.00, then a 3-minute consolidated surge on heavy volume. */
// Nasdaq.com writes New York wall-clock time as if it were UTC (EDT: 4 hours earlier than the instant).
const wall = (ms) => ms - 4 * 3600_000;
function chart({ surge = true } = {}) {
  const pts = [{ x: wall(open - 60_000 * 30), y: 4.9, w: 500 }]; // pre-market print: not a regular bar
  for (let m = 0; m < 30; m++) pts.push({ x: wall(at(m)), y: 5 + (m % 2) * 0.01, w: 1000 });
  const up = surge ? [[30, 5.03, 12000], [31, 5.06, 15000], [32, 5.1, 18000]] : [[30, 5.01, 900], [31, 5, 1100], [32, 5.01, 1000]];
  for (const [m, y, w] of up) pts.push({ x: wall(at(m)), y, w, z: { shares: String(w) } });
  return { data: { chart: pts } };
}

test('Nasdaq.com wall-clock chart times convert to real instants (EDT and EST)', async () => {
  const { nasdaqWallToUtc } = await import('../src/pulse.mjs');
  // Observed: "4:00 AM ET" on 2026-09-28 arrives as x = 1790568000000 (= 04:00Z).
  assert.equal(new Date(nasdaqWallToUtc(1790568000000)).toISOString(), '2026-09-28T08:00:00.000Z');
  assert.equal(new Date(nasdaqWallToUtc(Date.parse('2026-12-01T09:30:00Z'))).toISOString(), '2026-12-01T14:30:00.000Z');
});

test('regular session only, weekdays', () => {
  assert.equal(regularMinute(at(0)), true);
  assert.equal(regularMinute(open - 60_000), false);
  assert.equal(regularMinute(Date.parse('2026-09-27T15:00:00Z')), false); // Sunday
  assert.match(chartUrl('SENS'), /SENS\/chart\?assetclass=stocks&charttype=rs$/);
});

test('chart points become regular-session minute bars with synthetic high/low from closes', () => {
  const bars = chartBars(chart());
  assert.equal(bars.length, 33);
  assert.equal(bars[0].o, 4.9); // previous (pre-market) close opens the first regular minute
  assert.equal(bars.at(-1).c, 5.1);
  assert.equal(bars.at(-1).h, 5.1);
  assert.equal(bars.at(-1).l, 5.06);
  assert.equal(bars.at(-1).n, null);
});

test('discovery-1 on consolidated bars fires without the trade-count rule', () => {
  const now = at(33) + 10_000; // the 32nd minute bar is complete
  const s = consolidatedSignal(chartBars(chart()), now);
  assert.equal(s.ready, true);
  assert.equal(s.trades_3m, null);
  assert.ok(s.return_3m >= 0.7, String(s.return_3m));
  assert.ok(s.volume_ratio >= 2);
  assert.ok(s.dollars_3m >= 25_000);
  assert.equal(s.expansion, true);
  assert.equal(s.source, 'CONSOLIDATED_NASDAQ');
  assert.equal(consolidatedSignal(chartBars(chart({ surge: false })), now).expansion, false);
  // A stale chart (last bar long ago) is not "ready".
  assert.equal(consolidatedSignal(chartBars(chart()), now + 10 * 60_000).expansion, false);
});

test('candidates need both a consolidated move and dollar volume', () => {
  const t = at(40);
  const h = new Map([
    ['MOVE', [{ at: t - 240_000, price: 5, volume: 100_000 }, { at: t - 10_000, price: 5.1, volume: 110_000 }]],
    ['THIN', [{ at: t - 240_000, price: 5, volume: 100_000 }, { at: t - 10_000, price: 5.2, volume: 100_100 }]],
    ['FLAT', [{ at: t - 240_000, price: 5, volume: 100_000 }, { at: t - 10_000, price: 5.005, volume: 200_000 }]],
  ]);
  assert.deepEqual(rankCandidates(h, t).map((c) => c.symbol), ['MOVE']);
});

test('pulse fetches charts for movers and exposes fresh signals and a ledger', async () => {
  let t = at(33) + 10_000;
  const snap = new Map([['SURG', { price: 5.0, volume: 100_000, fetched_at: new Date(t - 200_000).toISOString() }]]);
  const board = { snapshot: () => snap, get: async () => ({}) };
  const seen = [];
  const pulse = createPulse({ board, now: () => t, fetcher: async (url) => { seen.push(url); return { ok: true, status: 200, json: async () => chart() }; }, onExpansion: (s) => seen.push('prefetch:' + s) });
  pulse._sample();
  snap.set('SURG', { price: 5.1, volume: 160_000, fetched_at: new Date(t - 5_000).toISOString() });
  await pulse._cycle();
  assert.deepEqual(pulse._queue(), ['SURG']);
  await pulse._fetchChart('SURG');
  assert.ok(seen.includes('prefetch:SURG'));
  assert.equal(pulse.signal('SURG').expansion, true);
  assert.equal(pulse.ledger()[0].symbol, 'SURG');
  t += 10 * 60_000;
  const held = pulse.signal('SURG'); // the expansion's plan levels outlive the 3-minute burst
  assert.equal(held.held, true);
  assert.equal(held.expansion, true);
  assert.equal(pulse.status().live_signals, 1);
  t += 15 * 60_000;
  assert.equal(pulse.signal('SURG'), null); // older than 20 minutes
  assert.equal(pulse.status().live_signals, 0);
});

test('scanner rows take the consolidated signal; plans need a fresh consolidated quote', () => {
  const t = at(33) + 10_000;
  const s = consolidatedSignal(chartBars(chart()), t);
  const pulse = { signal: (sym) => (sym === 'SURG' ? s : null), status: () => ({ status: 'OK' }) };
  const scan = { rows: [{ symbol: 'SURG', price: 5.1, day_change: 4, signal: { ready: false }, actionable: false }, { symbol: 'IDLE', price: 2, signal: null }] };
  const applied = applySignals(scan, pulse, t);
  assert.equal(applied.rows[0].signal.source, 'CONSOLIDATED_NASDAQ');
  assert.equal(applied.rows[0].stage.startsWith('B') || applied.rows[0].stage === 'EXPANSION', true);
  assert.equal(applied.rows[1].signal, null);
  const noQuote = completePlans(applied, t);
  assert.equal(noQuote.rows[0].actionable, false);
  assert.ok(noQuote.rows[0].plan_blockers.includes('NO_FRESH_QUOTE'));
  // An IEX quote under a minute old also qualifies; a 2-minute-old one does not.
  const iex = (age) => completePlans({ rows: [{ ...applied.rows[0], bid: 5.09, ask: 5.1, quote_at: new Date(t - age).toISOString() }] }, t).rows[0];
  assert.equal(iex(30_000).actionable, true);
  assert.equal(iex(30_000).plan.quote_source, 'IEX');
  assert.equal(iex(120_000).actionable, false);
  // Wide spread, price past the entry zone, or below the stop: no plan, with the reason.
  const wide = completePlans({ rows: [{ ...applied.rows[0], bid: 4.9, ask: 5.1, quote_at: new Date(t).toISOString() }] }, t).rows[0];
  assert.deepEqual(wide.plan_blockers, ['WIDE_SPREAD']);
  const chased = completePlans({ rows: [{ ...applied.rows[0], price: s.trigger * 1.05, bid: 5.09, ask: 5.1, quote_at: new Date(t).toISOString() }] }, t).rows[0];
  assert.ok(chased.plan_blockers.includes('PAST_ENTRY'));
  // A held expansion past 20 minutes no longer plans.
  const old = completePlans({ rows: [{ ...applied.rows[0], signal: { ...s, detected_at: new Date(t - 21 * 60_000).toISOString() }, bid: 5.09, ask: 5.1, quote_at: new Date(t).toISOString() }] }, t).rows[0];
  assert.ok(old.plan_blockers.includes('SIGNAL_OLD'));
  const quoted = { ...applied, rows: applied.rows.map((r) => r.symbol === 'SURG' ? { ...r, consolidated: { price: 5.1, bid: 5.09, ask: 5.1, real_time: true, fetched_at: new Date(t - 5_000).toISOString() } } : r) };
  const done = completePlans(quoted, t);
  const row = done.rows[0];
  assert.equal(row.actionable, s.plan_valid && 5.1 <= s.trigger * 1.02 && 5.1 > s.stop);
  assert.equal(row.actionable, true);
  if (row.actionable) {
    assert.ok(row.plan.entry >= s.trigger && row.plan.entry > row.plan.stop);
    assert.equal(row.plan.targets.length, 2);
  }
  // Extended moves never get a plan.
  const ext = completePlans({ rows: [{ ...quoted.rows[0], extended: true }] }, t);
  assert.equal(ext.rows[0].actionable, false);
});
