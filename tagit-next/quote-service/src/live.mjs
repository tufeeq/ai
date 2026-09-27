// Live consolidated board for the whole eligible universe, at no cost:
//   CONSOLIDATED — Nasdaq.com's public watchlist endpoint (unofficial, free): consolidated last sale
//                  for many symbols per request, polled in a rotation; symbols that viewers are
//                  looking at are refreshed first. The trade time has minute resolution.
//   IEX          — Alpaca snapshots on the free IEX feed (exact trade times, one exchange only).
//   SIP_DELAYED  — Alpaca consolidated minute bars at least 16 minutes old (free-plan limit).
// Each row reports the newest price with its source, its trade time and when a real-time
// consolidated source last confirmed it; the day change uses the consolidated split-adjusted close
// of the session before the price's own session. Polling runs only while viewers ask for the board.
import { settings, REFERENCE_URL, normalizeReference } from './market.mjs';

export const WATCHLIST = 'https://api.nasdaq.com/api/quote/watchlist?';
export const HEADERS = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
export const DEFAULTS = Object.freeze({
  nasdaqBatch: 20, // the watchlist endpoint answers at most 20 symbols per request (measured)
  nasdaqParallel: 1, // requests per step; 25 sequential requests/min drew no throttling (measured)
  nasdaqIntervalMs: 1000, // pause between steps (each request takes about 1–2 s)
  hotMaxAgeMs: 15_000, // viewed symbols are refreshed when older than this
  iexIntervalMs: 20_000,
  sipIntervalMs: 60_000,
  idleAfterMs: 5 * 60_000, // stop polling when nobody asked for the board
  backoffMs: 5 * 60_000,
  universeTtlMs: 30 * 60_000,
});
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const nyClock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const sessionDate = (t) => (Number.isFinite(new Date(t).getTime()) ? nyDate.format(new Date(t)) : null);
const positive = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const money = (s) => { const n = Number(String(s ?? '').replace(/[$,+\s]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const signed = (s) => { const t = String(s ?? '').replace(/[$,%\s]/g, ''); if (t === 'UNCH') return 0; const n = t ? Number(t) : NaN; return Number.isFinite(n) ? n : null; };
const iso = (ms) => new Date(ms).toISOString();

/** "Sep 25, 2026 2:40 PM ET" → ISO UTC start of that New York minute; a bare date is not a time. */
export function nasdaqMinute(text) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM) ET$/.exec(String(text ?? '').trim());
  if (!m || !(m[1] in MONTHS)) return null;
  const hour = (+m[4] % 12) + (m[6] === 'PM' ? 12 : 0), wall = Date.UTC(+m[3], MONTHS[m[1]], +m[2], hour, +m[5]);
  for (const offset of [4, 5]) {
    const guess = wall + offset * 3600000;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    if (+parts.find((p) => p.type === 'hour').value === hour && +parts.find((p) => p.type === 'minute').value === +m[5]) return iso(guess);
  }
  return null;
}

export const watchlistUrl = (symbols) => WATCHLIST + symbols.map((s) => 'symbol=' + encodeURIComponent(s.toLowerCase() + '|stocks')).join('&');

/**
 * "2026-09-25T14:40:00" (New York wall time) → ISO UTC; midnight means the source knows only the
 * date (weekends show "Sep 24, 2026" / "2026-09-24T00:00:00"), which is not a trade time.
 */
export function nasdaqDateTime(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(text ?? ''));
  if (!m || (m[4] === '00' && m[5] === '00')) return null;
  const month = Object.keys(MONTHS)[+m[2] - 1], h = +m[4];
  return month ? nasdaqMinute(`${month} ${+m[3]}, ${m[1]} ${h % 12 || 12}:${m[5]} ${h >= 12 ? 'PM' : 'AM'} ET`) : null;
}

/** Watchlist payload → Map(symbol → consolidated quote). Rows without a price or minute time are dropped. */
export function parseWatchlist(body, fetchedAt) {
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.data?.rows) ? body.data.rows : [];
  const out = new Map();
  for (const r of rows) {
    const symbol = String(r?.symbol ?? '').toUpperCase();
    const price = money(r?.lastSalePrice ?? r?.lastsale), at = nasdaqMinute(r?.lastTradeTimestamp) ?? nasdaqDateTime(r?.lastTradeTimestampDateTime);
    if (!SYMBOL.test(symbol) || !price || !at || Date.parse(at) > fetchedAt + 60_000) continue;
    const change = signed(r?.netChange), listed = Number(r?.previousClosePrice);
    out.set(symbol, { price, trade_minute_at: at, fetched_at: iso(fetchedAt), change, change_pct: signed(r?.percentageChange),
      previous_close: listed > 0 ? listed : change !== null && price - change > 0 ? Math.round((price - change) * 1e4) / 1e4 : null });
  }
  return out;
}

/** Extended-hours window (04:00–20:00 New York, weekdays; holidays not known here). */
export function extendedHours(now) {
  const p = Object.fromEntries(nyClock.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const m = Number(p.hour) * 60 + Number(p.minute);
  return !['Sat', 'Sun'].includes(p.weekday) && m >= 240 && m < 1200;
}

/**
 * Pick the newest trade. The consolidated time is a minute start, so an IEX trade inside the same
 * or a later minute wins (it is exact), and the consolidated price wins only for a later minute.
 */
export function pickPrice({ nasdaq, iex, sip }) {
  const minute = (t) => Math.floor(Date.parse(t) / 60_000);
  const n = nasdaq && positive(nasdaq.price) && Number.isFinite(minute(nasdaq.trade_minute_at)) ? nasdaq : null;
  const i = iex && positive(iex.price) && Number.isFinite(minute(iex.at)) ? iex : null;
  const d = sip && positive(sip.price) && Number.isFinite(minute(sip.at)) ? sip : null;
  let best = null;
  if (i && (!n || minute(i.at) >= minute(n.trade_minute_at))) best = { price: i.price, price_at: i.at, price_source: 'IEX', verified_at: null, m: minute(i.at) };
  else if (n) best = { price: n.price, price_at: n.trade_minute_at, price_source: 'CONSOLIDATED', verified_at: n.fetched_at, m: minute(n.trade_minute_at) };
  // Delayed bars win only when neither real-time source has seen a trade in that minute or later.
  if (d && (!best || minute(d.at) > best.m)) best = { price: d.price, price_at: d.at, price_source: 'SIP_DELAYED', verified_at: null, m: minute(d.at) };
  if (!best) return null;
  const { m, ...out } = best;
  return out;
}

export function createLiveBoard({ env = process.env, fetcher = fetch, now = Date.now, closes = null, options = {}, timers = { setTimeout, clearTimeout } } = {}) {
  const o = { ...DEFAULTS, ...options };
  const nasdaq = new Map(), iex = new Map(), sip = new Map(), hot = new Map();
  let universe = [], universeAt = 0, universeLoading = null, cursor = 0, lastAsked = 0, timer = null, running = false;
  const stat = {
    nasdaq: { status: 'IDLE', ok: 0, failed: 0, blocked_until: 0, last_ok_at: null, last_error: null, cycle_ms: null, cycle_started: 0 },
    iex: { status: 'IDLE', at: 0, last_error: null },
    sip: { status: 'IDLE', at: 0, feed: null, last_error: null },
  };
  const alpaca = async (url) => {
    const s = settings(env);
    if (!s.configured) throw Error('RUNTIME_CREDENTIALS_NOT_CONFIGURED');
    const r = await fetcher(url, { headers: { 'APCA-API-KEY-ID': s.key, 'APCA-API-SECRET-KEY': s.secret }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw Error('HTTP_' + r.status);
    return r.json();
  };

  async function loadUniverse() {
    const s = settings(env);
    const [assets, raw] = await Promise.all([
      s.configured ? alpaca('https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity&exchange=NASDAQ') : Promise.resolve(null),
      fetcher(REFERENCE_URL, { signal: AbortSignal.timeout(15_000) }).then((r) => (r.ok ? r.json() : Promise.reject(Error('REFERENCE_' + r.status)))),
    ]);
    const ref = normalizeReference(raw, now());
    const listed = Array.isArray(assets) ? new Set(assets.filter((a) => a.exchange === 'NASDAQ' && a.status === 'active').map((a) => a.symbol)) : null;
    universe = [...ref.rows.keys()].filter((x) => SYMBOL.test(x) && (!listed || listed.has(x))).sort();
    universeAt = now();
  }
  function ensureUniverse() {
    if ((!universe.length || now() - universeAt > o.universeTtlMs) && !universeLoading) {
      universeLoading = loadUniverse().catch((e) => { stat.nasdaq.last_error = 'UNIVERSE_' + e.message; }).finally(() => { universeLoading = null; });
    }
    return universeLoading;
  }

  /** Next Nasdaq batch: stale viewed symbols first, then the rotation over the universe. */
  function nextBatch() {
    const t = now(), batch = [];
    for (const [s, until] of hot) {
      if (until < t) { hot.delete(s); continue; }
      const q = nasdaq.get(s);
      if (!q || t - Date.parse(q.fetched_at) > o.hotMaxAgeMs) batch.push(s);
      if (batch.length >= o.nasdaqBatch) return batch;
    }
    const all = [...new Set([...universe, ...hot.keys()])];
    let steps = 0;
    for (; steps < all.length && batch.length < o.nasdaqBatch; steps++) {
      const s = all[(cursor + steps) % all.length];
      if (!batch.includes(s)) batch.push(s);
    }
    if (all.length && steps) {
      const before = cursor;
      cursor = (cursor + steps) % all.length;
      if (cursor < before || all.length <= o.nasdaqBatch) {
        stat.nasdaq.cycle_ms = stat.nasdaq.cycle_started ? t - stat.nasdaq.cycle_started : null;
        stat.nasdaq.cycle_started = t;
      }
    }
    return batch;
  }

  async function pollNasdaq() {
    if (now() < stat.nasdaq.blocked_until) { stat.nasdaq.status = 'BACKING_OFF'; return; }
    const batch = nextBatch();
    if (!batch.length) return;
    try {
      const r = await fetcher(watchlistUrl(batch), { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
      if (r.status === 403 || r.status === 429) { stat.nasdaq.blocked_until = now() + o.backoffMs; throw Error('BLOCKED_' + r.status); }
      if (!r.ok) throw Error('HTTP_' + r.status);
      const got = parseWatchlist(await r.json(), now());
      for (const [s, q] of got) nasdaq.set(s, q);
      stat.nasdaq.ok++; stat.nasdaq.status = 'OK'; stat.nasdaq.last_ok_at = iso(now());
      if (!got.size) stat.nasdaq.last_error = 'EMPTY_BATCH';
    } catch (e) {
      stat.nasdaq.failed++; stat.nasdaq.last_error = e.message; stat.nasdaq.status = now() < stat.nasdaq.blocked_until ? 'BACKING_OFF' : 'FAILING';
    }
  }

  async function pollIex() {
    const s = settings(env);
    if (!s.configured) { stat.iex.status = 'NOT_CONFIGURED'; return; }
    try {
      for (let i = 0; i < universe.length; i += 200) {
        const body = await alpaca('https://data.alpaca.markets/v2/stocks/snapshots?feed=iex&symbols=' + encodeURIComponent(universe.slice(i, i + 200).join(',')));
        for (const [sym, snap] of Object.entries(body ?? {})) {
          const t = snap?.latestTrade, q = snap?.latestQuote;
          if (positive(t?.p) && Number.isFinite(Date.parse(t?.t))) iex.set(sym, { price: t.p, at: t.t,
            bid: positive(q?.bp) && positive(q?.ap) && q.bp <= q.ap ? q.bp : null, ask: positive(q?.bp) && positive(q?.ap) && q.bp <= q.ap ? q.ap : null, quote_at: q?.t ?? null });
        }
      }
      stat.iex.status = 'OK'; stat.iex.at = now(); stat.iex.last_error = null;
    } catch (e) { stat.iex.status = 'FAILING'; stat.iex.last_error = e.message; }
  }

  /** Latest consolidated minute bar at least 16 minutes old for every symbol. */
  async function pollSip() {
    const s = settings(env);
    if (!s.configured) { stat.sip.status = 'NOT_CONFIGURED'; return; }
    const end = now() - 16.5 * 60_000, start = end - 45 * 60_000;
    try {
      for (let i = 0; i < universe.length; i += 200) {
        let token = null;
        for (let page = 0; page < 5; page++) {
          const url = 'https://data.alpaca.markets/v2/stocks/bars?timeframe=1Min&feed=sip&adjustment=raw&sort=asc&limit=10000&symbols=' + encodeURIComponent(universe.slice(i, i + 200).join(','))
            + '&start=' + encodeURIComponent(iso(start)) + '&end=' + encodeURIComponent(iso(end)) + (token ? '&page_token=' + encodeURIComponent(token) : '');
          const body = await alpaca(url);
          for (const [sym, bars] of Object.entries(body?.bars ?? {})) {
            const b = bars.filter((x) => positive(x.c)).at(-1);
            const prev = sip.get(sym);
            if (b && (!prev || Date.parse(b.t) >= Date.parse(prev.at))) sip.set(sym, { price: b.c, at: b.t });
          }
          token = body?.next_page_token;
          if (!token) break;
        }
      }
      stat.sip.status = 'OK'; stat.sip.at = now(); stat.sip.feed = 'sip'; stat.sip.last_error = null;
    } catch (e) { stat.sip.status = 'FAILING'; stat.sip.last_error = e.message; }
  }

  let lastIex = 0, lastSip = 0, inflight = null;
  async function run() {
    if (now() - lastAsked > o.idleAfterMs) { running = false; stat.nasdaq.status = 'IDLE'; return; }
    await ensureUniverse();
    const jobs = [];
    // Outside extended hours prices do not move: one pass keeps closing prices, then it rests.
    if (extendedHours(now()) || stat.nasdaq.cycle_ms === null) for (let k = 0; k < o.nasdaqParallel; k++) jobs.push(pollNasdaq());
    if (now() - lastIex >= o.iexIntervalMs) { lastIex = now(); jobs.push(pollIex()); }
    if (now() - lastSip >= o.sipIntervalMs) { lastSip = now(); jobs.push(pollSip()); }
    await Promise.all(jobs);
  }
  /** One polling step; a call during a running step waits for it instead of overlapping. */
  function tick() {
    timer = null;
    if (!running) return Promise.resolve();
    inflight ??= run().finally(() => { inflight = null; schedule(); });
    return inflight;
  }
  function schedule() {
    if (!running || timer) return;
    timer = timers.setTimeout(tick, o.nasdaqIntervalMs);
    timer?.unref?.();
  }
  function wake() {
    lastAsked = now();
    if (!running) { running = true; void tick(); }
  }

  function row(symbol, closeMap, today) {
    const q = nasdaq.get(symbol), i = iex.get(symbol), d = sip.get(symbol);
    const best = pickPrice({ nasdaq: q, iex: i, sip: d });
    const day = best ? sessionDate(best.price_at) : null;
    const prior = closeMap.get(symbol);
    // The SIP close service holds the session before today; it applies only to today's prices.
    const close = prior && day === today && prior.session < day ? prior : null;
    return {
      symbol,
      price: best?.price ?? null,
      price_at: best?.price_at ?? null,
      price_source: best?.price_source ?? null,
      price_time_resolution: best?.price_source === 'CONSOLIDATED' ? 'MINUTE_START' : best ? 'EXACT' : null,
      verified_at: best?.price_source === 'CONSOLIDATED' ? best.verified_at : null,
      bid: i?.bid ?? null, ask: i?.ask ?? null, quote_at: i?.quote_at ?? null, quote_source: i ? 'IEX' : null,
      sip_delayed: d ? { price: d.price, price_at: d.at } : null,
      previous_close: close?.close ?? null,
      previous_close_session: close?.session ?? null,
      change_session: close ? day : null,
      change_pct: close && best ? (best.price / close.close - 1) * 100 : null,
      change_basis: close ? 'SIP_SPLIT_ADJUSTED' : 'UNAVAILABLE',
      nasdaq_change_pct: q?.change_pct ?? null,
    };
  }

  function coverage(rows, t) {
    const age = (r) => t - Date.parse(r.price_at);
    return {
      universe: universe.length,
      priced: rows.filter((r) => r.price).length,
      consolidated_confirmed_60s: rows.filter((r) => r.price_source === 'CONSOLIDATED' && t - Date.parse(r.verified_at) <= 60_000).length,
      traded_2m: rows.filter((r) => r.price && ['CONSOLIDATED', 'IEX'].includes(r.price_source) && age(r) <= 120_000).length,
      iex_15s: rows.filter((r) => r.price_source === 'IEX' && age(r) <= 15_000).length,
      delayed_only: rows.filter((r) => r.price_source === 'SIP_DELAYED').length,
      sip_change_basis: rows.filter((r) => r.change_basis === 'SIP_SPLIT_ADJUSTED').length,
      nasdaq_cycle_seconds: stat.nasdaq.cycle_ms ? Math.round(stat.nasdaq.cycle_ms / 1000) : null,
    };
  }

  return {
    /** Board rows for `symbols` (marked as viewed) or, without symbols, for the whole universe. */
    async get(symbols = null) {
      wake();
      if (!universe.length) await Promise.race([ensureUniverse(), new Promise((r) => timers.setTimeout(r, 8000))]);
      const t = now(), list = symbols?.length ? symbols : universe;
      if (symbols) for (const s of symbols) hot.set(s, t + 2 * 60_000);
      const closeMap = closes?.peek(universe.length ? universe : list) ?? new Map();
      const rows = list.map((s) => row(s, closeMap, sessionDate(t)));
      return { schema_version: 1, status: universe.length ? 'OK' : 'WARMING_UP', server_time: iso(t), rows, coverage: coverage(rows, t),
        sources: this.status(), approved_for_live: false, purpose: 'PRICE_OBSERVATION_ONLY' };
    },
    status: () => ({
      consolidated: { source: 'NASDAQ_COM_WATCHLIST', status: stat.nasdaq.status, ok: stat.nasdaq.ok, failed: stat.nasdaq.failed, last_ok_at: stat.nasdaq.last_ok_at, last_error: stat.nasdaq.last_error, cycle_seconds: stat.nasdaq.cycle_ms ? Math.round(stat.nasdaq.cycle_ms / 1000) : null, batch: o.nasdaqBatch, interval_ms: o.nasdaqIntervalMs },
      iex: { source: 'ALPACA_IEX_SNAPSHOTS', status: stat.iex.status, at: stat.iex.at ? iso(stat.iex.at) : null, last_error: stat.iex.last_error },
      sip_delayed: { source: 'ALPACA_SIP_1MIN_16M_DELAY', status: stat.sip.status, at: stat.sip.at ? iso(stat.sip.at) : null, last_error: stat.sip.last_error },
      closes: closes?.status() ?? null,
      running, universe: universe.length, hot: hot.size,
    }),
    tick, // tests
    stop() { running = false; if (timer) timers.clearTimeout(timer); timer = null; },
  };
}

/** Parse the optional `symbols` query (≤ 200, validated); null means the whole board. */
export function parseBoardSymbols(value) {
  if (value === null || value === undefined || value === '') return null;
  const list = [...new Set(String(value).toUpperCase().split(',').map((s) => s.trim()).filter(Boolean))];
  if (!list.length || list.length > 200 || list.some((s) => !SYMBOL.test(s))) throw Error('INVALID_SYMBOLS');
  return list;
}
