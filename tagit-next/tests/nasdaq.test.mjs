import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWatchlist, parseInfo, nasdaqMinute, nasdaqDateTime, WATCHLIST_URL, normalizeItem } from '../pipeline/nasdaq.mjs';

test('nasdaq: watchlist URL carries one symbol|stocks pair per symbol', () => {
  assert.equal(WATCHLIST_URL(['SENS', 'BRK.B']), 'https://api.nasdaq.com/api/quote/watchlist?symbol=sens%7Cstocks&symbol=brk.b%7Cstocks');
});

test('nasdaq: watchlist rows parse prices, signed changes and the implied previous close', () => {
  const body = { data: [
    { symbol: 'SENS', lastSalePrice: '$10.185', netChange: '-0.215', percentageChange: '-2.07%', lastTradeTimestamp: 'Sep 25, 2026 2:40 PM ET', volume: '344,650' },
    { symbol: 'BAD', lastSalePrice: 'N/A' },
    { symbol: 'UNC', lastSalePrice: '$1.00', netChange: 'UNCH', percentageChange: 'UNCH' },
  ] };
  const rows = parseWatchlist(body, Date.parse('2026-09-25T18:40:30Z'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].price, 10.185);
  assert.equal(rows[0].change, -0.215);
  assert.equal(rows[0].change_pct, -2.07);
  assert.equal(rows[0].previous_close, 10.4);
  assert.equal(rows[0].trade_minute_at, '2026-09-25T18:40:00.000Z');
  assert.equal(rows[0].volume, 344650);
  assert.equal(rows[1].change, 0);
  assert.equal(rows[1].previous_close, 1);
});

test('nasdaq: info parse rejects a mismatched symbol; a bare date is not a trade time', () => {
  const body = { data: { symbol: 'SENS', primaryData: { lastSalePrice: '$2.00', netChange: '+0.10', isRealTime: true, lastTradeTimestamp: 'Sep 25, 2026' } } };
  assert.equal(parseInfo('OTHER', body, 0), null);
  const q = parseInfo('SENS', body, 0);
  assert.equal(q.price, 2);
  assert.equal(q.real_time, true);
  assert.equal(q.trade_minute_at, null);
  assert.equal(nasdaqMinute('Jan 5, 2026 9:31 AM ET'), '2026-01-05T14:31:00.000Z');
  assert.equal(normalizeItem({ symbol: 'x y', lastSalePrice: '$1' }, 0), null);
});

test('nasdaq: the watchlist datetime field is New York wall time; midnight is a date only', () => {
  // Real weekend shape (2026-09-27): date-only stamps and an explicit previous close.
  const weekend = normalizeItem({ symbol: 'AACG', lastSalePrice: '$0.86', netChange: '+0.0344', lastTradeTimestamp: 'Sep 24, 2026', lastTradeTimestampDateTime: '2026-09-24T00:00:00', previousClosePrice: 0.8256 }, 0);
  assert.equal(weekend.trade_minute_at, null);
  assert.equal(weekend.previous_close, 0.8256);
  assert.equal(nasdaqDateTime('2026-09-25T14:40:00'), '2026-09-25T18:40:00.000Z');
  assert.equal(nasdaqDateTime('2026-01-05T09:31:00'), '2026-01-05T14:31:00.000Z');
  assert.equal(nasdaqDateTime('2026-09-25T12:05:00'), '2026-09-25T16:05:00.000Z');
  assert.equal(nasdaqDateTime('bad'), null);
});
