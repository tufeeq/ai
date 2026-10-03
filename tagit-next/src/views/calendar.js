// Upcoming scheduled catalysts (data/catalyst-calendar.json): FDA decision dates, earnings dates, and
// stocks inside the "sell the news" window (calendar-study-1 avoid rule A). Information, not signals.
import { html } from '../html.js';
import * as f from '../format.js';
import { marketDate } from '../core/market.js';
import { shariaBadge } from './common.js';
import { afterNewsWarning, AFTER_NEWS_NOTE } from './dossier.js';

export const CALENDAR_NOTE = 'مواعيد معلنة مسبقًا لأسهم أقل من ٣٠٠ مليون: قرارات FDA (من ملفات SEC) والنتائج المالية خلال ٢١ يومًا (تقويم ناسداك)، ويُحدَّث يوميًا. معلومة لا توصية: الدراسة المسجلة calendar-study-1 لم تجد ربحًا مثبتًا في الشراء قبل هذه المواعيد، ووجدت أن الشراء بعد إعلان نتائج سبقه صعود ١٠٪ يخسر.';

const KIND = { fda: 'قرار FDA', earnings: 'نتائج مالية', after: 'بيع على الخبر' };
const TIME = { PRE_MARKET: 'قبل الافتتاح', AFTER_HOURS: 'بعد الإغلاق' };

function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000);
}

/** Calendar entries from today on, warnings first, then by date (FDA before earnings on the same day). */
export function calendarEntries(calendar, today) {
  if (!calendar) return [];
  const after = (calendar.after_news ?? []).filter((e) => afterNewsWarning(calendar, e.symbol, today)).map((e) => ({ ...e, kind: 'after', date: e.reaction_day }));
  const upcoming = [
    ...(calendar.fda ?? []).map((e) => ({ ...e, kind: 'fda' })),
    ...(calendar.earnings ?? []).map((e) => ({ ...e, kind: 'earnings' })),
  ].filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'fda' ? -1 : 1) || a.symbol.localeCompare(b.symbol));
  return [...after, ...upcoming];
}

export function renderCalendarList(state, now) {
  const cal = state.catalysts;
  if (!cal) return { markup: '', count: 0, empty: 'جارٍ تحميل تقويم المواعيد…' };
  const today = marketDate(now);
  const entries = calendarEntries(cal, today);
  const fda = entries.filter((e) => e.kind === 'fda').length;
  const earn = entries.filter((e) => e.kind === 'earnings').length;
  const warn = entries.filter((e) => e.kind === 'after').length;
  const summary = html`<li data-key="calendar-summary" class="tier"><span class="tier-title">المواعيد القادمة <b>${entries.length}</b></span>
    <small>${f.num(fda, 0)} قرار FDA · ${f.num(earn, 0)} نتائج مالية · ${f.num(warn, 0)} تحذير بيع على الخبر · حُدِّث ${f.time(cal.updated_at)}</small>
    <small class="sip-evidence">الشراء قبل النتائج: لا ميزة بعد التكلفة. قبل قرار FDA: واعد ولم يثبت. اضغط السهم للتفاصيل.</small></li>`;
  const items = entries.map((e) => {
    const row = state.stocks.get(e.symbol);
    const left = daysBetween(today, e.date);
    const selected = state.ui.selected === e.symbol;
    const when = e.kind === 'after' ? `أعلن ${e.report_day} · التحذير حتى ${e.warn_until}`
      : left === 0 ? 'اليوم' : left === 1 ? 'غدًا' : `بعد ${f.num(left, 0)} يوم`;
    const detail = e.kind === 'fda' ? `أعلنته الشركة ${e.announced}`
      : e.kind === 'earnings' ? (TIME[e.time] ?? 'التوقيت غير محدد')
      : `صعد ${f.pct(e.runup_pct)} في ٥ جلسات قبل الإعلان`;
    const badge = e.kind === 'after' ? 's-EXTENDED' : e.kind === 'fda' ? 's-READY' : 's-WATCH';
    return html`<li data-key="cal-${e.kind}-${e.symbol}-${e.date}"><button class="row sip-row${selected ? ' is-selected' : ''}" data-symbol="${e.symbol}" title="${e.kind === 'after' ? AFTER_NEWS_NOTE : ''}">
      <span class="row-id"><span class="sym">${e.symbol} ${shariaBadge(row ?? {}, now)}<span class="badge ${badge}">${KIND[e.kind]}</span></span><span class="name">${row?.name ?? e.name ?? ''}</span></span>
      <span class="row-price"><span class="px" dir="ltr">${e.date}</span><small>${when}</small></span>
      <span class="row-vol"><span>${KIND[e.kind]}</span><small>${detail}</small></span>
      <span class="row-state"><span dir="ltr">${Number.isFinite(e.market_cap_m) ? `$${f.num(e.market_cap_m, 0)}M` : '—'}</span><small>${e.industry ?? ''}</small></span>
    </button></li>`;
  });
  return {
    markup: html`${summary}${items}`,
    count: entries.length,
    empty: entries.length ? '' : 'لا مواعيد قادمة في التقويم حاليًا.',
  };
}
