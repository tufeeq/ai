// Application state and the operations that change it. No DOM access here,
// so every transition is testable in Node with an injected clock.
import { positive, isSymbol } from './core/util.js';
import { marketDate, mergeMarketRow } from './core/market.js';
import { assess, isExtended, splitPriority } from './core/checks.js';
import { createWatchEvent, createSignalEvent, recordObservation, JOURNAL_LIMIT } from './core/journal.js';
import { updatePressure, pressureSummary } from './core/pressure.js';
import { WATCH_LIMIT } from './storage.js';

export const UNIVERSE_CAP = 100_000_000;
export const LIST_LIMIT = 80;
export const QUOTE_BATCH = 20;

export function createState({ journal = [], watched = new Set(), settings = { capital: '', risk: '' } } = {}) {
  return {
    endpoint: '',
    connection: { phase: 'boot', error: null, lastScanAt: null, attempts: 0 },
    quoteError: false,
    scan: null, // { server_time, feed, status, coverage, order, gainers, complements }
    enrichment: null, // data/enrichment.json: SEC, Nasdaq listing status, FINRA short interest
    evidence: { relabel: null, forward: null }, // data/outcome-relabel.json, data/forward-outcomes.json
    stocks: new Map(),
    pressure: new Map(),
    journal,
    watched,
    settings,
    storageOk: true,
    dirty: false, // journal changed since the last save
    ui: { view: 'early', selected: null, tab: 'overview', search: '', maxPrice: Infinity, filter: 'all', sheet: false },
    quoteCursor: 0,
    cache: { tick: -1, map: new Map() },
  };
}

// ---- assessment (cached per row per second) --------------------------------

export function assessRow(state, row, now) {
  const tick = Math.floor(now / 1000);
  if (state.cache.tick !== tick) {
    state.cache.map.clear();
    state.cache.tick = tick;
  }
  let a = state.cache.map.get(row);
  if (!a) {
    a = assess(row, {
      now,
      serverTime: row.scan_at ?? state.scan?.server_time,
      connected: state.connection.phase === 'live' || state.connection.phase === 'partial',
      feed: state.scan?.feed,
    });
    state.cache.map.set(row, a);
  }
  return a;
}
const invalidate = (state) => state.cache.map.clear();

export const flowOf = (state, symbol, now) => pressureSummary(state.pressure.get(symbol), now);

// ---- transitions --------------------------------------------------------------

/** Apply a validated scanner payload. Returns true when new journal records were created. */
export function applyScan(state, payload, now) {
  state.scan = {
    server_time: payload.server_time,
    feed: payload.feed,
    status: payload.status,
    coverage: payload.coverage,
    order: payload.rows.map((r) => r.symbol),
    gainers: payload.gainers,
    complements: payload.complements ?? null,
  };
  state.connection = { phase: payload.status === 'PARTIAL' ? 'partial' : 'live', error: null, lastScanAt: payload.server_time, attempts: 0 };
  for (const incoming of payload.rows) {
    const scanned = { ...incoming, scan_at: payload.server_time };
    state.pressure.set(scanned.symbol, updatePressure(state.pressure.get(scanned.symbol), scanned, payload.server_time));
    state.stocks.set(scanned.symbol, mergeMarketRow(state.stocks.get(scanned.symbol), scanned, { scan: true, now }));
  }
  let added = false;
  for (const alert of payload.alerts) {
    const live = state.stocks.get(alert?.symbol);
    if (!live) continue;
    const event = createSignalEvent(alert, { now, feed: payload.feed, name: live.name });
    if (event && !state.journal.some((e) => e.id === event.id)) {
      state.journal.push(event);
      added = true;
      state.dirty = true;
    }
  }
  state.journal = state.journal.slice(-JOURNAL_LIMIT);
  invalidate(state);
  observe(state);
  return added;
}

export function scanFailed(state, code) {
  state.connection = { ...state.connection, phase: 'error', error: code, attempts: state.connection.attempts + 1 };
  invalidate(state);
}

/** Merge quote rows; creates rows for watched symbols the scanner has not listed. */
export function applyQuotes(state, result, now) {
  for (const q of result.rows) {
    let row = state.stocks.get(q.symbol);
    if (!row) {
      row = { symbol: q.symbol, name: q.name ?? q.symbol, signal: null, extended: false };
      state.stocks.set(q.symbol, row);
    }
    const merged = mergeMarketRow(row, q, { now });
    if (positive(q.market_cap)) {
      merged.market_cap = q.market_cap;
      merged.metadata_at = q.metadata_at;
    }
    state.stocks.set(q.symbol, merged);
  }
  state.quoteError = false;
  invalidate(state);
  observe(state);
  return startWatchEvents(state, now);
}

/** Symbols for the next quote request: the selected one first, then a rotation. */
export function nextQuoteSymbols(state, now) {
  const rotation = [...new Set([...state.watched, ...visibleRows(state, now).map((r) => r.symbol)])];
  if (state.quoteCursor >= rotation.length) state.quoteCursor = 0;
  const slice = rotation.slice(state.quoteCursor, state.quoteCursor + QUOTE_BATCH - 1);
  state.quoteCursor = rotation.length ? (state.quoteCursor + QUOTE_BATCH - 1) % rotation.length : 0;
  return [...new Set([state.ui.selected, ...slice].filter(isSymbol))].slice(0, QUOTE_BATCH);
}

/** Add new samples to every journal record. Returns true if any record changed. */
export function observe(state) {
  let changed = false;
  state.journal = state.journal.map((e) => {
    const next = recordObservation(e, state.stocks.get(e.symbol));
    if (next !== e) changed = true;
    return next;
  });
  if (changed) state.dirty = true;
  return changed;
}

/** One manual record per watched symbol per New York day, once a fresh trade exists. */
export function startWatchEvents(state, now) {
  const today = marketDate(now);
  let added = false;
  for (const symbol of state.watched) {
    const row = state.stocks.get(symbol);
    const hasToday = state.journal.some((e) => e.symbol === symbol && e.kind === 'WATCH' && marketDate(e.started_at) === today);
    if (!row || hasToday) continue;
    const event = createWatchEvent(row, { now, feed: state.scan?.feed, plan: assessRow(state, row, now).plan });
    if (event) {
      state.journal = [...state.journal, event].slice(-JOURNAL_LIMIT);
      added = true;
      state.dirty = true;
    }
  }
  return added;
}

/** Toggle a symbol. Returns 'added' | 'recording' | 'removed' | 'full'. */
export function toggleWatch(state, symbol, now) {
  if (state.watched.has(symbol)) {
    state.watched.delete(symbol);
    return 'removed';
  }
  if (state.watched.size >= WATCH_LIMIT) return 'full';
  state.watched.add(symbol);
  return startWatchEvents(state, now) ? 'recording' : 'added';
}

export function removeEvent(state, id) {
  const before = state.journal.length;
  state.journal = state.journal.filter((e) => e.id !== id);
  return state.journal.length !== before;
}

// ---- selectors ------------------------------------------------------------------

const inUniverse = (r) => positive(r.market_cap) && r.market_cap < UNIVERSE_CAP;

function matchesFilters(state, row, now) {
  const { search, maxPrice, filter } = state.ui;
  const q = search.trim().toUpperCase();
  if (q && !row.symbol.includes(q) && !(row.name ?? '').toUpperCase().includes(q)) return false;
  if (positive(row.price) && row.price > maxPrice) return false;
  const a = assessRow(state, row, now);
  switch (filter) {
    case 'READY': return a.state === 'READY';
    case 'CONFIRM': return a.state === 'CONFIRM';
    case 'fresh': return a.checks.find((c) => c.key === 'trade').pass;
    case 'news': return Boolean(row.news?.length);
    default: return true;
  }
}

/** Rows for the active list view, filtered and ordered. */
export function visibleRows(state, now) {
  const { view } = state.ui;
  let rows;
  if (view === 'watch') {
    // The watch list is the user's own: no universe filter, placeholders until data arrives.
    rows = [...state.watched].map((s) => state.stocks.get(s) ?? { symbol: s, name: s, placeholder: true });
  } else {
    rows = (state.scan?.order ?? []).map((s) => state.stocks.get(s)).filter((r) => r && inUniverse(r));
  }
  if (view === 'early') rows = rows.filter((r) => !isExtended(r));
  if (view === 'gainers') {
    rows.sort((a, b) => (b.day_change ?? -Infinity) - (a.day_change ?? -Infinity));
  } else {
    rows.sort((a, b) => assessRow(state, b, now).passed - assessRow(state, a, now).passed || (b.score ?? 0) - (a.score ?? 0));
  }
  return rows.filter((r) => matchesFilters(state, r, now)).slice(0, LIST_LIMIT);
}

export function groupRows(state, rows, now) {
  return splitPriority(rows, {
    now,
    serverTime: state.scan?.server_time,
    connected: state.connection.phase === 'live' || state.connection.phase === 'partial',
    feed: state.scan?.feed,
    assessment: (r) => assessRow(state, r, now),
  });
}

export function journalRows(state) {
  const q = state.ui.search.trim().toUpperCase();
  return [...state.journal]
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .filter((e) => !q || e.symbol.includes(q));
}

export function metrics(state, now) {
  const rows = (state.scan?.order ?? []).map((s) => state.stocks.get(s)).filter(Boolean);
  return {
    scanned: state.scan?.coverage?.eligible_small_caps ?? null,
    priced: state.scan?.coverage?.with_prices ?? null,
    fresh: rows.filter((r) => assessRow(state, r, now).checks.find((c) => c.key === 'trade').pass).length,
    signals: rows.filter((r) => r.signal?.expansion && !isExtended(r) && assessRow(state, r, now).checks.find((c) => c.key === 'history').pass).length,
    plans: rows.filter((r) => assessRow(state, r, now).plan).length,
  };
}

/** The row shown in the dossier: live data, else the latest journal record, else a placeholder. */
export function selectedRow(state) {
  const symbol = state.ui.selected;
  if (!symbol) return null;
  const live = state.stocks.get(symbol);
  if (live) return live;
  const event = [...state.journal].reverse().find((e) => e.symbol === symbol);
  if (event) return { symbol, name: event.name, price: event.last_price, price_at: event.last_at };
  return { symbol, name: symbol, placeholder: true };
}
