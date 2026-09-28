// Real-time consolidated detector (discovery-1c).
//
// Why: the live scanner runs discovery-1 on Alpaca IEX minute bars. IEX is one exchange, so a small
// cap rarely prints 30 IEX trades in three minutes and the scanner almost never fires, while the
// same rules on consolidated (SIP) bars fire hundreds of times a session.
// What: the unchanged discovery-1 bar analysis (analyzeBars, imported from the frozen scanner) on
// real-time consolidated minute bars from Nasdaq.com's public chart data (price and shares per
// minute across all exchanges). That source has no trade counts and no intrabar highs and lows, so:
//   - the 30-trade rule is not evaluated (trades_3m is null; dollar value, volume ratio and
//     single-minute concentration still apply);
//   - a minute's high/low are max/min of its close and the previous close, so stops sit closer
//     than true intrabar lows would put them.
// How it runs: the live board rotates Nasdaq.com watchlist quotes (price + cumulative volume) over
// the whole universe; each cycle the symbols with the strongest recent consolidated move and
// dollar volume get their minute chart fetched (rate-limited) and analysed. Signals are research
// output, not recommendations: every study so far found no positive edge after costs.
import { analyzeBars, RULES } from './scanner.mjs';
import { HEADERS, extendedHours } from './live.mjs';
import { observe } from './store.mjs';

export const PULSE_RULES = Object.freeze({
  version: 'discovery-1c', base: RULES.version,
  cycleMs: 15_000, // how often candidates are re-ranked
  chartEveryMs: 4_000, // at most one chart request per 4 s (15/min) on top of the watchlist rotation
  recheckMs: 60_000, // a symbol's chart is refetched at most once a minute
  signalTtlMs: 150_000, // a signal older than this is not applied to scanner rows
  historyMs: 20 * 60_000, // watchlist samples kept per symbol
  lookbackMs: 5 * 60_000, // candidate move measured over roughly this span
  minMovePct: 0.5, // candidate filter: consolidated move over the lookback
  minDollars: 15_000, // candidate filter: dollars traded over the lookback (volume delta × price)
  maxCandidates: 60,
  backoffMs: 5 * 60_000,
});
export const chartUrl = (symbol) => `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/chart?assetclass=stocks&charttype=rs`;
const positive = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const pct = (a, b) => (positive(a) && positive(b) ? (a / b - 1) * 100 : null);
const iso = (ms) => new Date(ms).toISOString();
const nyParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Regular session (09:30–16:00 New York, weekdays; holidays are simply quiet). */
export function regularMinute(ms) {
  const p = Object.fromEntries(nyParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return false;
  const m = +p.hour * 60 + +p.minute;
  return m >= 570 && m < 960;
}

/** Nasdaq.com chart (charttype=rs) → minute bars {t,o,h,l,c,v,n,vw} for the regular session. */
export function chartBars(body) {
  const points = Array.isArray(body?.data?.chart) ? body.data.chart : [];
  const minutes = new Map();
  for (const p of points) {
    const t = Number(p?.x), c = Number(p?.y), v = Number(p?.w ?? String(p?.z?.shares ?? '').replace(/,/g, ''));
    if (!Number.isFinite(t) || !positive(c) || !(v >= 0)) continue;
    const minute = Math.floor(t / 60_000) * 60_000;
    const prev = minutes.get(minute);
    minutes.set(minute, prev ? { c, v: prev.v + v } : { c, v });
  }
  const out = [];
  let prevClose = null;
  for (const [minute, { c, v }] of [...minutes].sort((a, b) => a[0] - b[0])) {
    const o = prevClose ?? c;
    prevClose = c;
    if (!regularMinute(minute)) continue;
    out.push({ t: iso(minute), o, h: Math.max(o, c), l: Math.min(o, c), c, v, n: null, vw: c });
  }
  return out;
}

/** discovery-1 on consolidated bars without the trade-count rule (the source has no counts). */
export function consolidatedSignal(bars, now) {
  const s = analyzeBars(bars, now);
  if (!s) return null;
  const last = bars.filter((b) => Date.parse(b.t) + 60_000 <= now).at(-1);
  const quality = s.volume_concentration <= RULES.maxSingleMinuteShare && positive(s.vwap_window) && last?.c >= s.vwap_window;
  const expansion = Boolean(s.ready && quality && s.volume_ratio >= RULES.volumeRatio && s.return_3m >= RULES.return3m && s.dollars_3m >= RULES.minDollars3m);
  return { ...s, trades_3m: null, quality, expansion, source: 'CONSOLIDATED_NASDAQ', rules: PULSE_RULES.version, last_close: last?.c ?? null };
}

/** Candidate ranking from watchlist samples: recent consolidated move with real dollar volume. */
export function rankCandidates(history, now, r = PULSE_RULES) {
  const out = [];
  for (const [symbol, samples] of history) {
    const last = samples.at(-1);
    if (!last || now - last.at > 3 * 60_000) continue;
    const base = samples.find((x) => last.at - x.at <= r.lookbackMs) ?? samples[0];
    if (!base || base === last) continue;
    const move = pct(last.price, base.price);
    const dollars = last.volume !== null && base.volume !== null ? Math.max(0, last.volume - base.volume) * last.price : null;
    if (move === null || dollars === null || move < r.minMovePct || dollars < r.minDollars) continue;
    out.push({ symbol, move, dollars, score: move * Math.log10(dollars) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, r.maxCandidates);
}

export function createPulse({ board, fetcher = fetch, now = Date.now, timers = { setTimeout, clearTimeout }, rules = PULSE_RULES, onExpansion = null, store = null, storeError = null } = {}) {
  const history = new Map(), signals = new Map(), checkedAt = new Map(), ledger = [];
  const stat = { status: 'IDLE', charts_ok: 0, charts_failed: 0, last_error: null, last_cycle_at: null, candidates: 0, blocked_until: 0 };
  let timer = null, running = false, lastChart = 0, queue = [];
  let storageError = storeError;
  const persist = (fn) => { if (!store) return; try { fn(); } catch (e) { storageError = e.message; } };
  persist(() => { for (const e of store.recent(300)) ledger.push(e); });

  function sample() {
    const snap = board.snapshot?.();
    if (!snap) return;
    for (const [symbol, q] of snap) {
      const at = Date.parse(q.fetched_at);
      if (!positive(q.price) || !Number.isFinite(at)) continue;
      const list = history.get(symbol) ?? [];
      if (list.at(-1)?.at === at) continue;
      list.push({ at, price: q.price, volume: q.volume ?? null });
      while (list.length && at - list[0].at > rules.historyMs) list.shift();
      history.set(symbol, list);
    }
  }

  async function fetchChart(symbol) {
    try {
      const r = await fetcher(chartUrl(symbol), { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
      if (r.status === 403 || r.status === 429) { stat.blocked_until = now() + rules.backoffMs; throw Error('BLOCKED_' + r.status); }
      if (!r.ok) throw Error('HTTP_' + r.status);
      const bars = chartBars(await r.json());
      const t = now(), signal = consolidatedSignal(bars, t);
      checkedAt.set(symbol, t);
      stat.charts_ok++;
      if (signal) {
        signals.set(symbol, { ...signal, evaluated_at: iso(t) });
        if (signal.expansion) {
          try { onExpansion?.(symbol); } catch { /* quote prefetch is best effort */ }
          const prev = ledger.find((x) => x.symbol === symbol);
          if (!prev || t - Date.parse(prev.detected_at) >= RULES.cooldown) {
            const entry = { symbol, detected_at: iso(t), bar_at: signal.bar_at, price: signal.last_close, return_3m: signal.return_3m,
              volume_ratio: signal.volume_ratio, dollars_3m: signal.dollars_3m, trigger: signal.trigger, stop: signal.stop, plan_valid: signal.plan_valid, rules: rules.version, observed: {} };
            ledger.unshift(entry);
            ledger.splice(300);
            persist(() => store.record(entry));
          }
        }
      } else signals.delete(symbol);
    } catch (e) {
      stat.charts_failed++; stat.last_error = e.message;
    }
  }

  /** Follow each signal of the last seven hours with the latest consolidated price. */
  function track(t) {
    const snap = board.snapshot?.();
    if (!snap) return;
    for (const entry of ledger) {
      if (t - Date.parse(entry.detected_at) > 7 * 3600_000) break;
      const q = snap.get(entry.symbol);
      if (q && observe(entry, q.price, Date.parse(q.fetched_at))) persist(() => store.observe(entry));
    }
  }

  async function cycle() {
    const t = now();
    if (!extendedHours(t)) { stat.status = 'MARKET_CLOSED'; return; }
    await board.get?.(); // keeps the watchlist rotation running while the pulse is on
    sample();
    track(t);
    const ranked = rankCandidates(history, t, rules);
    stat.candidates = ranked.length;
    // Symbols with a live signal are re-checked first so plans stay current; then the new movers.
    const again = [...signals.entries()].filter(([, s]) => s.expansion).map(([sym]) => sym);
    queue = [...new Set([...again, ...ranked.map((c) => c.symbol)])].filter((sym) => t - (checkedAt.get(sym) ?? 0) >= rules.recheckMs);
    stat.status = t < stat.blocked_until ? 'BACKING_OFF' : 'OK';
    stat.last_cycle_at = iso(t);
  }

  async function drain() {
    const end = now() + rules.cycleMs;
    while (queue.length && now() < end && now() >= stat.blocked_until && regularMinute(now())) {
      const wait = lastChart + rules.chartEveryMs - now();
      if (wait > 0) await new Promise((r) => timers.setTimeout(r, wait));
      lastChart = now();
      await fetchChart(queue.shift());
    }
  }

  async function loop() {
    timer = null;
    if (!running) return;
    try { await cycle(); await drain(); } catch (e) { stat.last_error = e.message; }
    if (running) { timer = timers.setTimeout(loop, Math.max(1000, rules.cycleMs - 0)); timer?.unref?.(); }
  }

  return {
    start() { if (!running) { running = true; void loop(); } },
    stop() { running = false; if (timer) timers.clearTimeout(timer); timer = null; },
    /** Current signal for a symbol when evaluated recently enough to act on. */
    signal(symbol, t = now()) {
      const s = signals.get(symbol);
      return s && t - Date.parse(s.evaluated_at) <= rules.signalTtlMs ? s : null;
    },
    signals: () => signals,
    ledger: () => ledger,
    status: () => ({ source: 'NASDAQ_COM_CHART', rules: rules.version, status: stat.status, charts_ok: stat.charts_ok, charts_failed: stat.charts_failed,
      last_error: stat.last_error, last_cycle_at: stat.last_cycle_at, candidates: stat.candidates, tracked: history.size,
      live_signals: [...signals.values()].filter((s) => s.expansion && now() - Date.parse(s.evaluated_at) <= rules.signalTtlMs).length, running,
      storage: store ? { kind: 'SQLITE', path: store.path, signals: (() => { try { return store.count(); } catch { return null; } })(), error: storageError } : { kind: 'MEMORY', error: storageError } }),
    // tests
    _sample: sample, _track: track, _cycle: cycle, _fetchChart: fetchChart, _queue: () => queue,
  };
}

/**
 * Apply fresh consolidated signals to scanner rows (server-side, before the consolidated overlay is
 * attached): the row's signal becomes the consolidated one, with the scanner's own stage/extension
 * logic. Plans are completed in `completePlans` once the consolidated quote is attached.
 */
export function applySignals(result, pulse, t) {
  if (!pulse || !Array.isArray(result?.rows)) return result;
  const rows = result.rows.map((row) => {
    const s = pulse.signal(row.symbol, t);
    if (!s) return row;
    const extended = (row.day_change ?? 0) > RULES.maxEarlyDayGain || (s.return_3m ?? 0) > RULES.maxEarly3mGain;
    const score = s.ready ? Math.round(Math.min(40, Math.max(0, s.return_3m) * 10) + Math.min(35, (s.volume_ratio ?? 0) * 7) + Math.min(15, s.dollars_3m / 10000) + (s.breakout ? 10 : 0)) : 0;
    return { ...row, signal: s, signal_source: 'CONSOLIDATED_NASDAQ', extended, score,
      stage: extended ? 'EXTENDED' : !s.ready ? 'WARMUP' : s.expansion ? (s.breakout ? 'BREAKOUT' : 'EXPANSION') : 'WATCH', actionable: false, plan: null };
  });
  return { ...result, rows, pulse: pulse.status() };
}

/** Conditional plans for consolidated signals, using the attached Nasdaq.com consolidated quote. */
export function completePlans(result, t) {
  if (!Array.isArray(result?.rows)) return result;
  const rows = result.rows.map((row) => {
    const s = row.signal;
    if (row.signal_source !== 'CONSOLIDATED_NASDAQ' || !s?.expansion) return row;
    const q = row.consolidated;
    const quoteFresh = q && q.real_time !== false && positive(q.bid) && positive(q.ask) && q.bid <= q.ask && t - Date.parse(q.fetched_at) <= 30_000;
    const spread = quoteFresh ? ((q.ask - q.bid) / ((q.ask + q.bid) / 2)) * 100 : null;
    const price = positive(q?.price) ? q.price : row.price;
    const actionable = Boolean(!row.extended && s.plan_valid && quoteFresh && spread <= RULES.maxSpread && price <= s.trigger * 1.01 && price > s.stop);
    if (!actionable) return { ...row, actionable: false, plan: null };
    const entry = Math.max(q.ask, s.trigger), risk = entry - s.stop;
    return { ...row, actionable: true, plan: { entry, stop: s.stop, targets: [entry + risk, entry + 2 * risk], kind: 'CONDITIONAL', source: 'CONSOLIDATED_NASDAQ' } };
  });
  return { ...result, rows };
}
