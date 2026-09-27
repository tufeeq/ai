// Device-local persistence. Every access is guarded: private windows and
// blocked storage must never break the page.
import { restoreJournal, JOURNAL_LIMIT } from './core/journal.js';
import { isSymbol } from './core/util.js';

export const JOURNAL_KEY = 'tagit-next-journal-v1';
const SETTINGS_KEY = 'tagit-next-settings-v2';
const THEME_KEY = 'tagit-theme';
export const WATCH_LIMIT = 50;

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadJournal() {
  const saved = read(JOURNAL_KEY);
  return {
    events: restoreJournal(saved),
    watched: new Set((Array.isArray(saved?.watch) ? saved.watch : []).filter(isSymbol).slice(0, WATCH_LIMIT)),
  };
}

export function saveJournal(events, watched, now) {
  return write(JOURNAL_KEY, {
    schema: 1, updated_at: new Date(now).toISOString(), watch: [...watched], events: events.slice(-JOURNAL_LIMIT),
  });
}

/** Calculator inputs are the user's own limits, shared across symbols. */
export function loadSettings() {
  const s = read(SETTINGS_KEY) ?? {};
  const amount = (v) => (typeof v === 'string' && /^\d*\.?\d*$/.test(v) ? v : '');
  return { capital: amount(s.capital), risk: amount(s.risk) };
}
export const saveSettings = (settings) => write(SETTINGS_KEY, settings);

const CLOSES_KEY = 'tagit-next-closes-v1';

/** Consolidated closes fetched today, so a reload does not refetch them through the shared relay. */
export function loadCloses(day) {
  const saved = read(CLOSES_KEY);
  if (saved?.day !== day || !saved.closes || typeof saved.closes !== 'object') return null;
  const map = new Map();
  for (const [s, list] of Object.entries(saved.closes)) {
    if (!isSymbol(s) || !Array.isArray(list)) continue;
    const clean = list.filter((x) => typeof x?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.day) && x.close > 0);
    if (clean.length) map.set(s, clean);
  }
  return map.size ? { day, fetched_at: saved.fetched_at, map, symbols: saved.symbols ?? map.size, failed: 0 } : null;
}

export function saveCloses(closes) {
  const out = {};
  for (const [s, list] of closes.map) out[s] = list.slice(-3);
  return write(CLOSES_KEY, { day: closes.day, fetched_at: closes.fetched_at, symbols: closes.symbols, closes: out });
}

export function loadTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'dark' || t === 'light') return t;
  } catch { /* fall through to system preference */ }
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* theme still applies for this visit */ }
}
