// Journal outcomes (review-outcomes J1): fixed 30-minute window inside the starting session,
// cost-adjusted result and a sourced start price.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSignalEvent, createWatchEvent, recordObservation, outcome, restoreJournal, sessionEnd, windowEnd, OUTCOME_HORIZON_MS,
} from '../src/core/journal.js';

const iso = (ms) => new Date(ms).toISOString();
const T = Date.parse('2026-09-28T14:00:00Z'); // 10:00 EDT, Monday
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≉ ${b}`);

test('window: 30 minutes, cut at the end of the session the record started in (DST, early close)', () => {
  assert.equal(windowEnd(iso(T)), T + OUTCOME_HORIZON_MS);
  assert.equal(windowEnd('2026-09-28T19:50:00Z'), Date.parse('2026-09-28T20:00:00Z')); // 15:50 EDT → 16:00 close
  assert.equal(windowEnd('2026-12-01T20:50:00Z'), Date.parse('2026-12-01T21:00:00Z')); // 15:50 EST → 16:00 EST
  assert.equal(windowEnd('2026-11-27T17:45:00Z'), Date.parse('2026-11-27T18:00:00Z')); // early close 13:00 EST
  assert.equal(windowEnd('2026-09-28T13:20:00Z'), Date.parse('2026-09-28T13:30:00Z')); // pre-market 09:20 → 09:30
  assert.equal(windowEnd('2026-09-28T23:50:00Z'), Date.parse('2026-09-29T00:00:00Z')); // after-hours 19:50 → 20:00
  assert.equal(sessionEnd(Date.parse('2026-09-29T02:00:00Z')), null); // 22:00, no session
  assert.equal(windowEnd('2026-09-26T15:00:00Z'), Date.parse('2026-09-26T15:00:00Z')); // Saturday: empty window
});

test('samples after the window or in the next session never change the outcome', () => {
  const alert = { symbol: 'AAA', detected_at: iso(T), price: 2, price_at: iso(T - 2_000), price_source: 'IEX' };
  let e = createSignalEvent(alert, { now: T + 1_000, feed: 'iex', name: 'A' });
  assert.equal(e.start_price_source, 'IEX');
  assert.equal(e.window_end, iso(T + OUTCOME_HORIZON_MS));
  e = recordObservation(e, { price: 2.2, price_at: iso(T + 10 * 60_000), price_source: 'CONSOLIDATED' });
  e = recordObservation(e, { price: 1.9, price_at: iso(T + 29 * 60_000) });
  const inside = e;
  e = recordObservation(e, { price: 5, price_at: iso(T + 31 * 60_000) }); // after 30 minutes
  e = recordObservation(e, { price: 5, price_at: iso(T + 24 * 3600_000) }); // the next day
  assert.equal(e, inside);
  assert.equal(e.points[0].source, 'CONSOLIDATED');
  const o = outcome(e, T + 31 * 60_000);
  close(o.change, -5);
  close(o.net, -5.5); // after the 0.5 pp minimum round trip
  close(o.maximum, 10);
  assert.equal(o.complete, true);
  assert.equal(outcome(e, T + 60_000).complete, false);
});

test('start price keeps its source; the feed is the fallback', () => {
  const w = createWatchEvent({ symbol: 'BBB', price: 3, price_at: iso(T - 1_000) }, { now: T, feed: 'iex' });
  assert.equal(w.start_price_source, 'SCANNER_IEX');
  const c = createWatchEvent({ symbol: 'BBB', price: 3, price_at: iso(T - 1_000), price_source: 'CONSOLIDATED' }, { now: T, feed: 'iex' });
  assert.equal(c.start_price_source, 'CONSOLIDATED');
});

test('restoring an old record cuts it back to its window and recomputes the extremes', () => {
  const old = {
    id: 'SIGNAL:AAA:x', kind: 'SIGNAL', symbol: 'AAA', started_at: iso(T), start_price: 2, feed: 'iex', min: 1, max: 9, last_price: 9, last_at: iso(T + 86_400_000),
    points: [{ at: iso(T + 60_000), price: 2.1 }, { at: iso(T + 20 * 60_000), price: 1.8 }, { at: iso(T + 3 * 3600_000), price: 1 }, { at: iso(T + 86_400_000), price: 9 }],
  };
  const [e] = restoreJournal({ schema: 1, events: [old] });
  assert.equal(e.points.length, 2);
  assert.deepEqual([e.min, e.max, e.last_price, e.last_at], [1.8, 2.1, 1.8, iso(T + 20 * 60_000)]);
  assert.equal(e.start_price_source, 'SCANNER_IEX');
  assert.equal(e.window_end, iso(T + OUTCOME_HORIZON_MS));
});
