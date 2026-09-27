// Price provenance and timeliness. Every displayed price carries its source and age, and a price
// that is not current is never presented as current: callers use `current` to decide styling and
// whether a live check can pass.
import { positive, elapsed } from './util.js';

/** Sources a row price can come from. */
export const SOURCES = {
  IEX: { short: 'IEX', label: 'IEX · بورصة واحدة', liveMs: 15_000 },
  // Nasdaq.com consolidated last sale; its trade time has minute resolution (start of the minute).
  CONSOLIDATED: { short: 'مجمّع', label: 'مجمّع · ناسداك (لحظي)', liveMs: 120_000 },
  // Alpaca SIP minute bars, at least 16 minutes old on the free plan.
  SIP_DELAYED: { short: 'مجمّع متأخر', label: 'مجمّع متأخر ≥ ١٦ د', liveMs: 0 },
};

/** A consolidated source that re-checked the last sale within this window vouches for it. */
export const VERIFIED_MS = 45_000;
export const AGING_MS = 60_000;

/**
 * Quality of a row's price at `now`:
 *   live     — traded recently on a real-time source;
 *   quiet    — a real-time consolidated source confirmed recently that this is still the last sale;
 *   aging    — just past the live window;
 *   stale    — old; shown only with its age;
 *   delayed  — from delayed consolidated bars; context only;
 *   none     — no valid price.
 * `current` is true only for live and quiet.
 */
export function priceQuality(row, now) {
  const source = SOURCES[row?.price_source] ? row.price_source : 'IEX';
  const spec = SOURCES[source];
  const age = elapsed(row?.price_at, now);
  if (!positive(row?.price) || !Number.isFinite(age) || age < 0) {
    return { level: 'none', current: false, source: row?.price_source ?? null, label: 'لا سعر صالح', ageMs: null };
  }
  const base = { source, sourceShort: spec.short, sourceLabel: spec.label, ageMs: age };
  if (source === 'SIP_DELAYED') return { ...base, level: 'delayed', current: false, label: 'متأخر — ليس سعرًا حاليًا' };
  if (age <= spec.liveMs) return { ...base, level: 'live', current: true, label: 'حديث' };
  const verified = elapsed(row.verified_at, now);
  if (source === 'CONSOLIDATED' && verified >= 0 && verified <= VERIFIED_MS) {
    return { ...base, level: 'quiet', current: true, label: 'آخر صفقة مؤكدة؛ لا تداول منذها', verifiedMs: verified };
  }
  if (age <= spec.liveMs + AGING_MS) return { ...base, level: 'aging', current: false, label: 'يتقادم' };
  return { ...base, level: 'stale', current: false, label: 'قديم — ليس سعرًا حاليًا' };
}
