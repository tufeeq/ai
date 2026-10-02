// TAGit NEXT workspace controller: wires the data service, state and views.
import { morph, html } from './src/html.js';
import { loadEndpoint, createClient, errorMessage, loadStatic } from './src/api.js';
import * as storage from './src/storage.js';
import {
  createState, applyScan, scanFailed, applyQuotes, nextQuoteSymbols, toggleWatch, removeEvent, displayOrder,
} from './src/state.js';
import { renderList, LIST_NOTES } from './src/views/list.js';
import { renderJournal, JOURNAL_NOTE } from './src/views/journal.js';
import { renderDossier } from './src/views/dossier.js';
import { renderStatus, renderMetrics, renderNotices, coverageText } from './src/views/status.js';
import { renderEvidence } from './src/views/evidence.js';
import { renderSipList, SIP_NOTE } from './src/views/sip.js';
import { renderPulseList, PULSE_NOTE } from './src/views/pulse.js';
import { sipScan } from './src/core/sipscan.js';
import { sipUniverse, applyCloses, applyLive, applySipDelayed, liveSymbols, pulseToday } from './src/state.js';
import { fetchCloses } from './src/core/closes.js';
import { marketDate } from './src/core/market.js';
import { createGate, breaker } from './src/backoff.js';
import { cleanAmount } from './src/core/sizing.js';

const SCAN_INTERVAL_MS = 30_000;
const QUOTE_INTERVAL_MS = 5_000;
const SAVE_THROTTLE_MS = 5_000;
const SHEET_BREAKPOINT = 1080;
const STATIC_REFRESH_MS = 30 * 60_000;
const SIP_INTERVAL_MS = 5 * 60_000; // relay windows move in 5-minute buckets
const LIVE_INTERVAL_MS = 10_000; // consolidated live board, when the service has it
const LIVE_RETRY_MS = 10 * 60_000; // re-probe a service without /api/live (manual redeploys)
const CLOSES_INTERVAL_MS = 30 * 60_000;
const PULSE_INTERVAL_MS = 30_000; // server's real-time consolidated signal ledger

// ---- retry pacing (resilience) ------------------------------------------------------
// Failed polls back off (2×, 4× … capped) instead of hammering a cold or failing free server;
// a success, a manual refresh, a returning tab or a restored network resets them.
const gates = {
  scan: createGate(SCAN_INTERVAL_MS, 4 * 60_000),
  quotes: createGate(QUOTE_INTERVAL_MS, 60_000),
  live: createGate(LIVE_INTERVAL_MS, 2 * 60_000),
};
let retryTimer = 0;
const resetGates = () => {
  clearTimeout(retryTimer);
  Object.values(gates).forEach((g) => g.reset());
};

const $ = (id) => document.getElementById(id);
const clock = () => Date.now();

const saved = storage.loadJournal();
const state = createState({ journal: saved.events, watched: saved.watched, settings: storage.loadSettings() });
let client = null;
let scanning = false;
let quoting = false;
let lastSave = 0;
let toastTimer = 0;

// ---- persistence -----------------------------------------------------------------

function persist(force = false) {
  if (!force && (!state.dirty || clock() - lastSave < SAVE_THROTTLE_MS)) return;
  state.dirty = false;
  state.storageOk = storage.saveJournal(state.journal, state.watched, clock());
  lastSave = clock();
}

// ---- rendering --------------------------------------------------------------------

const LIST_HEAD = html`<span>السهم</span><span>السعر / اليوم</span><span>الشروط</span><span>حجم ٣ د</span><span>الحالة</span><span>عمر الصفقة</span>`;
const SIP_HEAD = html`<span>السهم</span><span>سعر الرصد / الوقت</span><span>صعود ٣ د · حجم</span><span>موقع السعر الآن</span>`;
const JOURNAL_HEAD = html`<span>السهم / بداية الرصد</span><span>الرصد ← آخر عينة</span><span>التغير</span><span>أعلى / أدنى</span>`;

function render() {
  const now = clock();
  const journal = state.ui.view === 'journal';
  morph($('status'), renderStatus(state, now, { scanning }));
  morph($('kpis'), renderMetrics(state, now));
  morph($('notices'), renderNotices(state, now));

  const sip = state.ui.view === 'sip';
  // The consolidated tab shows the server's real-time signals when the service has them, else the delayed SIP scan.
  const pulseTab = sip && state.pulse.supported === true;
  const list = journal ? renderJournal(state) : pulseTab ? renderPulseList(state, now) : sip ? renderSipList(state, now) : renderList(state, now);
  $('list').classList.toggle('is-journal', journal);
  $('list-head').classList.toggle('is-journal', journal);
  $('list').classList.toggle('is-sip', sip);
  $('list-head').classList.toggle('is-sip', sip);
  morph($('list-head'), journal ? JOURNAL_HEAD : sip ? SIP_HEAD : LIST_HEAD);
  // The empty message goes inside the list: below it, the list's minimum height pushed the
  // message out of view and an empty scan looked like a blank, broken page.
  morph($('list'), list.empty ? html`<li class="empty" data-key="empty" role="status">${list.empty}</li>` : list.markup);
  $('empty').hidden = true;
  $('row-count').textContent = journal ? `${list.count} سجلًا` : sip ? `${list.count} إشارة` : `${list.count} سهمًا معروضًا`;
  $('list-note').textContent = journal ? JOURNAL_NOTE : pulseTab ? PULSE_NOTE : sip ? SIP_NOTE : LIST_NOTES[state.ui.view];
  $('sip-count').textContent = state.pulse.supported === true ? pulseToday(state, now).length
    : state.sip.result ? state.sip.result.signals.length : state.sip.phase === 'error' ? '!' : '…';
  $('watch-count').textContent = state.watched.size;
  $('journal-count').textContent = state.journal.length;
  $('max-price').disabled = journal || sip;
  document.querySelectorAll('[data-filter]').forEach((b) => { b.disabled = journal || sip; });

  morph($('dossier'), renderDossier(state, now));
  $('dossier').classList.toggle('is-open', state.ui.sheet);
  document.body.classList.toggle('sheet-open', state.ui.sheet && innerWidth < SHEET_BREAKPOINT);
  modalSheet(state.ui.sheet && innerWidth < SHEET_BREAKPOINT);

  const coverage = coverageText(state);
  if (coverage) {
    $('coverage-line').textContent = coverage;
    $('coverage').textContent = coverage;
  }
}

/** Phone sheet: a modal dialog; the page behind it is inert so focus and screen readers stay inside. */
const BEHIND_SHEET = ['.skip', '.topbar', '.intro', '#kpis', '#notices', '.board', '.method', '.site-foot'];
function modalSheet(open) {
  const d = $('dossier');
  if (open === d.hasAttribute('aria-modal')) return;
  for (const sel of BEHIND_SHEET) document.querySelector(sel)?.toggleAttribute('inert', open);
  if (open) {
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
  } else {
    d.removeAttribute('role');
    d.removeAttribute('aria-modal');
  }
}

let frame = 0;
const scheduleRender = () => {
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); });
};

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---- data -------------------------------------------------------------------------

async function scan({ manual = false } = {}) {
  if (scanning || !client || (document.hidden && !manual)) return;
  if (!manual && !gates.scan.ready(clock())) return;
  scanning = true;
  $('refresh').disabled = true;
  scheduleRender();
  try {
    // A cold free-tier server can take close to a minute on the first request.
    const payload = await client.scanner(state.scan ? 30_000 : 90_000);
    const added = applyScan(state, payload, clock());
    resetGates();
    state.retryAt = 0;
    persist(added);
    if (!state.ui.selected && innerWidth >= SHEET_BREAKPOINT) {
      // The first row the list shows (not the first of the unsorted tiers, which could be a halt).
      state.ui.selected = displayOrder(state, clock()).find((r) => !r.placeholder)?.symbol ?? null;
    }
  } catch (e) {
    scanFailed(state, e.code ?? 'NETWORK');
    state.retryAt = gates.scan.fail(clock());
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => scan(), state.retryAt - clock() + 50); // retry when announced, not at the next 30 s tick
    if (manual) toast(errorMessage(e.code));
  } finally {
    scanning = false;
    $('refresh').disabled = false;
    scheduleRender();
  }
}

let sipBusy = false;
/** Consolidated scan through the relay; every viewer requests the same 5-minute-aligned windows. */
async function runSip() {
  if (sipBusy || !client || document.hidden) return;
  const symbols = sipUniverse(state);
  if (!symbols.length) return;
  sipBusy = true;
  state.sip = { ...state.sip, phase: 'loading' };
  scheduleRender();
  try {
    const result = await sipScan({ getJson: breaker((url) => client.relay(url)), service: state.endpoint, symbols, now: clock() });
    if (!result.with_bars && result.failed) throw new Error('تعذر الوصول إلى بيانات SIP');
    state.sip = { phase: 'ok', result, error: null };
    applySipDelayed(state, result.last, clock());
  } catch (e) {
    state.sip = { ...state.sip, phase: 'error', error: e.message };
  } finally {
    sipBusy = false;
    scheduleRender();
  }
}

let closesBusy = false;
/** Consolidated split-adjusted previous closes for every symbol the page can show (once per day). */
async function loadCloses() {
  if (closesBusy || !client || document.hidden) return;
  const symbols = [...new Set([...sipUniverse(state), ...(state.scan?.order ?? []), ...state.watched])];
  if (!symbols.length) return;
  const today = marketDate(clock());
  if (!state.closes) {
    const saved = storage.loadCloses(today);
    if (saved) applyCloses(state, saved);
  }
  const fresh = state.closes && state.closes.day === today && state.closes.symbols >= symbols.length && !state.closes.failed;
  if (fresh) return;
  closesBusy = true;
  try {
    const closes = await fetchCloses({ getJson: breaker((url) => client.relay(url)), service: state.endpoint, symbols, now: clock() });
    if (closes.map.size) {
      applyCloses(state, closes);
      if (!closes.failed) storage.saveCloses(closes);
    }
  } catch {
    // Rows keep the service's own reference close and are marked as not consolidated.
  } finally {
    closesBusy = false;
    scheduleRender();
  }
}

let liveBusy = false;
/** Consolidated live board. Absent on an older service (404): retried every ten minutes. */
async function live() {
  if (liveBusy || !client || !state.scan || document.hidden) return;
  if (state.live.supported === false && clock() - (state.live.checkedAt ?? 0) < LIVE_RETRY_MS) return;
  if (!gates.live.ready(clock())) return;
  liveBusy = true;
  try {
    const result = await client.live(liveSymbols(state, clock()));
    applyLive(state, result, clock());
    gates.live.ok();
  } catch (e) {
    if (e.code !== 'NOT_SUPPORTED') gates.live.fail(clock());
    state.live = e.code === 'NOT_SUPPORTED'
      ? { ...state.live, supported: false, checkedAt: clock(), error: null }
      : { ...state.live, error: e.code ?? 'NETWORK' };
  } finally {
    liveBusy = false;
    scheduleRender();
  }
}

async function quotes() {
  if (quoting || !client || !state.scan || document.hidden) return;
  if (!gates.quotes.ready(clock())) return;
  const symbols = nextQuoteSymbols(state, clock());
  if (!symbols.length) return;
  quoting = true;
  try {
    const result = await client.quotes(symbols);
    const added = applyQuotes(state, result, clock());
    gates.quotes.ok();
    persist(added);
  } catch {
    state.quoteError = true;
    gates.quotes.fail(clock());
  } finally {
    quoting = false;
    scheduleRender();
  }
}

/** Data published by the GitHub Actions jobs: disclosures, the corrected study and the live record. */
async function loadPublished() {
  const [enrichment, relabel, forward, sip, exits, filters, daily, paper, fade, fadeFlags, catalysts] = await Promise.all([
    loadStatic('data/enrichment.json'),
    loadStatic('data/outcome-relabel.json'),
    loadStatic('data/forward-outcomes.json'),
    loadStatic('data/sip-outcomes.json'),
    loadStatic('data/exit-study.json'),
    loadStatic('data/filter-study.json'),
    loadStatic('data/daily-study.json'),
    loadStatic('data/paper-ledger.json'),
    loadStatic('data/fade-study.json'),
    loadStatic('data/fade-flags.json'),
    loadStatic('data/catalyst-calendar.json'),
  ]);
  if (enrichment?.symbols) state.enrichment = enrichment;
  if (fadeFlags?.symbols) state.fadeFlags = fadeFlags;
  if (catalysts?.earnings || catalysts?.fda) state.catalysts = catalysts;
  state.evidence = { relabel: relabel?.corrected ? relabel : null, forward: forward?.days ? forward : null, sip: sip?.totals ? sip : null, exits: exits?.development ? exits : null, filters: filters?.baseline ? filters : null, daily: daily?.table ? daily : null, paper: paper?.books ? paper : null, fade: fade?.short?.reference ? fade : null };
  // The first consolidated scan may have used only the scanner rows; widen it to the full universe.
  if (client && (state.sip.result?.symbols ?? 0) < sipUniverse(state).length) runSip();
  if (client) loadCloses();
  morph($('evidence'), renderEvidence(state.evidence));
  scheduleRender();
}

// ---- interactions -------------------------------------------------------------------

function select(symbol, { tab } = {}) {
  state.ui.selected = symbol;
  if (tab) state.ui.tab = tab;
  state.ui.sheet = innerWidth < SHEET_BREAKPOINT;
  render();
  if (!state.ui.sheet) return;
  $('dossier').scrollTop = 0;
  $('dossier').querySelector('.sheet-close')?.focus({ preventScroll: true });
}

function closeSheet() {
  const symbol = state.ui.selected;
  state.ui.sheet = false;
  render();
  document.querySelector(`#list [data-symbol="${CSS.escape(symbol ?? '')}"]`)?.focus({ preventScroll: true });
}

function setView(view) {
  state.ui.view = view;
  document.querySelectorAll('[data-view]').forEach((b) => {
    const active = b.dataset.view === view;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', String(active));
  });
  render();
}

function setFilter(filter) {
  state.ui.filter = filter;
  document.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
  render();
}

$('list').addEventListener('click', (e) => {
  const row = e.target.closest('[data-symbol]');
  if (row) select(row.dataset.symbol, row.dataset.event ? { tab: 'history' } : {});
});

// Arrow keys move through the list; the dossier follows the focused row.
$('list').addEventListener('keydown', (e) => {
  if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
  const rows = [...$('list').querySelectorAll('[data-symbol]')];
  const index = rows.indexOf(document.activeElement);
  const next = rows[Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (!next) return;
  e.preventDefault();
  next.focus();
  if (innerWidth >= SHEET_BREAKPOINT) select(next.dataset.symbol);
});

$('dossier').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    state.ui.tab = tab.dataset.tab;
    render();
    return;
  }
  if (e.target.closest('[data-close-sheet]')) {
    closeSheet();
    return;
  }
  const watch = e.target.closest('[data-watch]');
  if (watch) {
    const result = toggleWatch(state, watch.dataset.watch, clock());
    toast({
      removed: 'أزيل من المتابعة؛ سجله السابق محفوظ.',
      full: 'حد قائمة المتابعة ٥٠ سهمًا.',
      recording: 'أضيف للمتابعة وبدأ الرصد من السعر الحالي.',
      added: 'أضيف للمتابعة؛ يبدأ الرصد عند وصول صفقة حديثة.',
    }[result]);
    persist(true);
    render();
    return;
  }
  const remove = e.target.closest('[data-remove-event]');
  const removed = remove ? removeEvent(state, remove.dataset.removeEvent, clock()) : false;
  if (removed) {
    persist(true);
    toast(removed === 'unwatched' ? 'حُذف السجل وأزيل السهم من المتابعة، حتى لا يُعاد تسجيله اليوم بسعر جديد.' : 'حُذف السجل.');
    render();
  }
});

$('dossier').addEventListener('input', (e) => {
  if (!['calc-capital', 'calc-risk', 'calc-commission'].includes(e.target.id)) return;
  const clean = cleanAmount(e.target.value);
  if (clean !== e.target.value) e.target.value = clean;
  state.settings = { ...state.settings, [e.target.name]: clean };
  storage.saveSettings(state.settings);
  render();
});
$('dossier').addEventListener('submit', (e) => e.preventDefault());

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.filter)));
$('search').addEventListener('input', (e) => { state.ui.search = e.target.value; render(); });
$('max-price').addEventListener('change', (e) => {
  const v = Number(e.target.value);
  state.ui.maxPrice = e.target.value && v > 0 ? v : Infinity;
  render();
});
$('refresh').addEventListener('click', () => { resetGates(); scan({ manual: true }); });

document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (e.key === '/' && !typing) {
    e.preventDefault();
    $('search').focus();
  } else if (e.key === 'Escape') {
    if (state.ui.sheet) closeSheet();
    else if (document.activeElement === $('search') && $('search').value) {
      $('search').value = '';
      state.ui.search = '';
      render();
    }
  }
});

function applyTheme(theme) {
  document.body.classList.toggle('dark', theme === 'dark');
  document.documentElement.dataset.theme = theme;
}
$('theme').addEventListener('click', () => {
  const next = document.body.classList.contains('dark') ? 'light' : 'dark';
  applyTheme(next);
  storage.saveTheme(next);
});

$('export').addEventListener('click', () => {
  const now = clock();
  const blob = new Blob([JSON.stringify({
    schema: 1,
    exported_at: new Date(now).toISOString(),
    description: 'Observed prices only. Not executed trades; gaps while the page was closed.',
    watch: [...state.watched],
    events: state.journal,
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TAGit-observations-${new Date(now).toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('جُهّز سجل المتابعة للتنزيل.');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) persist(true);
  else {
    resetGates();
    scan();
  }
});
// Network changes on phones: say so at once, and resume as soon as the connection returns.
state.offline = navigator.onLine === false;
window.addEventListener('offline', () => { state.offline = true; scheduleRender(); });
window.addEventListener('online', () => {
  state.offline = false;
  resetGates();
  scan();
  quotes();
  scheduleRender();
});
window.addEventListener('pagehide', () => persist(true));
window.addEventListener('resize', () => {
  if (state.ui.sheet && innerWidth >= SHEET_BREAKPOINT) {
    state.ui.sheet = false;
    scheduleRender();
  }
});

// Links from other workspaces (e.g. رؤى السوق) open a stock's dossier: #market/SYMBOL.
function openFromHash() {
  const m = /^#market\/([A-Z][A-Z0-9.-]{0,9})$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', '#market');
  scrollTo({ top: 0 });
  select(m[1]);
}
window.addEventListener('hashchange', openFromHash);

// ---- start ----------------------------------------------------------------------------

applyTheme(storage.loadTheme());
render();
openFromHash();
loadPublished();
let pulseBusy = false;
/** Real-time consolidated signal ledger from the server (absent on older services: 404, retried). */
async function pulse() {
  if (pulseBusy || !client || document.hidden) return;
  if (state.pulse.supported === false && clock() - (state.pulse.checkedAt ?? 0) < LIVE_RETRY_MS) return;
  pulseBusy = true;
  try {
    const r = await client.pulse();
    state.pulse = { supported: true, status: r.status, ledger: r.ledger, at: r.server_time, error: null };
  } catch (e) {
    state.pulse = e.code === 'NOT_SUPPORTED'
      ? { ...state.pulse, supported: false, checkedAt: clock(), error: null }
      : { ...state.pulse, error: e.code ?? 'NETWORK' };
  } finally {
    pulseBusy = false;
    scheduleRender();
  }
}

setInterval(loadPublished, STATIC_REFRESH_MS);
try {
  state.endpoint = await loadEndpoint();
  client = createClient(state.endpoint);
  await scan();
  runSip();
  loadCloses();
  live();
  pulse();
} catch (e) {
  scanFailed(state, e.code ?? 'CONFIG_UNAVAILABLE');
  render();
}
setInterval(scan, SCAN_INTERVAL_MS);
setInterval(quotes, QUOTE_INTERVAL_MS);
setInterval(runSip, SIP_INTERVAL_MS);
setInterval(live, LIVE_INTERVAL_MS);
setInterval(pulse, PULSE_INTERVAL_MS);
setInterval(loadCloses, CLOSES_INTERVAL_MS);
// Checks age with time: re-render every second so freshness and plans expire on screen.
setInterval(() => {
  if (document.hidden) return;
  render();
  persist();
}, 1000);

