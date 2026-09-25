import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMarketRow, assess, splitPriority } from '../opportunity.mjs';
import { riskOf, companyFacts } from '../src/core/risk.js';
import { freshness } from '../src/format.js';

const now = Date.parse('2026-09-25T15:00:30Z');
const at = (d) => new Date(now + d).toISOString();
const base = {
  symbol: 'AAA', price: 2.02, price_at: at(-40_000), quote_at: at(-40_000), bid: 2.019, ask: 2.02, previous_close: 1.9,
  scan_at: at(-1000), extended: false, actionable: true, plan: { entry: 2.02, stop: 1.98, targets: [2.06, 2.1] },
  signal: { ready: true, bar_at: at(-70_000), bars: 20, return_3m: 1, volume_ratio: 3, dollars_3m: 50000, trades_3m: 100, volume_concentration: 0.5, vwap_window: 2, plan_valid: true },
};
const overlay = (o = {}) => ({ source: 'NASDAQ_COM', real_time: true, price: 2.03, trade_minute_at: '2026-09-25T15:00:00.000Z', bid: 2.025, ask: 2.03, volume: 900000, fetched_at: at(-5000), ...o });

test('a newer consolidated minute replaces a stale IEX trade and quote, and is labeled', () => {
  const row = mergeMarketRow(base, { ...base, consolidated: overlay() }, { scan: true, now });
  assert.equal(row.price, 2.03);
  assert.equal(row.price_source, 'CONSOLIDATED');
  assert.equal(row.quote_source, 'CONSOLIDATED');
  assert.equal(row.bid, 2.025);
});

test('an IEX trade inside the same minute still wins over the minute start', () => {
  const iex = { ...base, price: 2.01, price_at: at(-10_000) }; // 15:00:20 beats 15:00:00
  const row = mergeMarketRow(iex, { ...iex, consolidated: overlay() }, { scan: true, now });
  assert.equal(row.price, 2.01);
  assert.equal(row.price_source, 'IEX');
});

test('a non-real-time or crossed overlay is ignored', () => {
  assert.equal(mergeMarketRow(base, { ...base, consolidated: overlay({ real_time: false }) }, { scan: true, now }).price_source, 'IEX');
  const crossed = mergeMarketRow(base, { ...base, consolidated: overlay({ bid: 3, ask: 2 }) }, { scan: true, now });
  assert.equal(crossed.quote_source, 'IEX');
});

test('freshness windows follow the source: 2 minutes for consolidated trades, 15 s for IEX', () => {
  const row = mergeMarketRow(base, { ...base, consolidated: overlay() }, { scan: true, now });
  const a = assess(row, { now, serverTime: row.scan_at });
  assert.ok(a.checks.find((c) => c.key === 'trade').pass);
  assert.ok(a.checks.find((c) => c.key === 'quote').pass);
  assert.ok(a.plan, 'all checks pass with a fresh consolidated trade and quote');
  const later = assess(row, { now: now + 125_000, serverTime: row.scan_at });
  assert.equal(later.checks.find((c) => c.key === 'trade').pass, false);
  assert.equal(assess(base, { now, serverTime: base.scan_at }).checks.find((c) => c.key === 'trade').pass, false); // IEX 40 s old
  assert.equal(freshness(at(-90_000), now, 'CONSOLIDATED'), 'live');
  assert.equal(freshness(at(-90_000), now, 'IEX'), 'stale');
});

test('a live halt blocks the plan and the priority tier', () => {
  const row = mergeMarketRow(base, { ...base, consolidated: overlay(), halt: { reason_code: 'LUDP' } }, { scan: true, now });
  const a = assess(row, { now, serverTime: row.scan_at });
  assert.equal(a.state, 'HALTED');
  assert.equal(a.plan, null);
  assert.equal(a.blockers[0], 'التداول موقوف مؤقتًا');
  assert.equal(splitPriority([row], { now, serverTime: row.scan_at }).upper.length, 0);
  // A later quote update without a halt field keeps the halt from the scan.
  assert.ok(mergeMarketRow(row, { price: 2.04, price_at: at(-1000) }, { now }).halt);
});

test('risk: recent offering and listing notice are HIGH, older filings WATCH, missing data UNKNOWN', () => {
  const entry = {
    listing: { status: 'NORMAL' },
    flags: [
      { kind: 'OFFERING', form: '424B4', date: '2026-09-20', recent: true },
      { kind: 'CHARTER_AMENDMENT', form: '8-K', date: '2026-06-01', recent: false },
    ],
    filings: [{ form: '424B4', date: '2026-09-20', url: 'https://www.sec.gov/x' }],
  };
  const r = riskOf(entry, {}, now, '2026-09-25T11:00:00Z');
  assert.equal(r.level, 'HIGH');
  assert.equal(r.items[0].url, 'https://www.sec.gov/x');
  assert.equal(r.items[1].level, 'WATCH');
  assert.equal(riskOf(undefined, {}, now).level, 'UNKNOWN');
  assert.equal(riskOf({ listing: { status: 'DEFICIENT' }, flags: [] }, {}, now).level, 'HIGH');
  assert.equal(riskOf({ listing: { status: 'NORMAL' }, flags: [] }, {}, now).level, 'NONE');
  assert.equal(riskOf({ listing: { status: 'NORMAL' } }, {}, now, '2026-09-23T00:00:00Z').stale, true);
});

test('company facts: SEC shares × price and FINRA short interest with its settlement date', () => {
  const facts = companyFacts({ shares_outstanding: { value: 10_000_000, as_of: '2026-07-31' }, short_interest: { shares_short: 500_000, days_to_cover: 1.5, settlement_date: '2026-09-15' } }, { price: 2, float_shares: 5_000_000 });
  assert.equal(facts.secMarketCap, 20_000_000);
  assert.equal(facts.shortOfFloat, 10);
  assert.equal(facts.shortSettlement, '2026-09-15');
  assert.equal(companyFacts(undefined, {}).secMarketCap, null);
});
