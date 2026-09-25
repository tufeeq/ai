// Device-local observation journal. Outcomes are sampled price observations
// after detection, not executed-trade P&L.
import { positive, elapsed, within, isSymbol } from './util.js';

export const JOURNAL_LIMIT = 250;
export const POINT_LIMIT = 360;
const FRESH_START_MS = 15_000;

/** Start a manual watch record from a fresh trade; null when the price is not fresh. */
export function createWatchEvent(row, { now, feed, plan = null }) {
  if (!positive(row?.price) || !within(row.price_at, now, FRESH_START_MS)) return null;
  const at = new Date(now).toISOString();
  return baseEvent({
    id: `WATCH:${row.symbol}:${at}`, kind: 'WATCH', symbol: row.symbol, name: row.name,
    started_at: at, observed_from: at, price: row.price, price_at: row.price_at, feed, plan,
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
    price: alert.price, price_at: alert.price_at, feed, plan: alert.plan ?? null,
  });
}

function baseEvent({ id, kind, symbol, name, started_at, observed_from, price, price_at, feed, plan }) {
  return {
    id, kind, symbol, name: name ?? symbol, started_at, observed_from,
    start_price: price, source_price_at: price_at, feed: feed ?? null, plan,
    points: [], min: price, max: price, last_price: price, last_at: price_at,
  };
}

/**
 * Add a price sample. Samples earlier than detection, duplicates and
 * regressing timestamps are ignored so outcomes stay chronological.
 */
export function recordObservation(event, row) {
  const at = Date.parse(row?.price_at);
  if (!positive(row?.price) || !Number.isFinite(at)) return event;
  if (elapsed(row.price_at, Date.parse(event.started_at)) > 0) return event;
  const points = Array.isArray(event.points) ? event.points : [];
  if (points.length && at <= Date.parse(points.at(-1).at)) return event;
  return {
    ...event,
    min: Math.min(event.min ?? event.start_price, row.price),
    max: Math.max(event.max ?? event.start_price, row.price),
    last_price: row.price,
    last_at: row.price_at,
    points: [...points, { at: row.price_at, price: row.price }].slice(-POINT_LIMIT),
  };
}

export function outcome(event) {
  if (!positive(event.start_price)) return { change: null, maximum: null, drawdown: null, retention: null };
  const rel = (p) => (positive(p) ? (p / event.start_price - 1) * 100 : null);
  const change = rel(event.last_price);
  const maximum = rel(event.max);
  const drawdown = rel(event.min);
  const retention = maximum > 0 && change !== null ? (change / maximum) * 100 : null;
  return { change, maximum, drawdown, retention };
}

/** Restore a persisted journal, dropping malformed records instead of inventing prices. */
export function restoreJournal(value) {
  if (!value || value.schema !== 1 || !Array.isArray(value.events)) return [];
  return value.events
    .filter((e) => typeof e?.id === 'string' && isSymbol(e.symbol) && positive(e.start_price) && Number.isFinite(Date.parse(e.started_at)))
    .slice(-JOURNAL_LIMIT)
    .map((e) => ({
      ...e,
      min: positive(e.min) ? e.min : e.start_price,
      max: positive(e.max) ? e.max : e.start_price,
      points: Array.isArray(e.points)
        ? e.points.filter((p) => positive(p?.price) && Number.isFinite(Date.parse(p.at))).slice(-POINT_LIMIT)
        : [],
    }));
}
