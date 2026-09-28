import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, observe, dbPath } from '../src/store.mjs';
import { createPulse } from '../src/pulse.mjs';

test('database path comes from TAGIT_DB_PATH or the Railway volume', () => {
  assert.equal(dbPath({ TAGIT_DB_PATH: '/x/a.sqlite', RAILWAY_VOLUME_MOUNT_PATH: '/data' }), '/x/a.sqlite');
  assert.equal(dbPath({ RAILWAY_VOLUME_MOUNT_PATH: '/data' }), '/data/tagit.sqlite');
  assert.equal(dbPath({}), null);
});

test('observations: horizons, max/min, stop hit; prices before detection ignored', () => {
  const t0 = Date.parse('2026-09-29T14:00:00Z');
  const e = { symbol: 'S', detected_at: new Date(t0).toISOString(), price: 10, stop: 9.8 };
  assert.equal(observe(e, 11, t0 - 1000), false);
  assert.equal(observe(e, 10.2, t0 + 60_000), true);
  assert.equal(e.observed.max_return_pct, 2);
  observe(e, 10.5, t0 + 5 * 60_000);
  assert.equal(e.observed.m5.return_pct, 5);
  observe(e, 9.7, t0 + 16 * 60_000);
  assert.equal(e.observed.m15.price, 9.7);
  assert.equal(e.observed.min_return_pct, -3);
  assert.ok(e.observed.stop_hit_at);
  assert.equal(e.observed.m5.price, 10.5); // first price after the horizon is kept
});

test('the pulse ledger survives a restart through the store', () => {
  const store = openStore(':memory:');
  const entry = { symbol: 'SURG', detected_at: '2026-09-29T14:00:00.000Z', price: 5, stop: 4.9, rules: 'discovery-1c', observed: {} };
  store.record(entry);
  observe(entry, 5.2, Date.parse('2026-09-29T14:06:00Z'));
  store.observe(entry);
  assert.equal(store.count(), 1);
  const board = { snapshot: () => new Map(), get: async () => ({}) };
  const pulse = createPulse({ board, store, now: () => Date.parse('2026-09-29T15:00:00Z') });
  assert.equal(pulse.ledger()[0].symbol, 'SURG');
  assert.equal(pulse.ledger()[0].observed.m5.return_pct, 4);
  assert.equal(pulse.status().storage.kind, 'SQLITE');
  assert.equal(pulse.status().storage.signals, 1);
  store.close();
});

test('without a store the pulse reports memory storage and the reason', () => {
  const pulse = createPulse({ board: { snapshot: () => new Map() }, storeError: 'EACCES' });
  assert.deepEqual(pulse.status().storage, { kind: 'MEMORY', error: 'EACCES' });
});
