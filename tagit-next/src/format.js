// Display formatting. Latin digits for prices; all times in New York.
import { finite, positive, elapsed } from './core/util.js';

const numberFormats = new Map();
function numberFormat(digits) {
  if (!numberFormats.has(digits)) {
    numberFormats.set(digits, new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return numberFormats.get(digits);
}
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const dateTimeFormat = new Intl.DateTimeFormat('ar', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  numberingSystem: 'latn', hourCycle: 'h23',
});

export const DASH = '—';

export const num = (v, digits = 2) => (finite(v) ? numberFormat(digits).format(v) : DASH);
/** Sub-dollar prices keep four decimals so small caps stay readable. */
export const price = (v) => (finite(v) ? num(v, positive(v) && v < 1 ? 4 : 2) : DASH);
export const usd = (v) => (finite(v) ? `$${price(v)}` : DASH);
export const pct = (v, digits = 2) => (finite(v) ? `${v > 0 ? '+' : ''}${num(v, digits)}%` : DASH);
export const compactUsd = (v) => (finite(v) ? `$${compactFormat.format(v)}` : DASH);
export const compact = (v) => (finite(v) ? compactFormat.format(v) : DASH);
export const tone = (v) => (finite(v) ? (v > 0 ? 'up' : v < 0 ? 'down' : 'flat') : '');

const valid = (t) => Number.isFinite(Date.parse(t));
export const time = (t) => (valid(t) ? timeFormat.format(new Date(t)) : DASH);
export const dateTime = (t) => (valid(t) ? dateTimeFormat.format(new Date(t)) : DASH);

/** Short relative age ("12 ث", "4 د", "2 س"). */
export function age(at, now) {
  const ms = elapsed(at, now);
  if (!Number.isFinite(ms)) return 'غير متاح';
  if (ms < 0) return 'وقت غير صالح';
  const s = ms / 1000;
  if (s < 60) return `${Math.floor(s)} ث`;
  if (s < 3600) return `${Math.floor(s / 60)} د`;
  if (s < 86400) return `${Math.floor(s / 3600)} س`;
  return `${Math.floor(s / 86400)} ي`;
}

/** Freshness bucket for a colored dot: live ≤ 15s, aging ≤ 60s, stale otherwise. */
export function freshness(at, now, source = 'IEX') {
  const ms = elapsed(at, now);
  if (!Number.isFinite(ms) || ms < 0) return 'none';
  const live = source === 'CONSOLIDATED' ? 120_000 : 15_000; // consolidated times are minute starts
  return ms <= live ? 'live' : ms <= live + 60_000 ? 'aging' : 'stale';
}
