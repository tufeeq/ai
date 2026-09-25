// Consolidated (SIP) signal scan through the quote service's read-only historical relay.
// The unchanged discovery-1 detector runs on consolidated minute bars — the data it was studied
// on — for every eligible symbol. Bars are at least 16 minutes old (free-plan SIP), so signals
// are delayed and say so. Windows are aligned to 5-minute buckets so every viewer requests the
// same URLs and shares the relay's cache instead of multiplying provider calls.
import { analyzeBars, RULES } from './detector.js';

export const SIP_DELAY_MS = 16.5 * 60_000; // relay serves bars older than 16 minutes
export const BUCKET_MS = 5 * 60_000;
export const LOOKBACK_MS = 110 * 60_000; // 90-bar detector lookback plus warm-up
export const BATCH = 100; // relay maximum symbols per request
export const SIGNAL_WINDOW_MS = 120 * 60_000; // report signals detected in the last two hours of data

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Latest window whose end is safely older than the SIP delay, aligned to a shared bucket. */
export function scanWindow(now) {
  const end = Math.floor((now - SIP_DELAY_MS) / BUCKET_MS) * BUCKET_MS;
  return { start: iso(end - LOOKBACK_MS - SIGNAL_WINDOW_MS), end: iso(end), endMs: end };
}

/** Stable batches: sorted symbols split into groups of 100 (identical URLs across viewers). */
export function batches(symbols) {
  const sorted = [...new Set(symbols)].sort();
  const out = [];
  for (let i = 0; i < sorted.length; i += BATCH) out.push(sorted.slice(i, i + BATCH));
  return out;
}

export function relayUrl(service, symbols, window, feed = 'sip', pageToken = null) {
  const q = new URLSearchParams({
    resource: 'bars', symbols: symbols.join(','), timeframe: '1Min', start: window.start, end: window.end,
    feed, adjustment: 'raw', limit: '10000', sort: 'asc',
  });
  if (pageToken) q.set('page_token', pageToken);
  return `${service}/api/lab/provider?${q}`;
}

/** Fetch every page of one batch. `getJson(url)` resolves the provider payload. */
export async function fetchBatch(getJson, service, symbols, window, feed = 'sip') {
  const out = {};
  let token = null;
  for (let page = 0; page < 10; page++) {
    const body = await getJson(relayUrl(service, symbols, window, feed, token));
    for (const [s, bars] of Object.entries(body?.bars ?? {})) (out[s] ??= []).push(...bars);
    token = body?.next_page_token;
    if (!token) return out;
  }
  return out;
}

const toBar = (b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n, vw: b.vw });

/**
 * Replay the detector over one symbol's bars exactly like the frozen study (minute by minute,
 * 90-bar lookback, cooldown) and return signals whose decision time is inside [from, to].
 */
export function detectSymbol(symbol, rawBars, { from = -Infinity, to = Infinity } = {}) {
  const bars = rawBars.map(toBar).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const signals = [];
  let last = -Infinity;
  for (let i = 0; i < bars.length; i++) {
    const now = Date.parse(bars[i].t) + 60_000;
    if (now > to) break;
    const s = analyzeBars(bars.slice(Math.max(0, i - 89), i + 1), now);
    if (!s?.expansion || now - last < RULES.cooldown) continue;
    last = now;
    if (now < from) continue;
    const risk = s.trigger > 0 && s.stop > 0 ? s.trigger - s.stop : null;
    signals.push({
      symbol,
      detected_at: new Date(now).toISOString(),
      price: bars[i].c,
      return_3m: s.return_3m,
      volume_ratio: s.volume_ratio,
      dollars_3m: s.dollars_3m,
      trades_3m: s.trades_3m,
      breakout: s.breakout,
      trigger: s.trigger,
      stop: s.stop,
      plan_valid: s.plan_valid,
      targets: risk > 0 ? [s.trigger + risk, s.trigger + 2 * risk] : null,
      source: 'SIP_DELAYED',
    });
  }
  return signals;
}

/**
 * Scan all symbols. Returns signals (newest first) plus coverage so the page can say how many
 * symbols had consolidated bars and whether any batch failed.
 */
export async function sipScan({ getJson, service, symbols, now, concurrency = 3 }) {
  const window = scanWindow(now);
  const from = window.endMs - SIGNAL_WINDOW_MS;
  const groups = batches(symbols);
  const signals = [];
  let withBars = 0, failed = 0, bars = 0, next = 0;
  async function worker() {
    while (next < groups.length) {
      const group = groups[next++];
      try {
        const data = await fetchBatch(getJson, service, group, window);
        for (const [symbol, list] of Object.entries(data)) {
          withBars++;
          bars += list.length;
          signals.push(...detectSymbol(symbol, list, { from, to: window.endMs }));
        }
      } catch {
        failed += group.length;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, worker));
  signals.sort((a, b) => Date.parse(b.detected_at) - Date.parse(a.detected_at) || b.volume_ratio - a.volume_ratio);
  return {
    window_start: window.start, window_end: window.end, scanned_at: new Date(now).toISOString(),
    symbols: groups.flat().length, with_bars: withBars, failed, bars, signals,
  };
}
