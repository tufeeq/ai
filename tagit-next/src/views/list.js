// The opportunity list: priority tier, monitoring tier, or a flat ranking.
import { html } from '../html.js';
import * as f from '../format.js';
import { assessRow, flowOf, visibleRows, groupRows } from '../state.js';
import { stateBadge, shariaBadge, meter } from './common.js';

const EMPTY = {
  early: 'لا توجد أسهم تطابق هذه الفلاتر الآن.',
  gainers: 'لا توجد أسهم تطابق هذه الفلاتر الآن.',
  watch: 'قائمتك فارغة. افتح ملف أي سهم واضغط «أضف للمتابعة».',
};

export const LIST_NOTES = {
  early: 'الأعلى استيفاءً: ٨ من ١٢ شرطًا فأكثر مع دقائق حديثة وسيولة كافية ودون امتداد. الترتيب لا يعني احتمال ربح.',
  gainers: 'مرتبة بتغير اليوم مقارنة بإغلاق أمس المعدّل للتجزئة. الارتفاع وحده ليس فرصة دخول.',
  watch: 'قائمتك محفوظة في هذا المتصفح (حتى ٥٠ سهمًا)، وتُسجَّل نتيجة كل سهم يوميًا عند وصول سعر حديث.',
};

function row(state, r, now) {
  const selected = state.ui.selected === r.symbol;
  if (r.placeholder) {
    return html`<li data-key="row-${r.symbol}"><button class="row${selected ? ' is-selected' : ''}" data-symbol="${r.symbol}" aria-current="${selected}">
      <span class="row-id"><span class="sym">${state.watched.has(r.symbol) ? '★ ' : ''}${r.symbol}</span><span class="name">بانتظار أول سعر</span></span>
      <span class="row-price muted">—</span><span class="row-meter"></span><span class="row-vol"></span><span class="row-state"></span>
      <span class="row-age"><i class="dot none"></i>—</span></button></li>`;
  }
  const a = assessRow(state, r, now);
  const flow = flowOf(state, r.symbol, now);
  const s = r.signal;
  return html`<li data-key="row-${r.symbol}"><button class="row${selected ? ' is-selected' : ''}" data-symbol="${r.symbol}" aria-current="${selected}">
    <span class="row-id"><span class="sym">${state.watched.has(r.symbol) ? '★ ' : ''}${r.symbol} ${shariaBadge(r, now)}</span><span class="name">${r.name ?? ''}</span></span>
    <span class="row-price"><span class="px" dir="ltr">${f.usd(r.price)}</span><span class="chg ${f.tone(r.day_change)}" dir="ltr">${f.pct(r.day_change)}</span></span>
    <span class="row-meter">${meter(a)}<span class="meter-label" dir="ltr">${a.passed}/${a.total}</span></span>
    <span class="row-vol"><span dir="ltr">${f.num(s?.volume_ratio, 1)}×</span><small dir="ltr">${f.compactUsd(s?.dollars_3m)}</small></span>
    <span class="row-state">${stateBadge(a.state)}<small class="flow fl-${flow.status}">${flow.label}</small></span>
    <span class="row-age" data-age="${r.price_at ?? ''}"><i class="dot ${f.freshness(r.price_at, now)}"></i><span class="age-text">${f.age(r.price_at, now)}</span></span>
  </button></li>`;
}

function tier(key, title, count, hint) {
  return html`<li data-key="${key}" class="tier ${key}"><span class="tier-title">${title} <b>${count}</b></span><small>${hint}</small></li>`;
}

export function renderList(state, now) {
  const rows = visibleRows(state, now);
  const { view } = state.ui;
  let items;
  if (!rows.length) {
    items = [];
  } else if (view === 'gainers') {
    items = rows.map((r) => row(state, r, now));
  } else {
    const { upper, lower } = groupRows(state, rows.filter((r) => !r.placeholder), now);
    const pending = rows.filter((r) => r.placeholder);
    items = [
      tier('tier-upper', '↑ الأعلى استيفاءً', upper.length, '٨/١٢ فأكثر · سيولة ودقائق حديثة · ليست ضمان دخول'),
      upper.length ? upper.map((r) => row(state, r, now)) : html`<li data-key="tier-upper-empty" class="tier-empty">لا فرصة تستوفي حد القسم الأعلى الآن.</li>`,
      tier('tier-lower', '◉ الجديرة بالمتابعة', lower.length + pending.length, 'تنتقل للأعلى تلقائيًا عند استيفاء الشروط'),
      lower.map((r) => row(state, r, now)),
      pending.map((r) => row(state, r, now)),
    ];
  }
  let empty = '';
  if (!rows.length) {
    empty = state.scan || view === 'watch' ? EMPTY[view] : 'بانتظار أول مسح للسوق…';
  }
  return { markup: html`${items}`, count: rows.length, empty };
}
