// Small numeric and time helpers shared by every core module.

export const finite = (x) => typeof x === 'number' && Number.isFinite(x);
export const positive = (x) => finite(x) && x > 0;

/** Milliseconds from `at` (ISO string) until `now`; Infinity when `at` is not a valid time. */
export function elapsed(at, now) {
  const t = Date.parse(at);
  return Number.isFinite(t) ? now - t : Infinity;
}

/** True when `at` is not in the future relative to `now` and is at most `maxMs` old. */
export const within = (at, now, maxMs) => {
  const age = elapsed(at, now);
  return age >= 0 && age <= maxMs;
};

export const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;
export const isSymbol = (s) => typeof s === 'string' && SYMBOL_PATTERN.test(s);
