// Header status, KPI strip and data notices.
import { html } from '../html.js';
import * as f from '../format.js';
import { marketSession } from '../core/market.js';
import { errorMessage } from '../api.js';
import { metrics } from '../state.js';

const PHASES = {
  boot: ['connecting', 'جارٍ الاتصال…'],
  live: ['live', 'متصل'],
  partial: ['partial', 'تغطية جزئية'],
  error: ['error', 'تعذر التحديث'],
};

export function renderStatus(state, now, { scanning }) {
  const session = marketSession(now);
  const [cls, label] = PHASES[state.connection.phase];
  const scanAge = state.scan ? f.age(state.scan.server_time, now) : null;
  return html`
    <span class="pill session s-${session.key}" title="حسب ساعة نيويورك؛ العطل الرسمية غير محتسبة"><i></i>${session.label}</span>
    <span class="pill conn c-${scanning && cls !== 'live' ? 'connecting' : cls}" role="status"><i></i>${scanning && !state.scan ? 'جارٍ المسح…' : label}${scanAge ? html` · <span dir="ltr">${scanAge}</span>` : ''}</span>`;
}

export function renderMetrics(state, now) {
  const m = metrics(state, now);
  const c = state.scan?.coverage;
  const item = (key, label, value, hint, accent = false) =>
    html`<div class="kpi${accent ? ' accent' : ''}" data-key="kpi-${key}"><span>${label}</span><strong dir="ltr">${value ?? f.DASH}</strong><small>${hint}</small></div>`;
  return html`
    ${item('scanned', 'أسهم ضمن المسح', m.scanned !== null ? f.num(m.scanned, 0) : null, 'ناسداك · أقل من ١٠٠ مليون دولار')}
    ${item('priced', 'أسعار متاحة / حديثة', c ? `${f.num(c.with_prices, 0)} / ${f.num(c.fresh_prices, 0)}` : null, 'عند آخر مسح · حديثة = خلال ١٥ ث')}
    ${item('signals', 'تسارع مستوفٍ', state.scan ? m.signals : null, 'حجم وسعر ودقائق حديثة')}
    ${item('plans', 'خطط مشروطة الآن', state.scan ? m.plans : null, 'تتغير مع حداثة السعر', true)}`;
}

/** Notices above the list: connection errors, partial coverage, quote failures, storage. */
export function renderNotices(state) {
  const notes = [];
  const { phase, error } = state.connection;
  if (phase === 'boot' && !state.scan) {
    notes.push(['info', 'نحمّل بيانات السوق؛ قد يحتاج تشغيل الخادم المجاني نحو دقيقة في أول زيارة.']);
  }
  if (phase === 'error') {
    notes.push(['error', `${errorMessage(error)} نعيد المحاولة تلقائيًا. لا تُفعَّل خطة من بيانات قديمة.`]);
  }
  if (state.scan) {
    const c = state.scan.coverage;
    const parts = [];
    if (c.history_error) parts.push('تعذر اكتمال بعض بيانات الدقائق');
    if (c.news_error) parts.push('الأخبار غير مكتملة');
    if (c.failed_symbols) parts.push(`فشل جلب ${c.failed_symbols} رمزًا`);
    if (parts.length) notes.push(['warn', `${parts.join('، ')}.`]);
  }
  if (state.quoteError) notes.push(['warn', 'تعذر تحديث الأسعار السريع؛ نعيد المحاولة. راقب عمر آخر صفقة.']);
  if (!state.storageOk) notes.push(['warn', 'تعذر الحفظ في هذا المتصفح؛ صدّر السجل للاحتفاظ به.']);
  return html`${notes.map(([kind, text], i) => html`<p class="notice n-${kind}" data-key="notice-${i}-${kind}" role="status">${text}</p>`)}`;
}

export function coverageText(state) {
  const c = state.scan?.coverage;
  if (!c) return '';
  return `${String(state.scan.feed ?? '').toUpperCase()} · قائمة ناسداك لدى المزود ${f.num(c.nasdaq_assets, 0)} رمزًا، منها ${f.num(c.eligible_small_caps, 0)} مؤهلًا (أقل من ١٠٠ مليون دولار حسب مرجع ${f.dateTime(c.metadata_at)})، و${f.num(c.detailed_symbols, 0)} رمزًا بفحص دقائق متعمق.`;
}
