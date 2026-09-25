// Market clock and row merging. Trade and quote clocks advance independently,
// so a slow scanner response can never roll back a newer quote or trade.
import { positive } from './util.js';

const nyDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
const nyClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const toTime = (at) => (typeof at === 'number' ? at : Date.parse(at));

/** New York calendar date (YYYY-MM-DD) for an ISO string or epoch ms; null when invalid. */
export function marketDate(at) {
  const t = toTime(at);
  return Number.isFinite(t) ? nyDate.format(new Date(t)) : null;
}

export const SESSIONS = {
  PRE: 'قبل الافتتاح',
  REGULAR: 'الجلسة النظامية',
  AFTER: 'بعد الإغلاق',
  CLOSED: 'السوق مغلق',
};

/**
 * Session by New York wall clock. Exchange holidays are not known here,
 * so a holiday weekday still reads as a trading session.
 */
export function marketSession(now) {
  const parts = Object.fromEntries(nyClock.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  let key = 'CLOSED';
  if (!['Sat', 'Sun'].includes(parts.weekday)) {
    if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) key = 'PRE';
    else if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) key = 'REGULAR';
    else if (minutes >= 16 * 60 && minutes < 20 * 60) key = 'AFTER';
  }
  return { key, label: SESSIONS[key] };
}

const stamp = (at) => {
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : -Infinity;
};
const validTrade = (r, now) => positive(r?.price) && stamp(r.price_at) > -Infinity && stamp(r.price_at) <= now;
const validQuote = (r, now) =>
  positive(r?.bid) && positive(r?.ask) && r.bid <= r.ask && stamp(r.quote_at) > -Infinity && stamp(r.quote_at) <= now;

/** The valid candidate with the latest timestamp; earlier candidates win ties. */
function newest(candidates, isValid, timeKey, now) {
  let best = null;
  for (const c of candidates) {
    if (isValid(c, now) && (!best || stamp(c[timeKey]) > stamp(best[timeKey]))) best = c;
  }
  return best;
}

/** The more recently fetched consolidated overlay of the two rows. */
function latestOverlay(current, incoming) {
  const a = current?.consolidated, b = incoming?.consolidated;
  if (!a) return b ?? null;
  if (!b) return a;
  return stamp(b.fetched_at) >= stamp(a.fetched_at) ? b : a;
}

/**
 * Nasdaq.com consolidated overlay as trade and quote candidates. The trade time is the start of
 * its minute (the source only reports minutes), so it wins only when a later minute traded.
 */
function overlayCandidates(overlay) {
  if (!overlay || overlay.real_time === false) return [null, null];
  return [
    { price: overlay.price, price_at: overlay.trade_minute_at, price_source: 'CONSOLIDATED' },
    { bid: overlay.bid, ask: overlay.ask, quote_at: overlay.fetched_at, quote_source: 'CONSOLIDATED' },
  ];
}

/**
 * Merge a scanner row (`scan: true`, carries metadata and signals) or a quote
 * update into the current row. Future or malformed prices are rejected, and
 * the day change is only computed when the trade belongs to the scanned session.
 */
export function mergeMarketRow(current, incoming, { scan = false, now = Date.now() } = {}) {
  const result = scan ? { ...incoming } : { ...current };
  const overlay = latestOverlay(current, incoming);
  const [overlayTrade, overlayQuote] = overlayCandidates(overlay);
  // IEX rows carry no source field; the incoming row is listed first so it wins exact ties.
  const trade = newest([incoming, current, overlayTrade], validTrade, 'price_at', now);
  const quote = newest([incoming, current, overlayQuote], validQuote, 'quote_at', now);

  result.consolidated = overlay;
  if (incoming && 'halt' in incoming) {
    result.halt = incoming.halt;
    result.halt_status = incoming.halt_status;
  }
  result.price = trade?.price ?? null;
  result.price_at = trade?.price_at ?? null;
  result.price_source = trade ? trade.price_source ?? 'IEX' : null;
  result.quote_source = quote ? quote.quote_source ?? 'IEX' : null;
  result.quote_at = quote?.quote_at ?? null;
  result.bid = quote?.bid ?? null;
  result.ask = quote?.ask ?? null;
  result.spread_pct = quote ? ((quote.ask - quote.bid) / ((quote.ask + quote.bid) / 2)) * 100 : null;

  const session = marketDate(scan ? incoming.scan_at : current?.scan_at);
  const sameSession = session && session === marketDate(result.price_at);
  result.day_change = sameSession && positive(result.previous_close)
    ? (result.price / result.previous_close - 1) * 100
    : null;
  // The scan's technical `extended` flag is kept; day extension follows the live price.
  return result;
}
