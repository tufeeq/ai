// Today's real-time consolidated signals (server pulse, discovery-1c) with what each one's price did
// afterwards. The list shows every signal and its outcome — good and bad — so the record speaks for
// itself; a signal is a detected burst, not a recommendation.
import { html } from '../html.js';
import * as f from '../format.js';
import { pulseToday } from '../state.js';
import { riskFor, riskBadge, shariaBadge } from './common.js';

export const PULSE_NOTE = 'كل إشارة تسارع رصدها الخادم اليوم على البيانات المجمّعة اللحظية (كل البورصات)، ثم ما فعله سعرها بعدها: بعد ١٥ و٣٠ دقيقة، وأعلى وأدنى سعر، وهل لمس الإبطال. الخطة تبقى قائمة ٢٠ دقيقة ما دام السعر بين الإبطال ومنطقة التفعيل. السجل الكامل محفوظ في قاعدة البيانات، ومعه سياق الأخبار وقت الرصد ومسار السعر في الساعة الأولى لدراسة حية مسجلة مسبقًا.';

const finiteNum = (x) => typeof x === 'number' && Number.isFinite(x);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Live change since the signal: the page's own price when newer, else the server's last observation. */
export function changeSince(entry, row) {
  const o = entry.observed ?? {};
  const t0 = Date.parse(entry.detected_at);
  if (row && finiteNum(row.price) && row.price > 0 && Date.parse(row.price_at) >= Math.max(t0, Date.parse(o.last_at ?? 0) || 0)) {
    return (row.price / entry.price - 1) * 100;
  }
  return finiteNum(o.last_return_pct) ? o.last_return_pct : null;
}

/** Summary of today's outcomes (only horizons already reached count). */
export function pulseSummary(entries) {
  const at = (k) => entries.map((e) => e.observed?.[k]?.return_pct).filter(finiteNum);
  const m15 = at('m15'), m30 = at('m30');
  const stopHits = entries.filter((e) => e.observed?.stop_hit_at).length;
  const best = entries.map((e) => e.observed?.max_return_pct).filter(finiteNum);
  return {
    count: entries.length,
    m15: { n: m15.length, mean: mean(m15), up: m15.filter((x) => x > 0).length },
    m30: { n: m30.length, mean: mean(m30), up: m30.filter((x) => x > 0).length },
    stopHits,
    bestMean: mean(best),
  };
}

/** News context recorded when the signal fired (only items published before detection). */
export function newsLine(news) {
  if (!news) return null;
  if (news.error) return 'الأخبار: تعذر الجلب';
  if (!news.count_24h) return 'بلا أخبار خلال ٢٤ ساعة قبل الرصد';
  const when = finiteNum(news.latest_minutes_before) ? (news.latest_minutes_before < 120 ? `قبل ${news.latest_minutes_before} د` : `قبل ${Math.round(news.latest_minutes_before / 60)} س`) : '';
  return `خبر ${when}: ${news.latest_headline ?? ''}`.trim();
}

const outcome = (o, k) => (finiteNum(o?.[k]?.return_pct) ? html`<span dir="ltr" class="${f.tone(o[k].return_pct)}">${f.pct(o[k].return_pct)}</span>` : html`<span class="muted">—</span>`);

export function renderPulseList(state, now) {
  const { supported, error } = state.pulse;
  if (!supported) {
    return { markup: '', count: 0, empty: error ? `تعذر جلب إشارات الخادم: ${error}. نعيد المحاولة تلقائيًا.` : 'جارٍ جلب إشارات اليوم من الخادم…' };
  }
  const entries = pulseToday(state, now);
  const sum = pulseSummary(entries);
  const line = [
    `${f.num(sum.count, 0)} إشارة اليوم`,
    sum.m15.n ? `بعد ١٥ د: متوسط ${f.pct(sum.m15.mean)} · ${f.num(sum.m15.up, 0)}/${f.num(sum.m15.n, 0)} صاعدة` : null,
    sum.m30.n ? `بعد ٣٠ د: متوسط ${f.pct(sum.m30.mean)} · ${f.num(sum.m30.up, 0)}/${f.num(sum.m30.n, 0)} صاعدة` : null,
    sum.count ? `لمس الإبطال ${f.num(sum.stopHits, 0)}` : null,
  ].filter(Boolean).join(' · ');
  const summary = html`<li data-key="pulse-summary" class="tier"><span class="tier-title">إشارات لحظية <b>${sum.count}</b></span>
    <small>${line}</small>
    <small class="sip-evidence">النتائج قبل الرسوم والانزلاق. كل الدراسات السابقة على هذه الإشارات كانت سالبة بعد التكلفة؛ هذا السجل الحي هو الحكم.</small></li>`;
  const items = entries.map((e) => {
    const row = state.stocks.get(e.symbol);
    const o = e.observed ?? {};
    const change = changeSince(e, row);
    const ageMs = now - Date.parse(e.detected_at);
    const live = ageMs <= 20 * 60_000 && !o.stop_hit_at;
    const selected = state.ui.selected === e.symbol;
    const news = newsLine(e.news);
    return html`<li data-key="pulse-${e.symbol}-${e.detected_at}"><button class="row sip-row${selected ? ' is-selected' : ''}${live ? '' : ' is-stale'}" data-symbol="${e.symbol}">
      <span class="row-id"><span class="sym">${e.symbol} ${shariaBadge(row ?? {}, now)}${riskBadge(riskFor(state, row ?? { symbol: e.symbol }, now))}${live ? html`<span class="badge s-READY" title="خلال ٢٠ دقيقة من الرصد ولم يلمس الإبطال">نشطة</span>` : ''}${o.stop_hit_at ? html`<span class="badge s-EXTENDED" title="لمس السعر مستوى الإبطال بعد الرصد">لمس الإبطال</span>` : ''}</span><span class="name">${row?.name ?? ''}</span>${news ? html`<small class="pulse-news${e.news?.count_2h ? ' is-fresh' : ''}" title="${e.news?.latest_source ?? ''}">${news}</small>` : ''}</span>
      <span class="row-price"><span class="px" dir="ltr">${f.usd(e.price)}</span><small>رُصد ${f.time(e.detected_at)} · قبل ${f.age(e.detected_at, now)}</small><small dir="ltr">تفعيل ${f.num(e.trigger, 4)} · إبطال ${f.num(e.stop, 4)}</small></span>
      <span class="row-vol"><span dir="ltr" class="${f.tone(e.return_3m)}">${f.pct(e.return_3m)}</span><small dir="ltr">${f.num(e.volume_ratio, 1)}× · ${f.compactUsd(e.dollars_3m)}</small></span>
      <span class="row-state"><span dir="ltr" class="${f.tone(change)}">${finiteNum(change) ? f.pct(change) : '—'}</span><small>منذ الرصد · ١٥ د ${outcome(o, 'm15')} · ٣٠ د ${outcome(o, 'm30')}</small><small dir="ltr">أعلى ${finiteNum(o.max_return_pct) ? f.pct(o.max_return_pct) : '—'} · أدنى ${finiteNum(o.min_return_pct) ? f.pct(o.min_return_pct) : '—'}</small></span>
    </button></li>`;
  });
  return {
    markup: html`${summary}${items}`,
    count: entries.length,
    empty: entries.length ? '' : 'لم يرصد الخادم إشارات تسارع اليوم بعد. تبدأ الإشارات مع الجلسة النظامية (٩:٣٠ صباحًا بتوقيت نيويورك).',
  };
}
