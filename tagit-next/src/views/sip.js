// Consolidated signals list: the unchanged detector on SIP minute bars, at least 16 minutes late.
import { html } from '../html.js';
import * as f from '../format.js';
import { sipPosition } from '../state.js';
import { riskFor, riskBadge, shariaBadge } from './common.js';

export const SIP_NOTE = 'نفس شروط الرصد على بيانات مجمّعة من كل البورصات (SIP). البيانات المجانية تتأخر ١٦ دقيقة على الأقل، فالإشارة تظهر بعد حدوثها؛ راجع موقع السعر الحي من نقطة التفعيل قبل أي قرار.';

const delayText = (at, now) => f.age(at, now);

export function renderSipList(state, now) {
  const { phase, result, error } = state.sip;
  if (!result) {
    const empty = phase === 'error' ? `تعذر جلب البيانات المجمّعة: ${error}. نعيد المحاولة تلقائيًا.`
      : state.endpoint ? 'جارٍ فحص البيانات المجمّعة لكل الأسهم المؤهلة… قد يستغرق دقيقة.' : 'بانتظار الاتصال بخدمة البيانات…';
    return { markup: '', count: 0, empty };
  }
  const signals = result.signals;
  const summary = html`<li data-key="sip-summary" class="tier"><span class="tier-title">إشارات مجمّعة <b>${signals.length}</b></span>
    <small>${f.num(result.with_bars, 0)} سهمًا ببيانات من ${f.num(result.symbols, 0)} · حتى ${f.time(result.window_end)} نيويورك${result.failed ? ` · تعذر ${result.failed}` : ''}</small></li>`;
  const items = signals.map((s, i) => {
    const row = state.stocks.get(s.symbol);
    const pos = sipPosition(s, row, now);
    const selected = state.ui.selected === s.symbol;
    return html`<li data-key="sip-${s.symbol}-${s.detected_at}"><button class="row sip-row${selected ? ' is-selected' : ''}" data-symbol="${s.symbol}">
      <span class="row-id"><span class="sym">${s.symbol} ${shariaBadge(row ?? {}, now)}${riskBadge(riskFor(state, row ?? { symbol: s.symbol }, now))}</span><span class="name">${row?.name ?? ''}</span></span>
      <span class="row-price"><span class="px" dir="ltr">${f.usd(s.price)}</span><small>رُصد ${f.time(s.detected_at)} · قبل ${delayText(s.detected_at, now)}</small></span>
      <span class="row-vol"><span dir="ltr" class="${f.tone(s.return_3m)}">${f.pct(s.return_3m)}</span><small dir="ltr">${f.num(s.volume_ratio, 1)}× · ${f.compactUsd(s.dollars_3m)}</small></span>
      <span class="row-state"><span class="badge p-${pos.key}">${pos.label}</span>${Number.isFinite(pos.change) ? html`<small dir="ltr" class="${f.tone(pos.change)}">${f.pct(pos.change)} منذ الرصد</small>` : ''}</span>
    </button></li>`;
  });
  return {
    markup: html`${summary}${items}`,
    count: signals.length,
    empty: signals.length ? '' : 'لا إشارات على البيانات المجمّعة في آخر ساعتين من البيانات المتاحة.',
  };
}

/** Dossier card for a symbol that has a consolidated signal. */
export function sipCard(signal, row, now) {
  if (!signal) return '';
  const pos = sipPosition(signal, row, now);
  return html`<section class="sip-card" data-key="sip-card-${signal.symbol}">
    <h3>إشارة على البيانات المجمّعة <small>متأخرة · رُصدت ${f.time(signal.detected_at)} (قبل ${delayText(signal.detected_at, now)})</small></h3>
    <div class="stats">
      <div class="stat"><span class="stat-label">صعود ٣ دقائق</span><strong class="stat-value ${f.tone(signal.return_3m)}" dir="ltr">${f.pct(signal.return_3m)}</strong></div>
      <div class="stat"><span class="stat-label">تسارع الحجم</span><strong class="stat-value" dir="ltr">${f.num(signal.volume_ratio, 1)}×</strong></div>
      <div class="stat"><span class="stat-label">قيمة ٣ دقائق · صفقات</span><strong class="stat-value" dir="ltr">${f.compactUsd(signal.dollars_3m)} · ${f.num(signal.trades_3m, 0)}</strong></div>
      <div class="stat"><span class="stat-label">التفعيل / الإبطال</span><strong class="stat-value" dir="ltr">${f.num(signal.trigger, 4)} / ${f.num(signal.stop, 4)}</strong></div>
    </div>
    <p class="sip-position p-${pos.key}"><b>${pos.label}</b>${Number.isFinite(pos.change) ? html` · <span dir="ltr">${f.pct(pos.change)}</span> منذ الرصد` : ''}</p>
    <p class="note">تُحسب على دقائق SIP الأقدم من ١٦ دقيقة؛ لا تُعد خطة لحظية. الخطة اللحظية تبقى مشروطة بقائمة التحقق أدناه.</p>
  </section>`;
}
