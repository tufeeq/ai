// Journal list: every watch or alert record with its observed outcome.
import { html } from '../html.js';
import * as f from '../format.js';
import { outcome } from '../core/journal.js';
import { journalRows } from '../state.js';

export const JOURNAL_NOTE = 'نتائج أسعار مرصودة منذ بدء المتابعة، وليست أرباح صفقات منفذة. لا رصد أثناء إغلاق الصفحة. صدّر السجل للاحتفاظ بنسخة مستقلة.';

export function renderJournal(state) {
  const events = journalRows(state);
  const wins = events.filter((e) => (outcome(e).change ?? 0) > 0).length;
  const summary = events.length
    ? html`<li data-key="journal-summary" class="tier"><span class="tier-title">السجل <b>${events.length}</b></span><small>${wins} منها أعلى من سعر الرصد الآن · عينات وليست صفقات</small></li>`
    : '';
  const items = events.map((e) => {
    const o = outcome(e);
    const selected = state.ui.selected === e.symbol;
    return html`<li data-key="j-${e.id}"><button class="row journal-row${selected ? ' is-selected' : ''}" data-symbol="${e.symbol}" data-event="${e.id}">
      <span class="row-id"><span class="sym">${e.symbol}</span><span class="name">${e.kind === 'SIGNAL' ? 'تنبيه آلي' : 'متابعة يدوية'} · ${f.dateTime(e.started_at)}</span></span>
      <span class="row-price"><span class="px" dir="ltr">${f.usd(e.start_price)} → ${f.usd(e.last_price)}</span><small>آخر عينة ${f.time(e.last_at)}</small></span>
      <span class="row-change ${f.tone(o.change)}" dir="ltr">${f.pct(o.change)}</span>
      <span class="row-range"><span class="up" dir="ltr">${f.pct(o.maximum)}</span><span class="down" dir="ltr">${f.pct(o.drawdown)}</span></span>
    </button></li>`;
  });
  return {
    markup: html`${summary}${items}`,
    count: events.length,
    empty: events.length ? '' : state.ui.search ? 'لا سجلات تطابق البحث.' : 'لم يبدأ السجل بعد. أضف سهمًا للمتابعة أو انتظر تنبيهًا آليًا.',
  };
}
