// "Extended move" warning from fade-study-1 (the long-side "don't buy" flag).
//
// Evidence (tagit-next/data/fade-study.json, run 36309647828): on the untouched 2018–2022 holdout,
// buying a flagged stock at the next open and selling 5 sessions later earned −1.20% net vs −0.16%
// for every other eligible Nasdaq stock-day (difference −1.04 pp, 95% CI [−1.72, −0.31]). It is a
// warning, not a signal: in 2023-01 → 2025-06 the sign was reversed, and shorting the same names
// did NOT pay after costs and borrow. Rules are identical to pipeline/daily_study.mjs (daily-study-1)
// plus spike_50; bars are daily {d, o, h, l, c, v}, oldest first, all completed sessions.
import { finite } from './util.js';

export const FADE_WINDOW_SESSIONS = 5;

const ret = (b, i) => (b[i].c / b[i - 1].c - 1) * 100;
const rangePos = (x) => (x.h > x.l ? (x.c - x.l) / (x.h - x.l) : 0.5);

/** Point-in-time eligibility of day i: $0.50–$20, 20-day average dollar volume ≥ $300K, 21 prior bars. */
export function eligibleDay(b, i) {
  if (i < 21 || !(b[i].c >= 0.5 && b[i].c <= 20)) return null;
  const avg = b.slice(i - 20, i).reduce((a, x) => a + x.c * x.v, 0) / 20;
  if (!(avg >= 300_000)) return null;
  return { dvolRatio: (b[i].c * b[i].v) / avg };
}

export const EXTENSION_RULES = {
  strong_close: (b, i, ctx) => ret(b, i) >= 20 && rangePos(b[i]) >= 0.9 && ctx.dvolRatio >= 3,
  gap_hold: (b, i) => b[i].o >= b[i - 1].c * 1.10 && b[i].c >= b[i].o && b[i].c >= b[i - 1].c * 1.15,
  momentum_5d: (b, i) => b[i].c >= b[i - 5].c * 1.30 && b[i].c >= 0.95 * Math.max(...b.slice(i - 4, i + 1).map((x) => x.h)),
  spike_50: (b, i, ctx) => ret(b, i) >= 50 && ctx.dvolRatio >= 3,
};

/** Extension events on completed day i (uses bars ≤ i only). */
export function extensionEvents(b, i) {
  const ctx = eligibleDay(b, i);
  if (!ctx) return [];
  return Object.keys(EXTENSION_RULES).filter((k) => EXTENSION_RULES[k](b, i, ctx));
}

export const EVENT_LABELS = {
  strong_close: 'إغلاق قوي ≥ ٢٠٪', gap_hold: 'فجوة صاعدة صامدة', momentum_5d: 'زخم ٥ أيام ≥ ٣٠٪', spike_50: 'قفزة ≥ ٥٠٪',
};

/** Weekdays d with from < d < to (YYYY-MM-DD strings). Holidays are not known here, so a list that
 * missed a holiday is treated as one session older than it is (the flag expires a session early). */
export function weekdaysBetween(from, to) {
  const a = Date.parse(`${from}T12:00:00Z`), b = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  let count = 0;
  for (let t = a + 86_400_000; t < b; t += 86_400_000) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/**
 * Warning for a symbol from the published flag list (data/fade-flags.json). A flag lasts for the
 * FADE_WINDOW_SESSIONS sessions after the event day; `sessions` is the list's recent session dates.
 * `today` (New York date, optional): the list is only refreshed after the close, so when it is older
 * than the last completed session the sessions it has not seen still count toward the window. Without
 * this a list that stopped refreshing kept old flags alive indefinitely (and showed them as current).
 */
export function fadeWarning(flags, symbol, today = null) {
  const hit = flags?.symbols?.[symbol];
  if (!hit || !Array.isArray(hit.events) || !hit.events.length) return null;
  const recent = flags.sessions ?? [];
  const age = recent.indexOf(hit.d);
  if (age < 0) return null; // sessions are newest first
  const asOf = flags.as_of ?? recent[0] ?? null;
  const unseen = today && asOf ? weekdaysBetween(asOf, today) : 0;
  const since = age + unseen;
  if (since >= FADE_WINDOW_SESSIONS) return null;
  return { day: hit.d, events: hit.events, sessions_since: since, close: finite(hit.c) ? hit.c : null, list_as_of: asOf, list_behind: unseen };
}
