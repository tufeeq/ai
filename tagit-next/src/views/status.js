// Header status, KPI strip and data notices.
import { html } from '../html.js';
import * as f from '../format.js';
import { marketSession } from '../core/market.js';
import { errorMessage } from '../api.js';
import { metrics, priceCoverage, UNIVERSE_CAP } from '../state.js';

/** The small-cap ceiling the server actually applied (older servers report $100M), e.g. "أقل من 300 مليون دولار". */
const capLabel = (state) => `أقل من ${f.num((Number(state.scan?.coverage?.max_market_cap_exclusive) || UNIVERSE_CAP) / 1e6, 0)} مليون دولار`;

const PHASES = {
  boot: ['connecting', 'جارٍ الاتصال…'],
  live: ['live', 'متصل'],
  partial: ['partial', 'تغطية جزئية'],
  error: ['error', 'تعذر التحديث'],
};

export function renderStatus(state, now, { scanning }) {
  const session = marketSession(now);
  const offline = state.offline && state.connection.phase !== 'boot';
  const [cls, label] = offline ? ['error', 'لا اتصال بالإنترنت'] : PHASES[state.connection.phase];
  const scanAge = state.scan ? f.age(state.scan.server_time, now) : null;
  const text = scanning && !state.scan ? 'جارٍ المسح…' : label;
  // The pill ticks every second, so it is not a live region; a hidden region announces phase changes only.
  return html`
    <span class="pill session s-${session.key}" title="حسب ساعة نيويورك؛ العطل الرسمية غير محتسبة"><i></i>${session.label}</span>
    <span class="pill conn c-${scanning && cls !== 'live' ? 'connecting' : cls}" title="${scanAge ? `عمر آخر مسح: ${scanAge}` : ''}"><i></i>${text}${scanAge ? html` · <span dir="ltr">${scanAge}</span>` : ''}</span>
    <span class="sr-only" role="status" data-key="conn-announce">${text}</span>`;
}

export function renderMetrics(state, now) {
  const m = metrics(state, now);
  const c = state.scan?.coverage;
  const p = priceCoverage(state, now);
  const item = (key, label, value, hint, accent = false, dir = 'ltr') =>
    html`<div class="kpi${accent ? ' accent' : ''}" data-key="kpi-${key}"><span>${label}</span><strong dir="${dir}">${value ?? f.DASH}</strong><small>${hint}</small></div>`;
  // "معروضة / حالية" reads right to left, so the pair is laid out right to left too (shown on the right).
  const pair = (a, b) => `${f.ltr(f.num(a, 0))} / ${f.ltr(f.num(b, 0))}`;
  return html`
    ${item('scanned', 'أسهم ضمن المسح', m.scanned !== null ? f.num(m.scanned, 0) : null, `ناسداك · ${capLabel(state)}`)}
    ${item('priced', 'أسعار معروضة / حالية', p.total ? pair(p.total, p.live + p.quiet) : c ? pair(c.with_prices, c.fresh_prices) : null,
    p.total ? `مجمّع ${f.num(p.CONSOLIDATED, 0)} · IEX ${f.num(p.IEX, 0)} · متأخر ${f.num(p.delayed, 0)} · قديم ${f.num(p.stale + p.aging, 0)}` : 'عند آخر مسح', false, 'rtl')}
    ${item('signals', 'تسارع مستوفٍ', state.scan ? m.signals : null, 'حجم وسعر ودقائق حديثة')}
    ${item('plans', 'خطط مشروطة الآن', state.scan ? m.plans : null, 'تتغير مع حداثة السعر', true)}`;
}

/** Notices above the list: connection errors, partial coverage, quote failures, storage. */
export function renderNotices(state, now = Date.now()) {
  const notes = [];
  const { phase, error } = state.connection;
  if (state.offline) {
    notes.push(['error', 'هذا الجهاز غير متصل بالإنترنت. الأسعار المعروضة ليست حالية، ونستأنف التحديث فور عودة الاتصال.']);
  }
  if (phase === 'boot' && !state.scan) {
    notes.push(['info', 'نحمّل بيانات السوق؛ قد يحتاج تشغيل الخادم المجاني نحو دقيقة في أول زيارة.']);
  }
  if (phase === 'error' && !state.offline) {
    const wait = state.retryAt > now ? Math.ceil((state.retryAt - now) / 1000) : 0;
    // Counters tick every second: kept out of the live region so screen readers are not flooded.
    const tick = (t) => html`<span aria-live="off">${t}</span>`;
    const retry = wait ? html`المحاولة التالية خلال ${tick(wait < 60 ? `${wait} ث` : `${Math.ceil(wait / 60)} د`)} تقريبًا.` : 'نعيد المحاولة تلقائيًا.';
    const since = state.scan ? html` آخر مسح ناجح قبل ${tick(f.age(state.scan.server_time, now))}؛ الأسعار المعروضة ليست حالية.` : '';
    notes.push(['error', html`${errorMessage(error)}${since} ${retry} لا تُفعَّل خطة من بيانات قديمة.`]);
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
  const comp = state.scan?.complements;
  if (comp?.consolidated && ['BACKING_OFF', 'FAILING'].includes(comp.consolidated.status)) {
    notes.push(['info', 'الأسعار المجمّعة من ناسداك غير متاحة مؤقتًا؛ نعرض أسعار IEX وحدها مع عمرها.']);
  }
  if (state.scan && state.live.supported === false) {
    notes.push(['info', 'لوحة الأسعار المجمّعة غير مفعّلة في الخادم بعد؛ كل سعر معلَّم بمصدره وعمره.',
      'نعرض IEX ومجمّع ناسداك لأبرز الأسهم ومجمّعًا متأخرًا ١٦ دقيقة. السعر القديم أو المتأخر معلَّم ولا يُعد حاليًا.']);
  } else if (state.live.supported && state.live.error) {
    notes.push(['warn', 'تعذر تحديث لوحة الأسعار المجمّعة؛ راقب مصدر كل سعر وعمره.']);
  }
  if (state.scan && !state.closes) notes.push(['info', 'نسبة التغير تُحسب مؤقتًا من إغلاق الخادم؛ المعلَّمة بـ * ليست من إغلاق مجمّع.']);
  if (comp?.halts?.status === 'UNAVAILABLE') notes.push(['info', 'تعذر التحقق من إيقافات التداول الآن؛ لا يعني ذلك أن التداول مستمر.']);
  if (!state.storageOk) notes.push(['warn', 'تعذر الحفظ في هذا المتصفح؛ صدّر السجل للاحتفاظ به.']);
  // Details stay one tap away so the list reaches the first screen on a phone.
  return html`${notes.map(([kind, text, more], i) => (more
    ? html`<details class="notice n-${kind}" data-key="notice-${i}-${kind}-more"><summary role="status">${text}</summary><p>${more}</p></details>`
    : html`<p class="notice n-${kind}" data-key="notice-${i}-${kind}" role="status">${text}</p>`))}`;
}

export function coverageText(state) {
  const c = state.scan?.coverage;
  if (!c) return '';
  return `${String(state.scan.feed ?? '').toUpperCase()} · قائمة ناسداك لدى المزود ${f.num(c.nasdaq_assets, 0)} رمزًا، منها ${f.num(c.eligible_small_caps, 0)} مؤهلًا (${capLabel(state)} حسب مرجع ${f.dateTime(c.metadata_at)})، و${f.num(c.detailed_symbols, 0)} رمزًا بفحص دقائق متعمق.`;
}
