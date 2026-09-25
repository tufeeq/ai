// TAGit NEXT workspace controller: wires the data service, state and views.
import { morph, html } from './src/html.js';
import { loadEndpoint, createClient, errorMessage, loadStatic } from './src/api.js';
import * as storage from './src/storage.js';
import {
  createState, applyScan, scanFailed, applyQuotes, nextQuoteSymbols, toggleWatch, removeEvent, visibleRows,
} from './src/state.js';
import { renderList, LIST_NOTES } from './src/views/list.js';
import { renderJournal, JOURNAL_NOTE } from './src/views/journal.js';
import { renderDossier } from './src/views/dossier.js';
import { renderStatus, renderMetrics, renderNotices, coverageText } from './src/views/status.js';
import { renderEvidence } from './src/views/evidence.js';

const SCAN_INTERVAL_MS = 30_000;
const QUOTE_INTERVAL_MS = 5_000;
const SAVE_THROTTLE_MS = 5_000;
const SHEET_BREAKPOINT = 1080;
const STATIC_REFRESH_MS = 30 * 60_000;

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
const JOURNAL_HEAD = html`<span>السهم / بداية الرصد</span><span>الرصد ← آخر عينة</span><span>التغير</span><span>أعلى / أدنى</span>`;

function render() {
  const now = clock();
  const journal = state.ui.view === 'journal';
  morph($('status'), renderStatus(state, now, { scanning }));
  morph($('kpis'), renderMetrics(state, now));
  morph($('notices'), renderNotices(state));

  const list = journal ? renderJournal(state) : renderList(state, now);
  $('list').classList.toggle('is-journal', journal);
  $('list-head').classList.toggle('is-journal', journal);
  morph($('list-head'), journal ? JOURNAL_HEAD : LIST_HEAD);
  morph($('list'), list.markup);
  $('empty').hidden = !list.empty;
  $('empty').textContent = list.empty;
  $('row-count').textContent = journal ? `${list.count} سجلًا` : `${list.count} سهمًا معروضًا`;
  $('list-note').textContent = journal ? JOURNAL_NOTE : LIST_NOTES[state.ui.view];
  $('watch-count').textContent = state.watched.size;
  $('journal-count').textContent = state.journal.length;
  $('max-price').disabled = journal;
  document.querySelectorAll('[data-filter]').forEach((b) => { b.disabled = journal; });

  morph($('dossier'), renderDossier(state, now));
  $('dossier').classList.toggle('is-open', state.ui.sheet);
  document.body.classList.toggle('sheet-open', state.ui.sheet && innerWidth < SHEET_BREAKPOINT);

  const coverage = coverageText(state);
  if (coverage) {
    $('coverage-line').textContent = coverage;
    $('coverage').textContent = coverage;
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
  scanning = true;
  $('refresh').disabled = true;
  scheduleRender();
  try {
    // A cold free-tier server can take close to a minute on the first request.
    const payload = await client.scanner(state.scan ? 30_000 : 90_000);
    const added = applyScan(state, payload, clock());
    persist(added);
    if (!state.ui.selected && innerWidth >= SHEET_BREAKPOINT) {
      state.ui.selected = visibleRows(state, clock()).find((r) => !r.placeholder)?.symbol ?? null;
    }
  } catch (e) {
    scanFailed(state, e.code ?? 'NETWORK');
    if (manual) toast(errorMessage(e.code));
  } finally {
    scanning = false;
    $('refresh').disabled = false;
    scheduleRender();
  }
}

async function quotes() {
  if (quoting || !client || !state.scan || document.hidden) return;
  const symbols = nextQuoteSymbols(state, clock());
  if (!symbols.length) return;
  quoting = true;
  try {
    const result = await client.quotes(symbols);
    const added = applyQuotes(state, result, clock());
    persist(added);
  } catch {
    state.quoteError = true;
  } finally {
    quoting = false;
    scheduleRender();
  }
}

/** Data published by the GitHub Actions jobs: disclosures, the corrected study and the live record. */
async function loadPublished() {
  const [enrichment, relabel, forward] = await Promise.all([
    loadStatic('data/enrichment.json'),
    loadStatic('data/outcome-relabel.json'),
    loadStatic('data/forward-outcomes.json'),
  ]);
  if (enrichment?.symbols) state.enrichment = enrichment;
  state.evidence = { relabel: relabel?.corrected ? relabel : null, forward: forward?.days ? forward : null };
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
  if (remove && removeEvent(state, remove.dataset.removeEvent)) {
    persist(true);
    toast('حُذف السجل.');
    render();
  }
});

$('dossier').addEventListener('input', (e) => {
  if (!['calc-capital', 'calc-risk'].includes(e.target.id)) return;
  const clean = e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
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
$('refresh').addEventListener('click', () => scan({ manual: true }));

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
  else scan();
});
window.addEventListener('pagehide', () => persist(true));
window.addEventListener('resize', () => {
  if (state.ui.sheet && innerWidth >= SHEET_BREAKPOINT) {
    state.ui.sheet = false;
    scheduleRender();
  }
});

// ---- start ----------------------------------------------------------------------------

applyTheme(storage.loadTheme());
render();
loadPublished();
setInterval(loadPublished, STATIC_REFRESH_MS);
try {
  client = createClient(await loadEndpoint());
  await scan();
} catch (e) {
  scanFailed(state, e.code ?? 'CONFIG_UNAVAILABLE');
  render();
}
setInterval(scan, SCAN_INTERVAL_MS);
setInterval(quotes, QUOTE_INTERVAL_MS);
// Checks age with time: re-render every second so freshness and plans expire on screen.
setInterval(() => {
  if (document.hidden) return;
  render();
  persist();
}, 1000);

