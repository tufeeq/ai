import test from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, safeUrl } from '../src/html.js';
import * as f from '../src/format.js';
import { validateScanner, normalizeQuote, createClient } from '../src/api.js';
import { marketSession } from '../src/core/market.js';
import {
  createState, applyScan, applyQuotes, visibleRows, toggleWatch, nextQuoteSymbols, metrics, selectedRow, removeEvent, groupRows,
} from '../src/state.js';
import { renderList } from '../src/views/list.js';
import { renderDossier } from '../src/views/dossier.js';
import { renderJournal } from '../src/views/journal.js';

const now = Date.parse('2026-09-16T15:00:00Z');
const at = (d = 0) => new Date(now + d).toISOString();

function row(symbol, o = {}) {
  return {
    symbol, name: `${symbol} Inc`, market_cap: 5e7, price: 2.02, price_at: at(-1000), quote_at: at(-1000), bid: 2.019, ask: 2.02,
    previous_close: 1.9, extended: false, actionable: true, score: 50, day_volume: 1e6,
    plan: { entry: 2.02, stop: 1.98, targets: [2.06, 2.1] },
    signal: {
      ready: true, expansion: true, bar_at: at(-70000), bars: 20, return_3m: 1, volume_ratio: 3, dollars_3m: 50000, trades_3m: 100,
      volume_concentration: 0.5, vwap_window: 2, plan_valid: true, trigger: 2.02, stop: 1.98,
    },
    ...o,
  };
}
const payload = (rows, extra = {}) => ({
  schema_version: 1, status: 'OK', feed: 'iex', server_time: at(), rows, alerts: [], gainers: rows.map((r) => r.symbol),
  coverage: { eligible_small_caps: rows.length, with_prices: rows.length, fresh_prices: rows.length }, ...extra,
});

test('html escapes interpolations but keeps nested templates and raw markup', () => {
  const name = '<img src=x onerror=alert(1)>';
  const out = String(html`<p title="${name}">${name}${html`<b>${'&'}</b>`}${raw('<i>ok</i>')}${null}${false}</p>`);
  assert.equal(out, '<p title="&lt;img src=x onerror=alert(1)&gt;">&lt;img src=x onerror=alert(1)&gt;<b>&amp;</b><i>ok</i></p>');
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
});

test('formatting keeps four decimals under $1 and signs percentages', () => {
  assert.equal(f.price(0.43125), '0.4313');
  assert.equal(f.price(12.4), '12.40');
  assert.equal(f.pct(3.014), '+3.01%');
  assert.equal(f.pct(-1.5), '-1.50%');
  assert.equal(f.pct(null), '—');
  assert.equal(f.age(at(-4000), now), '4 ث');
  assert.equal(f.age(at(5000), now), 'وقت غير صالح');
  assert.equal(f.freshness(at(-30000), now), 'aging');
});

test('market session follows the New York clock, including weekends', () => {
  assert.equal(marketSession(Date.parse('2026-09-16T13:00:00Z')).key, 'PRE'); // 09:00 EDT
  assert.equal(marketSession(Date.parse('2026-09-16T15:00:00Z')).key, 'REGULAR');
  assert.equal(marketSession(Date.parse('2026-09-16T21:00:00Z')).key, 'AFTER');
  assert.equal(marketSession(Date.parse('2026-09-17T01:30:00Z')).key, 'CLOSED');
  assert.equal(marketSession(Date.parse('2026-09-19T15:00:00Z')).key, 'CLOSED'); // Saturday
});

test('scanner validation rejects malformed payloads and drops bad symbols', () => {
  assert.equal(validateScanner({ schema_version: 2 }), null);
  assert.equal(validateScanner({ schema_version: 1, rows: [], coverage: {}, server_time: 'nope' }), null);
  const v = validateScanner(payload([row('GOOD'), row('bad symbol')]));
  assert.deepEqual(v.rows.map((r) => r.symbol), ['GOOD']);
});

test('quote rows map onto market fields; ineligible symbols are not an error', async () => {
  assert.deepEqual(normalizeQuote({ symbol: 'ABC', trade: { price: 1, timestamp: at() }, quote: { bid: 0.9, ask: 1, timestamp: at() } }), {
    symbol: 'ABC', name: undefined, market_cap: undefined, metadata_at: undefined, price: 1, price_at: at(), bid: 0.9, ask: 1, quote_at: at(),
  });
  const fetcher = async () => ({ ok: false, json: async () => ({ status: 'INELIGIBLE_SYMBOLS', rejected: ['ZZZ'] }) });
  assert.deepEqual(await createClient('https://x.test', fetcher).quotes(['ZZZ']), { rows: [], rejected: ['ZZZ'] });
  const failing = async () => ({ ok: false, json: async () => ({ status: 'RATE_LIMITED' }) });
  await assert.rejects(createClient('https://x.test', failing).scanner(), (e) => e.code === 'RATE_LIMITED');
});

test('scan populates rows, records alerts once and computes live metrics', () => {
  const state = createState();
  const alert = { symbol: 'AAA', detected_at: at(-500), price: 2.02, price_at: at(-1000) };
  assert.equal(applyScan(state, payload([row('AAA'), row('BBB', { extended: true, actionable: false })], { alerts: [alert] }), now), true);
  assert.equal(applyScan(state, payload([row('AAA'), row('BBB', { extended: true, actionable: false })], { alerts: [alert] }), now), false);
  assert.equal(state.journal.length, 1);
  assert.equal(state.journal[0].kind, 'SIGNAL');
  assert.equal(state.dirty, true);
  const m = metrics(state, now);
  assert.equal(m.plans, 1);
  assert.deepEqual(visibleRows(state, now).map((r) => r.symbol), ['AAA']); // BBB is extended
  state.ui.view = 'gainers';
  assert.equal(visibleRows(state, now).length, 2);
});

test('filters: search, price ceiling and state', () => {
  const state = createState();
  applyScan(state, payload([row('AAA'), row('CHEAP', { price: 0.5, plan: null, actionable: false }), row('ZED', { price: 9 })]), now);
  state.ui.view = 'gainers';
  state.ui.search = 'che';
  assert.deepEqual(visibleRows(state, now).map((r) => r.symbol), ['CHEAP']);
  state.ui.search = '';
  state.ui.maxPrice = 5;
  assert.ok(!visibleRows(state, now).some((r) => r.symbol === 'ZED'));
  state.ui.maxPrice = Infinity;
  state.ui.filter = 'READY';
  assert.deepEqual(visibleRows(state, now).map((r) => r.symbol).sort(), ['AAA']);
});

test('watch list keeps symbols without data or outside the scanner universe', () => {
  const state = createState();
  applyScan(state, payload([row('AAA')]), now);
  assert.equal(toggleWatch(state, 'AAA', now), 'recording');
  assert.equal(toggleWatch(state, 'NEWX', now), 'added');
  state.ui.view = 'watch';
  const rows = visibleRows(state, now);
  assert.deepEqual(rows.map((r) => r.symbol).sort(), ['AAA', 'NEWX']);
  assert.ok(rows.find((r) => r.symbol === 'NEWX').placeholder);
  // A quote for a $400M company still shows in the watch list.
  applyQuotes(state, { rows: [{ symbol: 'NEWX', market_cap: 4e8, price: 3, price_at: at(-200), bid: 2.99, ask: 3, quote_at: at(-200) }] }, now);
  assert.equal(visibleRows(state, now).find((r) => r.symbol === 'NEWX').price, 3);
  assert.equal(state.journal.filter((e) => e.kind === 'WATCH').length, 2);
  assert.equal(toggleWatch(state, 'AAA', now), 'removed');
});

test('quote rotation puts the selection first and never exceeds 20 symbols', () => {
  const state = createState();
  applyScan(state, payload(Array.from({ length: 30 }, (_, i) => row(`S${String.fromCharCode(65 + i % 26)}${i}`))), now);
  state.ui.selected = 'SB1';
  const first = nextQuoteSymbols(state, now);
  assert.equal(first[0], 'SB1');
  assert.ok(first.length <= 20);
  const second = nextQuoteSymbols(state, now);
  assert.notDeepEqual(first.slice(1), second.slice(1));
});

test('dossier falls back to a placeholder for a symbol with no data', () => {
  const state = createState();
  state.ui.selected = 'NODATA';
  assert.equal(selectedRow(state).symbol, 'NODATA');
  const out = String(renderDossier(state, now));
  assert.match(out, /NODATA/);
  assert.match(out, /data-watch="NODATA"/);
});

test('views render every tab without throwing and escape server text', () => {
  const state = createState();
  applyScan(state, payload([row('AAA', { name: '<script>x</script>', news: [{ headline: '<b>h</b>', url: 'javascript:1', source: 's', category: 'DEAL' }] })]), now);
  state.ui.selected = 'AAA';
  for (const tab of ['overview', 'plan', 'news', 'history']) {
    state.ui.tab = tab;
    const out = String(renderDossier(state, now));
    assert.ok(!out.includes('<script>x'), tab);
    assert.ok(!out.includes('<b>h</b>'), tab);
    assert.ok(!out.includes('href="javascript'), tab);
  }
  const list = renderList(state, now);
  assert.equal(list.count, 1);
  assert.match(String(list.markup), /tier-upper/);
  assert.equal(groupRows(state, visibleRows(state, now), now).upper.length, 1);
});

test('plan tab sizes from saved limits and explains a zero-share result', () => {
  const state = createState({ settings: { capital: '1000', risk: '4' } });
  applyScan(state, payload([row('AAA')]), now);
  state.ui.selected = 'AAA';
  state.ui.tab = 'plan';
  assert.match(String(renderDossier(state, now)), /<strong dir="ltr">100<\/strong>/);
  state.settings = { capital: '1000', risk: '0.01' };
  assert.match(String(renderDossier(state, now)), /لا يكفي لسهم واحد/);
});

test('journal view lists records and a record can be removed', () => {
  const state = createState();
  applyScan(state, payload([row('AAA')], { alerts: [{ symbol: 'AAA', detected_at: at(-500), price: 2.02, price_at: at(-1000) }] }), now);
  assert.equal(renderJournal(state).count, 1);
  assert.equal(removeEvent(state, state.journal[0].id), true);
  assert.equal(renderJournal(state).count, 0);
});
