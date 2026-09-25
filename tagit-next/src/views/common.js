import { html } from '../html.js';
import { shariaStatus } from '../core/sharia.js';
import { riskOf } from '../core/risk.js';

export const STATE_NAMES = {
  READY: 'خطة مشروطة',
  CONFIRM: 'تحتاج تأكيدًا',
  EXTENDED: 'حركة ممتدة',
  STALE: 'سعر غير حديث',
  WATCH: 'للمتابعة',
  HALTED: 'تداول موقوف',
};

export const STATE_HINTS = {
  READY: 'كل الشروط مستوفاة الآن، والخطة صالحة ما دامت البيانات حديثة.',
  CONFIRM: 'ظهر تسارع في الحجم والسعر، وتنقص شروط قبل أن تصبح خطة.',
  EXTENDED: 'الحركة ابتعدت عن بدايتها؛ لا تُعامل كبداية مبكرة.',
  STALE: 'آخر صفقة أو آخر مسح غير حديث؛ لا تُبنى خطة على سعر قديم.',
  WATCH: 'لا نمط انطلاق مكتمل الآن.',
  HALTED: 'أوقفت البورصة التداول على السهم؛ لا خطة حتى يُستأنف التداول وتتجدد البيانات.',
};

export const stateBadge = (state) => html`<span class="badge s-${state}">${STATE_NAMES[state]}</span>`;

export function shariaBadge(row, now) {
  const s = shariaStatus(row?.sharia, now);
  return html`<span class="sharia sh-${s.status}" role="img" aria-label="${s.label}" title="${s.label}">${s.icon}</span>`;
}

/** Twelve-segment meter of passed checks. */
export function meter(a) {
  return html`<span class="meter" role="img" aria-label="${a.passed} من ${a.total} شروط مستوفاة">${a.checks.map(
    (c) => html`<i class="${c.pass ? 'on' : ''}"></i>`,
  )}</span>`;
}

/** Disclosure/listing risk for a row, from the published enrichment file and the live halt flag. */
export const riskFor = (state, row, now) =>
  riskOf(state.enrichment?.symbols?.[row.symbol], row, now, state.enrichment?.generated_at);

export function riskBadge(risk) {
  if (risk.level !== 'HIGH' && risk.level !== 'WATCH') return '';
  const title = risk.items.map((i) => i.label).join(' · ');
  return html`<span class="risk r-${risk.level}" role="img" aria-label="${title}" title="${title}">⚠</span>`;
}

export const stat = (label, value, hint) =>
  html`<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong>${hint ? html`<small>${hint}</small>` : ''}</div>`;
