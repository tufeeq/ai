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

// Nasdaq early closes (13:00 New York) inside the studied and live periods.
export const EARLY_CLOSES = new Set(['2023-07-03', '2023-11-24', '2024-07-03', '2024-11-29', '2024-12-24',
  '2025-07-03', '2025-11-28', '2025-12-24', '2026-11-27', '2026-12-24']);
const nyDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const nyHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' });

/** Regular-session bounds [open, close) in ms for the New York date containing `ms` (EDT/EST aware). */
export function regularSession(ms) {
  const day = nyDay.format(new Date(ms));
  const offset = 16 - Number(nyHour.format(new Date(`${day}T16:00:00Z`))); // 4 in EDT, 5 in EST
  const open = Date.parse(`${day}T${String(9 + offset).padStart(2, '0')}:30:00Z`);
  return { day, open, close: open + (EARLY_CLOSES.has(day) ? 210 : 390) * 60_000 };
}

/** True for a minute bar that starts inside its date's regular session (09:30 ≤ t < close). */
export function isRegularBar(t) {
  const ms = typeof t === 'number' ? t : Date.parse(t);
  const { open, close } = regularSession(ms);
  return ms >= open && ms < close;
}

/**
 * Replay the detector over one symbol's bars exactly like the frozen study (minute by minute,
 * 90-bar lookback, cooldown) and return signals whose decision time is inside [from, to].
 * Only regular-session bars are used (the studies fetched 09:30–16:00 only): pre-market bars must
 * not seed the baseline and pre/after-market bursts (including the 16:00 closing-cross bar the
 * provider returns for an inclusive end) must not become signals nobody studied.
 */
export function detectSymbol(symbol, rawBars, { from = -Infinity, to = Infinity, regularOnly = true } = {}) {
  const bars = rawBars.map(toBar).filter((b) => !regularOnly || isRegularBar(b.t)).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
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
      // The live list's own early-move limit (discovery-1 maxEarly3mGain). The detector does not apply
      // it, so the SIP list showed these as ordinary signals; sip-study-1 holdout: −2.07% (n=718) vs
      // −0.83% for the rest, after 0.5 pp.
      extended: s.return_3m > RULES.maxEarly3mGain,
      source: 'SIP_DELAYED',
    });
  }
  return signals;
}

// Timing of the studied trade (sip-study-1 "delayed" and paper-ledger-1): the signal becomes visible
// 17 minutes after detection, entry must happen within the next 2 minutes, exit 30 minutes later.
export const STUDIED_VISIBLE_MS = 17 * 60_000;
export const STUDIED_ENTRY_WINDOW_MS = 2 * 60_000;
export const STUDIED_HORIZON_MS = 30 * 60_000;

/**
 * Where a delayed signal stands against the studied timing at `now`:
 *   ENTRY   — inside the studied entry window (17–19 min after detection);
 *   LATE    — past the studied entry but the studied 30-minute holding period is still running;
 *             an entry now is a different, unstudied trade;
 *   EXPIRED — the studied trade would already have ended; history only.
 * (Before 17 minutes the relay cannot have served the bars, so it counts as ENTRY.)
 */
export function signalPhase(signal, now) {
  const age = now - Date.parse(signal?.detected_at);
  if (!Number.isFinite(age)) return 'EXPIRED';
  if (age <= STUDIED_VISIBLE_MS + STUDIED_ENTRY_WINDOW_MS) return 'ENTRY';
  if (age <= STUDIED_VISIBLE_MS + STUDIED_HORIZON_MS) return 'LATE';
  return 'EXPIRED';
}

const PHASE_ORDER = { ENTRY: 0, LATE: 1, EXPIRED: 2 };

/**
 * Display order for the SIP list: expired signals last; before them, signals with an extension warning
 * (3-minute burst > 8% or a fade-study-1 flag from `fadeOf(symbol)`) after the rest; then by phase
 * (studied entry window before late), then newest first.
 * Returns new objects carrying `phase` and `warned`. This de-emphasises chasing; it is not an edge:
 * every studied bucket lost money after costs.
 */
export function rankSipSignals(signals, now, fadeOf = () => null) {
  return (signals ?? [])
    .map((s) => ({ ...s, extended: s.extended ?? s.return_3m > RULES.maxEarly3mGain, phase: signalPhase(s, now), fade: fadeOf(s.symbol) ?? null }))
    .map((s) => ({ ...s, warned: Boolean(s.extended || s.fade) }))
    .sort((a, b) => Number(a.phase === 'EXPIRED') - Number(b.phase === 'EXPIRED') || Number(a.warned) - Number(b.warned) ||
      PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] ||
      Date.parse(b.detected_at) - Date.parse(a.detected_at) || a.symbol.localeCompare(b.symbol));
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
  // Last consolidated minute per symbol: a delayed price (bar start time, so its age is never understated).
  const last = {};
  let withBars = 0, failed = 0, bars = 0, next = 0;
  async function worker() {
    while (next < groups.length) {
      const group = groups[next++];
      try {
        const data = await fetchBatch(getJson, service, group, window);
        for (const [symbol, list] of Object.entries(data)) {
          withBars++;
          bars += list.length;
          const end = list.reduce((m, b) => (Date.parse(b.t) > Date.parse(m?.t ?? 0) && b.c > 0 ? b : m), null);
          if (end) last[symbol] = { price: end.c, price_at: end.t };
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
    symbols: groups.flat().length, with_bars: withBars, failed, bars, signals, last,
  };
}
