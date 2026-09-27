// Market insights (data/insights.json, schema 1): validation, per-section freshness and news filtering.
// Pure functions; the file is produced by pipeline/insights.* on GitHub Actions (see INSIGHTS-BRIEF.md).
import { finite, elapsed } from './util.js';

export const INSIGHTS_PATH = 'data/insights.json';

/** Accepts only schema 1 objects; anything else is treated as missing, never guessed. */
export function normalizeInsights(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.schema_version !== 1) return null;
  if (!Number.isFinite(Date.parse(body.generated_at))) return null;
  return body;
}

/** Cache-busting URL, stable within one minute so several tabs share the CDN copy. */
export const insightsUrl = (now) => `${INSIGHTS_PATH}?t=${Math.floor(now / 60_000)}`;

const nyFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** True on weekdays 08:00–20:30 New York, when the pipeline refreshes every 15–30 minutes. */
export function refreshWindow(now) {
  const parts = Object.fromEntries(nyFormat.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 8 * 60 && minutes < 20 * 60 + 30;
}

export const STALE_OPEN_MS = 90 * 60_000;
export const STALE_OFF_MS = 84 * 3600_000; // Friday after-close run still valid on Monday pre-market
const FUTURE_TOLERANCE_MS = 5 * 60_000;

export const STALE_CALENDAR_MS = 18 * 3600_000; // the day's calendar is fetched once in the morning

/** Freshness of one section: ok | stale | invalid (time in the future or unparsable). */
export function freshnessOf(asOf, now, key = '') {
  const ms = elapsed(asOf, now);
  if (!Number.isFinite(ms) || ms < -FUTURE_TOLERANCE_MS) return { level: 'invalid', ms: null };
  const limit = key === 'calendar'
    ? (refreshWindow(now) ? STALE_CALENDAR_MS : STALE_OFF_MS)
    : refreshWindow(now) ? STALE_OPEN_MS : STALE_OFF_MS;
  return { level: ms > limit ? 'stale' : 'ok', ms: Math.max(0, ms) };
}

const TOP_LEVEL_AS_OF = { sectors: 'sectors_as_of', trends: 'trends_as_of', news: 'news_as_of', themes: 'themes_as_of' };

/** Section as_of: its own when present, else the top-level `<key>_as_of`, else generated_at. */
export function sectionAsOf(data, key) {
  const own = data?.[key] && !Array.isArray(data[key]) ? data[key].as_of : null;
  return own ?? data?.[TOP_LEVEL_AS_OF[key]] ?? data?.generated_at ?? null;
}

/** Source attribution per section, matched by name so the pipeline can rename freely. */
const SOURCE_HINTS = {
  pulse: /bars|sip|alpaca(?!.*news)/i,
  breadth: /finviz|universe/i,
  sectors: /finviz|universe/i,
  industries: /finviz|universe/i,
  movers: /finviz|universe/i,
  news: /news|benzinga/i,
  themes: /news|benzinga/i,
  calendar: /calendar|nasdaq/i,
};
export function sourceFor(data, key) {
  const hint = SOURCE_HINTS[key];
  const sources = Array.isArray(data?.sources) ? data.sources : [];
  return (hint && sources.find((s) => typeof s?.name === 'string' && hint.test(s.name))) || null;
}

export const list = (v) => (Array.isArray(v) ? v : []);

const uniqueSorted = (values) => [...new Set(values.filter((v) => typeof v === 'string' && v))].sort((a, b) => a.localeCompare(b));

/** Filter options present in the news feed itself. */
export function newsFacets(news) {
  const items = list(news);
  return {
    sectors: uniqueSorted(items.flatMap((n) => list(n.sectors))),
    industries: uniqueSorted(items.flatMap((n) => list(n.industries))),
  };
}

/** News newest first, filtered by sector, industry and symbol (prefix, case-insensitive). */
export function filterNews(news, { sector = '', industry = '', symbol = '' } = {}) {
  const sym = String(symbol).trim().toUpperCase();
  return list(news)
    .filter((n) => n && typeof n.headline === 'string')
    .filter((n) => !sector || list(n.sectors).includes(sector))
    .filter((n) => !industry || list(n.industries).includes(industry))
    .filter((n) => !sym || list(n.symbols).some((s) => String(s).toUpperCase().startsWith(sym)))
    .sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
}

export const SECTOR_SORTS = {
  chg: { label: 'اليوم (مرجّح)', key: 'chg_1d_pct' },
  median: { label: 'الوسيط', key: 'median_chg_pct' },
  breadth: { label: 'الاتساع', key: 'breadth_pct_up' },
  etf5: { label: 'ETF ٥ أيام', key: 'etf_chg_5d_pct' },
  etf1m: { label: 'ETF شهر', key: 'etf_chg_1m_pct' },
};

/** Sectors ranked by the chosen metric; unknown (null) values sink to the bottom. */
export function sortSectors(sectors, sort = 'chg') {
  const key = (SECTOR_SORTS[sort] ?? SECTOR_SORTS.chg).key;
  return [...list(sectors)].sort((a, b) => {
    const x = a?.[key], y = b?.[key];
    if (!finite(x)) return finite(y) ? 1 : 0;
    if (!finite(y)) return -1;
    return y - x;
  });
}

/** Largest absolute value, for a shared symmetric bar scale (never zero). */
export function maxAbs(values, floor = 0.5) {
  return Math.max(floor, ...values.filter(finite).map(Math.abs));
}
