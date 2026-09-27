// Nasdaq.com unofficial quote endpoints: URL builders and tolerant parsers (pipeline side).
// The backend has its own copy in quote-service/src/consolidated.mjs; keep the two in step.
export const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://www.nasdaq.com',
  Referer: 'https://www.nasdaq.com/',
};
export const INFO_URL = (s) => `https://api.nasdaq.com/api/quote/${encodeURIComponent(s)}/info?assetclass=stocks`;
export const WATCHLIST_URL = (symbols) =>
  'https://api.nasdaq.com/api/quote/watchlist?' + symbols.map((s) => 'symbol=' + encodeURIComponent(s.toLowerCase() + '|stocks')).join('&');

const money = (s) => { const n = Number(String(s ?? '').replace(/[$,+\s]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const signed = (s) => { const t = String(s ?? '').replace(/[$,%\s]/g, ''); if (!t || t === 'N/A' || t === 'UNCH') return t === 'UNCH' ? 0 : null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const count = (s) => { const n = Number(String(s ?? '').replace(/,/g, '')); return Number.isFinite(n) && n >= 0 ? n : null; };
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** "Sep 25, 2026 2:40 PM ET" → ISO UTC start of that New York minute; null otherwise (a bare date is not a time). */
export function nasdaqMinute(text) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM) ET$/.exec(String(text ?? '').trim());
  if (!m || !(m[1] in MONTHS)) return null;
  const hour = (+m[4] % 12) + (m[6] === 'PM' ? 12 : 0), wall = Date.UTC(+m[3], MONTHS[m[1]], +m[2], hour, +m[5]);
  for (const offset of [4, 5]) {
    const guess = wall + offset * 3600000;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    if (+parts.find((p) => p.type === 'hour').value === hour && +parts.find((p) => p.type === 'minute').value === +m[5]) return new Date(guess).toISOString();
  }
  return null;
}

/** One watchlist item (or info primaryData) → normalized quote; null without a positive price. */
export function normalizeItem(item, fetchedAt) {
  const symbol = String(item?.symbol ?? '').toUpperCase();
  const price = money(item?.lastSalePrice ?? item?.lastsale ?? item?.lastSale);
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || !price) return null;
  const change = signed(item?.netChange ?? item?.netchange);
  const changePct = signed(item?.percentageChange ?? item?.pctchange);
  const stamp = item?.lastTradeTimestamp ?? item?.lastTradeTime ?? null;
  return {
    symbol,
    price,
    change,
    change_pct: changePct,
    // Nasdaq.com's own previous close implied by its net change (price − change).
    previous_close: change !== null && price - change > 0 ? Math.round((price - change) * 1e4) / 1e4 : null,
    volume: count(item?.volume ?? item?.shareVolume),
    trade_minute_at: nasdaqMinute(stamp),
    stamp_text: stamp,
    real_time: item?.isRealTime === true ? true : item?.isRealTime === false ? false : null,
    fetched_at: new Date(fetchedAt).toISOString(),
  };
}

export function parseWatchlist(body, fetchedAt) {
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.data?.rows) ? body.data.rows : [];
  return rows.map((r) => normalizeItem(r, fetchedAt)).filter(Boolean);
}

export function parseInfo(symbol, body, fetchedAt) {
  const d = body?.data, p = d?.primaryData;
  if (!p || String(d.symbol ?? '').toUpperCase() !== symbol) return null;
  return normalizeItem({ ...p, symbol, isRealTime: p.isRealTime }, fetchedAt);
}
