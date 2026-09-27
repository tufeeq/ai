// Consolidated (SIP), split-adjusted daily closes through the service's read-only relay.
// The day change of a price is measured against the close of the session before the price's
// own session, so a Friday price viewed on Sunday is compared with Thursday's close, and a
// single-exchange (IEX) close never becomes the reference. Windows are fixed per New York date
// so every viewer requests identical URLs and shares the relay cache.
import { marketDate } from './market.js';
import { batches } from './sipscan.js';
import { positive } from './util.js';

const DAY_MS = 86_400_000;

export function closesUrl(service, symbols, today) {
  const end = Date.parse(`${today}T00:00:00Z`);
  const q = new URLSearchParams({
    resource: 'bars', symbols: symbols.join(','), timeframe: '1Day',
    start: new Date(end - 14 * DAY_MS).toISOString().replace('.000Z', 'Z'),
    end: new Date(end).toISOString().replace('.000Z', 'Z'),
    feed: 'sip', adjustment: 'split', limit: '10000',
  });
  return `${service}/api/lab/provider?${q}`;
}

/** Fetch closes for every symbol: Map(symbol → [{day, close}] ascending). */
export async function fetchCloses({ getJson, service, symbols, now, concurrency = 2 }) {
  const today = marketDate(now);
  const groups = batches(symbols);
  const map = new Map();
  let failed = 0, next = 0;
  async function worker() {
    while (next < groups.length) {
      const group = groups[next++];
      try {
        let token = null, url = closesUrl(service, group, today);
        for (let page = 0; page < 5; page++) {
          const body = await getJson(token ? `${url}&page_token=${encodeURIComponent(token)}` : url);
          for (const [s, bars] of Object.entries(body?.bars ?? {})) {
            const list = map.get(s) ?? [];
            for (const b of bars) if (positive(b?.c) && marketDate(b.t)) list.push({ day: marketDate(b.t), close: b.c });
            map.set(s, list);
          }
          token = body?.next_page_token;
          if (!token) break;
        }
      } catch {
        failed += group.length;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, worker));
  for (const list of map.values()) list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return { day: today, fetched_at: new Date(now).toISOString(), map, symbols: groups.flat().length, failed };
}

/** Close of the last session strictly before `day` (YYYY-MM-DD), with that session's date. */
export function previousClose(list, day) {
  if (!Array.isArray(list) || !day) return null;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].day < day) return list[i];
  return null;
}

/**
 * Day change of a row's price against the consolidated previous close of the price's own session.
 * Returns { previous_close, change_session, day_change, change_basis } or null when unknown.
 */
export function dayChange(row, list) {
  const day = marketDate(row?.price_at);
  const prev = positive(row?.price) ? previousClose(list, day) : null;
  if (!prev) return null;
  return {
    previous_close: prev.close,
    previous_close_session: prev.day,
    change_session: day,
    day_change: (row.price / prev.close - 1) * 100,
    change_basis: 'SIP_SPLIT_ADJUSTED',
  };
}
