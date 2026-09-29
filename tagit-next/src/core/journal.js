// Device-local observation journal. Outcomes are sampled price observations
// after detection, not executed-trade P&L.
//
// Every record has a fixed observation window (review-outcomes J1, 2026-09-29): it ends 30 minutes
// after the start, or earlier at the end of the market session the record started in (pre-market
// 04:00–09:30, regular 09:30–close with 13:00 early closes, after-hours close–20:00, New York).
// Samples after the window are ignored, so an outcome never mixes horizons or crosses into the
// next session or day. The outcome is also reported after the same minimum 0.5 pp round-trip
// cost as the studies, and the start price keeps its source.
import { positive, elapsed, within, isSymbol } from './util.js';
import { regularSession } from './sipscan.js';
import { COSTS } from './costs.js';

export const JOURNAL_LIMIT = 250;
export const POINT_LIMIT = 360;
export const OUTCOME_HORIZON_MS = 30 * 60_000;
export const ROUND_TRIP_COST_PCT = COSTS.minRoundTripPct;
const FRESH_START_MS = 15_000;

/**
 * End (epoch ms) of the market session containing `ms`, or null outside every session (overnight,
 * weekends). Exchange holidays are not known here, like marketSession().
 */
export function sessionEnd(ms) {
  const { open, close } = regularSession(ms);
  const day = new Date(ms).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  if (day === 'Sat' || day === 'Sun') return null;
  const preOpen = open - 330 * 60_000; // 04:00
  const afterEnd = open + 630 * 60_000; // 20:00
  if (ms >= preOpen && ms < open) return open;
  if (ms >= open && ms < close) return close;
  if (ms >= close && ms < afterEnd) return afterEnd;
  return null;
}

/** Last moment a sample may count for a record that started at `startedAt`. */
export function windowEnd(startedAt) {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  const end = sessionEnd(start);
  return end === null ? start : Math.min(start + OUTCOME_HORIZON_MS, end);
}

const sourceOf = (priceSource, feed) => priceSource ?? (feed ? `SCANNER_${String(feed).toUpperCase()}` : 'UNKNOWN');

/** Start a manual watch record from a fresh trade; null when the price is not fresh. */
export function createWatchEvent(row, { now, feed, plan = null }) {
  if (!positive(row?.price) || !within(row.price_at, now, FRESH_START_MS)) return null;
  const at = new Date(now).toISOString();
  return baseEvent({
    id: `WATCH:${row.symbol}:${at}`, kind: 'WATCH', symbol: row.symbol, name: row.name,
    started_at: at, observed_from: at, price: row.price, price_at: row.price_at, feed, plan,
    source: sourceOf(row.price_source, feed),
  });
}

/**
 * Record a server alert. The server detection time is preserved; the alert
 * price must be at most 15s older than detection and detection not in the future.
 */
export function createSignalEvent(alert, { now, feed, name }) {
  const detected = Date.parse(alert?.detected_at);
  if (!isSymbol(alert?.symbol) || !Number.isFinite(detected) || detected > now || !positive(alert.price)) return null;
  if (!within(alert.price_at, detected, FRESH_START_MS)) return null;
  return baseEvent({
    id: `SIGNAL:${alert.symbol}:${alert.detected_at}`, kind: 'SIGNAL', symbol: alert.symbol, name,
    started_at: alert.detected_at, observed_from: new Date(now).toISOString(),
    // The alert's own price, as the scanner priced it (its feed, e.g. IEX): not an executable fill.
    price: alert.price, price_at: alert.price_at, feed, plan: alert.plan ?? null,
    source: sourceOf(alert.price_source, feed),
  });
}

function baseEvent({ id, kind, symbol, name, started_at, observed_from, price, price_at, feed, plan, source }) {
  const end = windowEnd(started_at);
  return {
    id, kind, symbol, name: name ?? symbol, started_at, observed_from,
    start_price: price, start_price_source: source, source_price_at: price_at, feed: feed ?? null, plan,
    window_end: new Date(end).toISOString(),
    points: [], min: price, max: price, last_price: price, last_at: price_at,
  };
}

const endOf = (event) => {
  const t = Date.parse(event.window_end);
  return Number.isFinite(t) ? t : windowEnd(event.started_at);
};

/**
 * Add a price sample. Samples earlier than detection, after the observation window,
 * duplicates and regressing timestamps are ignored so outcomes stay chronological.
 */
export function recordObservation(event, row) {
  const at = Date.parse(row?.price_at);
  if (!positive(row?.price) || !Number.isFinite(at)) return event;
  if (elapsed(row.price_at, Date.parse(event.started_at)) > 0) return event;
  const end = endOf(event);
  if (end !== null && at > end) return event;
  const points = Array.isArray(event.points) ? event.points : [];
  if (points.length && at <= Date.parse(points.at(-1).at)) return event;
  const point = { at: row.price_at, price: row.price, ...(row.price_source ? { source: row.price_source } : {}) };
  return {
    ...event,
    min: Math.min(event.min ?? event.start_price, row.price),
    max: Math.max(event.max ?? event.start_price, row.price),
    last_price: row.price,
    last_at: row.price_at,
    points: [...points, point].slice(-POINT_LIMIT),
  };
}

/**
 * Observed outcome inside the window. `change`, `maximum` and `drawdown` are price moves from the
 * start; `net` is `change` after the minimum round-trip cost. `complete` is true once `now` (when
 * given) is past the window end.
 */
export function outcome(event, now = null) {
  const end = endOf(event);
  const window = { window_end: end === null ? null : new Date(end).toISOString(), complete: now !== null && end !== null ? now >= end : null };
  if (!positive(event.start_price)) return { change: null, net: null, maximum: null, drawdown: null, retention: null, ...window };
  const rel = (p) => (positive(p) ? (p / event.start_price - 1) * 100 : null);
  const change = rel(event.last_price);
  const maximum = rel(event.max);
  const drawdown = rel(event.min);
  const retention = maximum > 0 && change !== null ? (change / maximum) * 100 : null;
  const net = change === null ? null : change - ROUND_TRIP_COST_PCT;
  return { change, net, maximum, drawdown, retention, ...window };
}

/**
 * Restore a persisted journal, dropping malformed records instead of inventing prices. Records
 * saved before observation windows existed are cut back to their window: samples after it are
 * dropped and the extremes and last price recomputed from what remains.
 */
export function restoreJournal(value) {
  if (!value || value.schema !== 1 || !Array.isArray(value.events)) return [];
  return value.events
    .filter((e) => typeof e?.id === 'string' && isSymbol(e.symbol) && positive(e.start_price) && Number.isFinite(Date.parse(e.started_at)))
    .slice(-JOURNAL_LIMIT)
    .map((e) => {
      const end = Number.isFinite(Date.parse(e.window_end)) ? Date.parse(e.window_end) : windowEnd(e.started_at);
      const valid = Array.isArray(e.points) ? e.points.filter((p) => positive(p?.price) && Number.isFinite(Date.parse(p.at))) : [];
      const points = valid.filter((p) => Date.parse(p.at) <= end).slice(-POINT_LIMIT);
      const base = {
        ...e,
        start_price_source: e.start_price_source ?? sourceOf(null, e.feed),
        window_end: new Date(end).toISOString(),
        min: positive(e.min) ? e.min : e.start_price,
        max: positive(e.max) ? e.max : e.start_price,
        points,
      };
      if (points.length === valid.length) return base;
      const prices = [e.start_price, ...points.map((p) => p.price)];
      return {
        ...base, min: Math.min(...prices), max: Math.max(...prices),
        last_price: points.at(-1)?.price ?? e.start_price, last_at: points.at(-1)?.at ?? e.source_price_at ?? e.started_at,
      };
    });
}
