// Price provenance, freshness and reference-close correctness (agent-data).
import test from 'node:test';
import assert from 'node:assert/strict';
import { priceQuality } from '../src/core/quality.js';
import { previousClose, dayChange, fetchCloses, closesUrl } from '../src/core/closes.js';
import { mergeMarketRow } from '../src/core/market.js';
import { normalizeLive, createClient } from '../src/api.js';
import { createState, applyScan, applyLive, applyCloses, applySipDelayed, priceCoverage, liveSymbols } from '../src/state.js';
import { renderList } from '../src/views/list.js';
import { renderDossier } from '../src/views/dossier.js';

const now = Date.parse('2026-09-25T18:41:30Z'); // Friday 14:41:30 New York
const at = (d) => new Date(now + d).toISOString();

test('quality: IEX is live for 15 s, consolidated minutes for 2 min, delayed SIP is never current', () => {
  assert.equal(priceQuality({ price: 1, price_at: at(-5_000), price_source: 'IEX' }, now).level, 'live');
  assert.equal(priceQuality({ price: 1, price_at: at(-40_000), price_source: 'IEX' }, now).level, 'aging');
  const stale = priceQuality({ price: 1, price_at: at(-600_000), price_source: 'IEX' }, now);
  assert.equal(stale.level, 'stale');
  assert.equal(stale.current, false);
  assert.equal(priceQuality({ price: 1, price_at: at(-90_000), price_source: 'CONSOLIDATED' }, now).level, 'live');
  // Old last sale, but Nasdaq.com confirmed it 10 s ago: current price, flagged as quiet.
  const quiet = priceQuality({ price: 1, price_at: at(-900_000), price_source: 'CONSOLIDATED', verified_at: at(-10_000) }, now);
  assert.equal(quiet.level, 'quiet');
  assert.equal(quiet.current, true);
  const delayed = priceQuality({ price: 1, price_at: at(-17 * 60_000), price_source: 'SIP_DELAYED' }, now);
  assert.equal(delayed.level, 'delayed');
  assert.equal(delayed.current, false);
  assert.equal(priceQuality({ price: 1, price_at: at(5_000) }, now).level, 'none');
  assert.equal(priceQuality({ price: null, price_at: at(0) }, now).level, 'none');
});

const list = [{ day: '2026-09-23', close: 1.8 }, { day: '2026-09-24', close: 2 }, { day: '2026-09-25', close: 2.4 }];

test('closes: the reference is the session before the price\'s own session', () => {
  assert.deepEqual(previousClose(list, '2026-09-25'), { day: '2026-09-24', close: 2 });
  assert.deepEqual(previousClose(list, '2026-09-28'), { day: '2026-09-25', close: 2.4 });
  assert.equal(previousClose(list, '2026-09-23'), null);
  // A Friday price seen on Sunday is measured against Thursday.
  const friday = dayChange({ price: 2.5, price_at: '2026-09-25T19:59:00Z' }, list);
  assert.equal(friday.previous_close, 2);
  assert.equal(friday.change_session, '2026-09-25');
  assert.equal(friday.day_change, 25);
  assert.equal(friday.change_basis, 'SIP_SPLIT_ADJUSTED');
  assert.equal(dayChange({ price: 2.5, price_at: 'bad' }, list), null);
});

test('closes: fixed per-day URLs through the relay, split-adjusted SIP, today excluded', async () => {
  const url = closesUrl('https://svc', ['AAA'], '2026-09-27');
  assert.match(url, /feed=sip/);
  assert.match(url, /adjustment=split/);
  assert.match(url, /timeframe=1Day/);
  assert.match(url, /end=2026-09-27T00%3A00%3A00Z/);
  const seen = [];
  const getJson = async (u) => {
    seen.push(u);
    if (u.includes('page_token')) return { bars: { AAA: [{ t: '2026-09-25T04:00:00Z', c: 2.4 }] } };
    return { bars: { AAA: [{ t: '2026-09-24T04:00:00Z', c: 2 }], BBB: [{ t: '2026-09-24T04:00:00Z', c: 0 }] }, next_page_token: 'p2' };
  };
  const r = await fetchCloses({ getJson, service: 'https://svc', symbols: ['BBB', 'AAA'], now: Date.parse('2026-09-27T15:00:00Z') });
  assert.equal(seen.length, 2);
  assert.deepEqual(r.map.get('AAA').map((x) => x.close), [2, 2.4]);
  assert.deepEqual(r.map.get('BBB'), []);
  assert.equal(r.failed, 0);
  const failing = await fetchCloses({ getJson: async () => { throw new Error('429'); }, service: 's', symbols: ['AAA'], now });
  assert.equal(failing.failed, 1);
});

test('merge: delayed SIP wins only when it is the newest trade, and keeps its source', () => {
  const current = { symbol: 'AAA', price: 2, price_at: at(-3_600_000), scan_at: at(-1000) };
  const merged = mergeMarketRow(current, { symbol: 'AAA', sip_delayed: { price: 2.2, price_at: at(-17 * 60_000) } }, { now });
  assert.equal(merged.price, 2.2);
  assert.equal(merged.price_source, 'SIP_DELAYED');
  const fresh = mergeMarketRow(merged, { symbol: 'AAA', price: 2.3, price_at: at(-2_000) }, { now });
  assert.equal(fresh.price_source, 'IEX');
  assert.equal(fresh.sip_delayed.price, 2.2); // kept as context
  const overlay = mergeMarketRow(fresh, { symbol: 'AAA', consolidated: { price: 2.35, trade_minute_at: new Date(Math.floor(now / 60_000) * 60_000 + 60_000 - 60_000).toISOString(), fetched_at: at(-1_000) } }, { now });
  // Same minute as the exact IEX trade: IEX (exact) keeps precedence.
  assert.equal(overlay.price_source, 'IEX');
});

test('live board rows: only known sources, delayed prices become context, bad input dropped', () => {
  assert.equal(normalizeLive({ symbol: 'bad symbol' }), null);
  const row = normalizeLive({ symbol: 'AAA', price: 2, price_at: at(-60_000), price_source: 'CONSOLIDATED', verified_at: at(-2_000), sip_delayed: { price: 1.9, price_at: at(-1_000_000) },
    previous_close: 1.6, previous_close_session: '2026-09-24', change_session: '2026-09-25', change_basis: 'SIP_SPLIT_ADJUSTED' });
  assert.equal(row.price_source, 'CONSOLIDATED');
  assert.equal(row.sip_delayed.price, 1.9);
  assert.equal(row.server_close.previous_close, 1.6);
  const delayed = normalizeLive({ symbol: 'BBB', price: 2, price_at: at(-1_000_000), price_source: 'SIP_DELAYED' });
  assert.equal(delayed.price, undefined);
  assert.equal(normalizeLive({ symbol: 'CCC', price: 2, price_at: at(0), price_source: 'MADE_UP' }).price, undefined);
});

test('client: a service without /api/live reports NOT_SUPPORTED', async () => {
  const fetcher = async () => ({ ok: false, status: 404, json: async () => ({ status: 'NOT_FOUND' }) });
  await assert.rejects(createClient('https://svc', fetcher).live(['AAA']), (e) => e.code === 'NOT_SUPPORTED');
  const ok = async (url) => ({ ok: true, json: async () => ({ schema_version: 1, rows: [{ symbol: 'AAA', price: 2, price_at: at(-1000), price_source: 'IEX' }], url }) });
  const r = await createClient('https://svc', ok).live(['AAA']);
  assert.equal(r.rows[0].price, 2);
});

const scanRow = (symbol, o = {}) => ({ symbol, name: symbol, market_cap: 5e7, price: 2, price_at: at(-2_000), previous_close: 1.9, change_basis: 'SPLIT_ADJUSTED_PREVIOUS_CLOSE', extended: false, score: 1, ...o });
const scanPayload = (rows) => ({ schema_version: 1, status: 'OK', feed: 'iex', server_time: at(0), rows, alerts: [], gainers: rows.map((r) => r.symbol), coverage: { eligible_small_caps: rows.length } });

test('state: consolidated closes replace the IEX-based reference; live rows merge only known symbols', () => {
  const state = createState();
  applyScan(state, scanPayload([scanRow('AAA'), scanRow('OLD', { price_at: at(-3_600_000) })]), now);
  assert.equal(state.stocks.get('AAA').change_basis, 'SPLIT_ADJUSTED_PREVIOUS_CLOSE');
  applyCloses(state, { day: '2026-09-25', map: new Map([['AAA', [{ day: '2026-09-24', close: 1.6 }]]]), symbols: 1, failed: 0 });
  assert.equal(state.stocks.get('AAA').previous_close, 1.6);
  assert.equal(state.stocks.get('AAA').day_change, 25);
  applyLive(state, { rows: [normalizeLive({ symbol: 'AAA', price: 2.4, price_at: at(-30_000), price_source: 'CONSOLIDATED', verified_at: at(-1_000) }), normalizeLive({ symbol: 'ZZZ', price: 1, price_at: at(0), price_source: 'IEX' })] }, now);
  assert.equal(state.stocks.has('ZZZ'), false);
  // The IEX trade 2 s old is newer than the consolidated minute start 30 s ago.
  assert.equal(state.stocks.get('AAA').price_source, 'IEX');
  applyLive(state, { rows: [normalizeLive({ symbol: 'OLD', price: 3, price_at: at(-60_000), price_source: 'CONSOLIDATED', verified_at: at(-1_000),
    previous_close: 2.5, previous_close_session: '2026-09-24', change_session: '2026-09-25', change_basis: 'SIP_SPLIT_ADJUSTED' })] }, now);
  const old = state.stocks.get('OLD');
  assert.equal(old.price, 3);
  assert.equal(old.previous_close, 2.5); // server's consolidated close, the page has none for OLD
  assert.ok(Math.abs(old.day_change - 20) < 1e-9);
  assert.equal(state.live.supported, true);
  applySipDelayed(state, { OLD: { price: 2.9, price_at: at(-17 * 60_000) } }, now);
  assert.equal(state.stocks.get('OLD').price_source, 'CONSOLIDATED');
  assert.equal(state.stocks.get('OLD').sip_delayed.price, 2.9);
  const cov = priceCoverage(state, now);
  assert.equal(cov.total, 2);
  assert.equal(cov.live, 2);
  assert.ok(liveSymbols(state, now).includes('OLD'));
});

test('views: every price shows its source; stale and delayed prices are marked, not current', () => {
  const state = createState();
  applyScan(state, scanPayload([scanRow('AAA'), scanRow('OLD', { price_at: at(-3_600_000) })]), now);
  applySipDelayed(state, { OLD: { price: 2.1, price_at: at(-17 * 60_000) } }, now);
  const html = String(renderList(state, now).markup);
  const aaa = html.slice(html.indexOf('data-symbol="AAA"'), html.indexOf('</li>', html.indexOf('data-symbol="AAA"')));
  const old = html.slice(html.indexOf('data-symbol="OLD"'), html.indexOf('</li>', html.indexOf('data-symbol="OLD"')));
  assert.match(aaa, /px-src q-live">IEX</);
  assert.doesNotMatch(aaa, /is-stale/);
  assert.match(old, /is-stale/);
  assert.match(old, /متأخر/);
  assert.match(old, /dot delayed/);
  state.ui.selected = 'OLD';
  const dossier = String(renderDossier(state, now));
  assert.match(dossier, /متأخر — ليس سعرًا حاليًا/);
  assert.match(dossier, /مجمّع متأخر ≥ ١٦ د/);
});
