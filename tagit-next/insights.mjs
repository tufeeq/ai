// "رؤى السوق" workspace controller: loads data/insights.json on demand and re-renders with the morph.
import { morph } from './src/html.js';
import { normalizeInsights, insightsUrl } from './src/core/insights.js';
import { renderInsights, DEFAULT_INSIGHTS_UI } from './src/views/insights.js';

const RELOAD_MS = 5 * 60_000; // pipeline refreshes every 15–30 min; cheap static file
const TICK_MS = 30_000; // ages and staleness move with time
const panel = document.getElementById('insights-panel');
const store = { phase: 'idle', data: null, error: null, loadedAt: null };
const ui = { ...DEFAULT_INSIGHTS_UI };
let busy = false;

const active = () => location.hash === '#insights';
const render = () => { if (active()) morph(panel, renderInsights(store, ui, Date.now())); };

async function load() {
  if (busy) return;
  busy = true;
  store.phase = 'loading';
  render();
  try {
    const r = await fetch(insightsUrl(Date.now()), { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status === 404 ? 'الملف غير منشور بعد' : `HTTP ${r.status}`);
    const data = normalizeInsights(await r.json());
    if (!data) throw new Error('صيغة غير متوقعة');
    Object.assign(store, { phase: 'ok', data, error: null, loadedAt: Date.now() });
  } catch (e) {
    Object.assign(store, { phase: 'error', error: e instanceof SyntaxError ? 'ملف غير صالح' : e.message || 'تعذر الاتصال' });
  } finally {
    busy = false;
    render();
  }
}

function show() {
  if (!active()) return;
  if (!store.loadedAt || Date.now() - store.loadedAt > RELOAD_MS) load();
  else render();
}

panel.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.hasAttribute('data-insights-refresh')) return load();
  if (t.dataset.sectorSort) ui.sectorSort = t.dataset.sectorSort;
  else if (t.dataset.movers) ui.movers = t.dataset.movers;
  else if (t.hasAttribute('data-news-more')) ui.newsAll = !ui.newsAll;
  else if (t.hasAttribute('data-news-clear')) Object.assign(ui, { sector: '', industry: '', symbol: '' });
  else if (t.dataset.newsSymbol || t.dataset.newsIndustry || t.dataset.newsSector) {
    Object.assign(ui, { sector: t.dataset.newsSector ?? '', industry: t.dataset.newsIndustry ?? '', symbol: t.dataset.newsSymbol ?? '' });
    render();
    document.getElementById('ins-news')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  } else return;
  render();
});
const onFilter = (e) => {
  const key = e.target.dataset?.newsFilter;
  if (!key) return;
  ui[key] = e.target.value;
  render();
};
panel.addEventListener('input', onFilter);
panel.addEventListener('change', onFilter);

window.addEventListener('hashchange', show);
document.addEventListener('visibilitychange', () => { if (!document.hidden) show(); });
setInterval(() => { if (!document.hidden) show(); }, TICK_MS);
show();
