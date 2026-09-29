// Evidence page: the current studies (same renderer as the market workspace's methodology section),
// a computed headline, the server journal, and the superseded phase 1/2 records as an archive.
import { comparisonRows, evidenceSummary } from './phase2-view.mjs';
import { renderEvidence } from './src/views/evidence.js';
import { morph, html } from './src/html.js';
import * as storage from './src/storage.js';

const $ = (id) => document.getElementById(id);

function applyTheme(theme) {
  document.body.classList.toggle('dark', theme === 'dark');
  document.documentElement.dataset.theme = theme;
}
applyTheme(storage.loadTheme());
$('theme').addEventListener('click', () => {
  const next = document.body.classList.contains('dark') ? 'light' : 'dark';
  applyTheme(next);
  storage.saveTheme(next);
});

const load = (path) => fetch(path, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

async function studies() {
  const [relabel, forward, sip, exits, filters, daily, paper, fade] = await Promise.all([
    'outcome-relabel', 'forward-outcomes', 'sip-outcomes', 'exit-study', 'filter-study', 'daily-study', 'paper-ledger', 'fade-study',
  ].map((name) => load(`data/${name}.json`)));
  const evidence = {
    relabel: relabel?.corrected ? relabel : null, forward: forward?.days ? forward : null, sip: sip?.totals ? sip : null,
    exits: exits?.development ? exits : null, filters: filters?.baseline ? filters : null, daily: daily?.table ? daily : null,
    paper: paper?.books ? paper : null, fade: fade?.short?.reference ? fade : null,
  };
  morph($('evidence'), renderEvidence(evidence));
  const s = evidenceSummary(evidence);
  morph($('summary'), html`${s.kpis.map((k) => html`<div class="kpi" data-key="kpi-${k.key}"><span>${k.label}</span><strong dir="ltr" class="${k.tone}">${k.value ?? '—'}</strong><small>${k.hint}</small></div>`)}`);
  $('verdict').textContent = s.verdict;
  for (const text of s.held) {
    const p = document.createElement('p');
    p.className = 'notice n-info perf-held';
    p.textContent = `ما صمد: ${text}`;
    $('verdict').after(p);
  }
}
void studies();

// ---- archive: phase 1 / phase 2 (superseded by outcome-relabel-1) ----
(async () => {
  try {
    const e = await load('phase2-evidence.json');
    if (!e) throw Error();
    const rows = comparisonRows(e);
    $('phase2-rows').replaceChildren();
    for (const values of rows) {
      const tr = document.createElement('tr');
      for (const [i, value] of values.entries()) { const td = document.createElement('td'); td.textContent = value; if (i > 0) td.dir = 'ltr'; tr.append(td); }
      $('phase2-rows').append(tr);
    }
    $('phase2-status').textContent = `المصدر: سجل ${e.protocol} بتاريخ ${e.as_of}. جميع الإشارات ${e.full_baseline.signals}؛ المقيمة ${e.full_baseline.evaluable} والناقصة ${e.full_baseline.missing_outcomes}. لم يُعتمد أي فلتر.`;
  } catch { $('phase2-status').textContent = 'تعذر التحقق من سجل مقارنة الميزات؛ لا توجد نتيجة معتمدة لعرضها.'; }
  try {
    const e = await load('phase1-evidence.json');
    if (!e || !Number.isFinite(e.resolved_expectancy_pct) || e.signals !== e.evaluable + e.unevaluable || e.profitability_claim_allowed !== false) throw Error();
    $('baseline').textContent = `المصدر: سجل discovery-1 بتاريخ ${e.as_of}. ${e.signals} إشارة؛ ${e.evaluable} قابلة للتقييم و${e.unevaluable} ناقصة في ذلك الوقت. متوسط الحالات المقيمة ${e.resolved_expectancy_pct.toFixed(2)}٪ بعد تكلفة افتراضية (محسوب على العينة المنحازة؛ استُبدل بالتقييم المصحح).`;
  } catch { $('baseline').textContent = 'تعذر تحميل دليل خط الأساس.'; }
})();

// ---- server journal ----
const names = { TARGET: 'لُمس الهدف في المحاكاة', STOP: 'لُمس الوقف في المحاكاة', TIMEOUT: 'انتهاء المدة', WAITING: 'قيد الرصد', NO_PLAN: 'لا خطة مشروطة', NO_ENTRY: 'لا دخول وفق النموذج', UNKNOWN_EXIT: 'خروج غير محسوم', UNKNOWN_COVERAGE: 'تغطية غير مكتملة', UNKNOWN_ROUND_LOT_SIZE: 'وحدة حجم العرض غير موثقة', SINGLE_EXCHANGE_OR_DELAYED: 'تغطية جزئية أو مؤجلة', INVALIDATED_BEFORE_ENTRY: 'أُلغيت قبل الدخول', INVALID_PLAN_OR_EVENT: 'بيانات غير صالحة' };
let busy = false;
async function refresh() {
  if (busy) return;
  busy = true;
  $('refresh').disabled = true;
  try {
    const c = await fetch('live-config.json', { cache: 'no-cache' }).then((r) => r.json());
    const u = new URL(c.endpoint);
    if (u.protocol !== 'https:' || u.username || u.password) throw Error();
    const r = await fetch(u.origin + '/api/performance', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Error();
    const d = await r.json();
    if (d.source !== 'SERVER_OBSERVATION_JOURNAL') { $('server').textContent = 'السجل الخادمي غير مفعّل على الخدمة الحالية؛ لا يوجد أداء حي موثق لعرضه. متابعة التنبيهات الحية منشورة في «الدراسات الحالية» أعلاه.'; return; }
    $('server').textContent = `حتى ${d.as_of}: ${d.signals} إشارة محفوظة، ${d.scans} مسح، ${d.evaluated} سجل تقييم يشمل الحالات غير المحسومة. التخزين ${d.storage}.`;
    $('runtime').textContent = `الرصد الخلفي ${d.runtime?.background_enabled ? 'مفعّل أثناء الجلسة النظامية' : 'غير مفعّل'}؛ آخر مسح ${d.runtime?.last_scan_at ?? 'غير متاح'}؛ آخر خطأ ${d.runtime?.last_error ?? 'لا يوجد مسجل'}.`;
    $('outcomes').replaceChildren();
    for (const row of d.recent ?? []) {
      const tr = document.createElement('tr');
      for (const value of [row.symbol, row.at, row.feed, names[row.outcome?.status] ?? 'لم يُقيّم بعد']) { const td = document.createElement('td'); td.textContent = value ?? '—'; tr.append(td); }
      $('outcomes').append(tr);
    }
  } catch {
    $('server').textContent = 'تعذر الوصول إلى السجل الخادمي. لا يعني ذلك عدم وجود إشارات أو أن الأداء صفر.';
  } finally {
    busy = false;
    $('refresh').disabled = false;
  }
}
$('refresh').onclick = refresh;
void refresh();
