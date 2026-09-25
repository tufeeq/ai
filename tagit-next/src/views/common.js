import { html } from '../html.js';
import { shariaStatus } from '../core/sharia.js';

export const STATE_NAMES = {
  READY: 'خطة مشروطة',
  CONFIRM: 'تحتاج تأكيدًا',
  EXTENDED: 'حركة ممتدة',
  STALE: 'سعر غير حديث',
  WATCH: 'للمتابعة',
};

export const STATE_HINTS = {
  READY: 'كل الشروط مستوفاة الآن، والخطة صالحة ما دامت البيانات حديثة.',
  CONFIRM: 'ظهر تسارع في الحجم والسعر، وتنقص شروط قبل أن تصبح خطة.',
  EXTENDED: 'الحركة ابتعدت عن بدايتها؛ لا تُعامل كبداية مبكرة.',
  STALE: 'آخر صفقة أو آخر مسح غير حديث؛ لا تُبنى خطة على سعر قديم.',
  WATCH: 'لا نمط انطلاق مكتمل الآن.',
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

export const stat = (label, value, hint) =>
  html`<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong>${hint ? html`<small>${hint}</small>` : ''}</div>`;
