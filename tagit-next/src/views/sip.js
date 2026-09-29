// Consolidated signals list: the unchanged detector on SIP minute bars, at least 16 minutes late.
// This is the list whose signal was studied (sip-study-1). The study and the forward paper ledger are
// negative after costs, so the list shows that measured result next to the signals, orders chased and
// expired signals last, and never colours a signal as an entry.
import { html } from '../html.js';
import * as f from '../format.js';
import { sipPosition } from '../state.js';
import { marketDate } from '../core/market.js';
import { fadeWarning } from '../core/fade.js';
import { rankSipSignals, signalPhase } from '../core/sipscan.js';
import { RULES } from '../core/detector.js';
import { riskFor, riskBadge, shariaBadge } from './common.js';

export const SIP_NOTE = 'نفس شروط الرصد على بيانات مجمّعة من كل البورصات (SIP)، وهي الإشارة التي دُرست: متوسطها بعد التكلفة سالب في كل الفترات وكل الشرائح، فهي رصد لحركة حدثت وليست توصية دخول. البيانات المجانية تتأخر ١٦ دقيقة على الأقل؛ الإشارات الممتدة والمنتهية تُعرض في الأسفل.';

const delayText = (at, now) => f.age(at, now);

// Neutral wording and colour for "near the trigger": price position is context, never an entry cue.
const POSITION_TEXT = {
  NEAR: 'قرب مستوى الرصد',
  EXTENDED: 'ابتعد عن نقطة الرصد',
  BROKEN: 'تحت مستوى الإبطال',
  UNKNOWN: 'لا سعر حي حديث',
};
const positionClass = (key) => (key === 'NEAR' ? '' : ` p-${key}`);

export const PHASE_TEXT = {
  ENTRY: 'ضمن توقيت الدراسة',
  LATE: 'بعد توقيت الدخول المدروس',
  EXPIRED: 'انتهت مدة الصفقة المدروسة (٣٠ د)',
};

/** One-line measured result of this exact list, from the published study and the paper ledger. */
export function sipEvidenceLine(evidence) {
  const h = evidence?.sip?.holdout?.delayed;
  const p = evidence?.paper?.books?.SIP_DELAYED?.all;
  const parts = [];
  if (Number.isFinite(h?.mean_return_pct)) {
    parts.push(`الدراسة، فترة الاختبار بعد تأخير ١٧ د: متوسط ${f.pct(h.mean_return_pct)} بعد التكلفة، ربح ${f.num((h.win_rate ?? 0) * 100, 0)}٪ من ${f.num(h.resolved, 0)} إشارة`);
  }
  if (p?.trades) {
    parts.push(`السجل الورقي الأمامي: ${f.num(p.trades, 0)} صفقة في ${f.num(p.sessions, 0)} جلسة، متوسط ${f.num(p.mean_net_r, 2)}R صافٍ`);
  }
  const buckets = Object.values(evidence?.sip?.breakdowns_holdout ?? {}).flatMap((b) => Object.values(b ?? {}));
  const noneUp = buckets.length > 0 && buckets.every((b) => Number.isFinite(b?.mean_return_pct) && b.mean_return_pct < 0);
  if (!parts.length) return '';
  return `النتيجة المقاسة لهذه القائمة — ${parts.join(' · ')}.${noneUp ? ' لا توجد شريحة (وقت، سعر، حجم، قيمة، اختراق) موجبة بعد التكلفة في فترة الاختبار.' : ''}`;
}

const warnBadges = (s) => html`${s.extended ? html`<span class="badge s-EXTENDED" title="صعود ٣ دقائق فوق ${RULES.maxEarly3mGain}٪: كانت هذه الإشارات الأسوأ في الدراسة">ممتدة</span>` : ''}${s.fade ? html`<span class="badge s-EXTENDED" title="امتداد يومي خلال آخر ٥ جلسات (fade-study-1): تحذير لا تشترِ">امتداد يومي</span>` : ''}`;

export function renderSipList(state, now) {
  const { phase, result, error } = state.sip;
  if (!result) {
    const empty = phase === 'error' ? `تعذر جلب البيانات المجمّعة: ${error}. نعيد المحاولة تلقائيًا.`
      : state.endpoint ? 'جارٍ فحص البيانات المجمّعة لكل الأسهم المؤهلة… قد يستغرق دقيقة.' : 'بانتظار الاتصال بخدمة البيانات…';
    return { markup: '', count: 0, empty };
  }
  const today = marketDate(now);
  const signals = rankSipSignals(result.signals, now, (symbol) => fadeWarning(state.fadeFlags, symbol, today));
  const current = signals.filter((s) => s.phase !== 'EXPIRED').length;
  const evidenceLine = sipEvidenceLine(state.evidence);
  const summary = html`<li data-key="sip-summary" class="tier"><span class="tier-title">إشارات مجمّعة <b>${signals.length}</b></span>
    <small>${f.num(current, 0)} ضمن مدة الصفقة المدروسة · ${f.num(result.with_bars, 0)} سهمًا ببيانات من ${f.num(result.symbols, 0)} · حتى ${f.time(result.window_end)} نيويورك${result.failed ? ` · تعذر ${result.failed}` : ''}</small>
    ${evidenceLine ? html`<small class="sip-evidence">${evidenceLine}</small>` : ''}</li>`;
  const items = signals.map((s) => {
    const row = state.stocks.get(s.symbol);
    const pos = sipPosition(s, row, now);
    const selected = state.ui.selected === s.symbol;
    const dim = s.phase === 'EXPIRED' || s.warned;
    return html`<li data-key="sip-${s.symbol}-${s.detected_at}"><button class="row sip-row${selected ? ' is-selected' : ''}${dim ? ' is-stale' : ''}" data-symbol="${s.symbol}" data-phase="${s.phase}">
      <span class="row-id"><span class="sym">${s.symbol} ${shariaBadge(row ?? {}, now)}${riskBadge(riskFor(state, row ?? { symbol: s.symbol }, now))}${warnBadges(s)}</span><span class="name">${row?.name ?? ''}</span></span>
      <span class="row-price"><span class="px" dir="ltr">${f.usd(s.price)}</span><small>رُصد ${f.time(s.detected_at)} · قبل ${delayText(s.detected_at, now)} · ${PHASE_TEXT[s.phase]}</small></span>
      <span class="row-vol"><span dir="ltr" class="${f.tone(s.return_3m)}">${f.pct(s.return_3m)}</span><small dir="ltr">${f.num(s.volume_ratio, 1)}× · ${f.compactUsd(s.dollars_3m)}</small></span>
      <span class="row-state"><span class="badge${positionClass(pos.key)}">${POSITION_TEXT[pos.key] ?? pos.label}</span>${Number.isFinite(pos.change) ? html`<small dir="ltr" class="${f.tone(pos.change)}">${f.pct(pos.change)} منذ الرصد</small>` : ''}</span>
    </button></li>`;
  });
  return {
    markup: html`${summary}${items}`,
    count: signals.length,
    empty: signals.length ? '' : 'لا إشارات على البيانات المجمّعة في آخر ساعتين من البيانات المتاحة.',
  };
}

/** Dossier card for a symbol that has a consolidated signal. */
export function sipCard(signal, row, now, evidence = null) {
  if (!signal) return '';
  const pos = sipPosition(signal, row, now);
  const phase = signalPhase(signal, now);
  const extended = signal.extended ?? signal.return_3m > RULES.maxEarly3mGain;
  const evidenceLine = sipEvidenceLine(evidence);
  return html`<section class="sip-card" data-key="sip-card-${signal.symbol}">
    <h3>إشارة على البيانات المجمّعة <small>متأخرة · رُصدت ${f.time(signal.detected_at)} (قبل ${delayText(signal.detected_at, now)}) · ${PHASE_TEXT[phase]}</small></h3>
    <div class="stats">
      <div class="stat"><span class="stat-label">صعود ٣ دقائق</span><strong class="stat-value ${f.tone(signal.return_3m)}" dir="ltr">${f.pct(signal.return_3m)}</strong></div>
      <div class="stat"><span class="stat-label">تسارع الحجم</span><strong class="stat-value" dir="ltr">${f.num(signal.volume_ratio, 1)}×</strong></div>
      <div class="stat"><span class="stat-label">قيمة ٣ دقائق · صفقات</span><strong class="stat-value" dir="ltr">${f.compactUsd(signal.dollars_3m)} · ${f.num(signal.trades_3m, 0)}</strong></div>
      <div class="stat"><span class="stat-label">التفعيل / الإبطال</span><strong class="stat-value" dir="ltr">${f.num(signal.trigger, 4)} / ${f.num(signal.stop, 4)}</strong></div>
    </div>
    <p class="sip-position${positionClass(pos.key)}"><b>${POSITION_TEXT[pos.key] ?? pos.label}</b>${Number.isFinite(pos.change) ? html` · <span dir="ltr">${f.pct(pos.change)}</span> منذ الرصد` : ''}</p>
    ${extended ? html`<p class="note down">صعود ٣ دقائق فوق ${RULES.maxEarly3mGain}٪: حركة ممتدة. في الدراسة كانت هذه الإشارات الأسوأ بعد التكلفة؛ لا تُعامل كبداية مبكرة.</p>` : ''}
    ${evidenceLine ? html`<p class="note">${evidenceLine}</p>` : ''}
    <p class="note">تُحسب على دقائق SIP الأقدم من ١٦ دقيقة؛ ليست خطة لحظية ولا توصية. الإشارة نفسها لم تُظهر نتيجة موجبة بعد التكلفة في أي فترة مدروسة.</p>
  </section>`;
}
