// Market insights workspace ("رؤى السوق"): renders data/insights.json. Every section shows its
// as_of (New York) and source, and says so plainly when it is stale or missing.
import { html, raw, safeUrl } from '../html.js';
import * as f from '../format.js';
import { finite, isSymbol } from '../core/util.js';
import {
  freshnessOf, sectionAsOf, sourceFor, list, newsFacets, filterNews, sortSectors, SECTOR_SORTS, maxAbs,
} from '../core/insights.js';

export const DEFAULT_INSIGHTS_UI = { sectorSort: 'chg', movers: 'gainers', sector: '', industry: '', symbol: '' };

const MARKET_STATE = { PRE: 'ما قبل الافتتاح', OPEN: 'الجلسة مفتوحة', AFTER: 'ما بعد الإغلاق', CLOSED: 'السوق مغلق' };
const REGIME_TONE = { RISK_ON: 'on', LEAN_POSITIVE: 'on', MIXED: 'mixed', DEFENSIVE: 'off', RISK_OFF: 'off', UNKNOWN: 'mixed' };
const HORIZON = { '1D': 'يوم', '5D': '٥ أيام', '1M': 'شهر' };

/** A number that stays left-to-right inside Arabic text. */
const n = (text, cls = '') => html`<span class="num ${cls}" dir="ltr">${text}</span>`;
const chg = (v, digits = 2) => n(f.pct(v, digits), f.tone(v));
const ratio = (v) => (finite(v) ? `${f.num(v, 2)}×` : f.DASH);
const capM = (m) => (finite(m) ? f.compactUsd(m * 1e6) : f.DASH);

/** Link a ticker to its dossier in the market workspace. */
export function dossierLink(symbol, cls = 'ins-sym') {
  if (!isSymbol(symbol)) return html`<span class="${cls}" dir="ltr">${symbol ?? f.DASH}</span>`;
  return html`<a class="${cls}" dir="ltr" href="#market/${symbol}" title="افتح ملف ${symbol} في السوق">${symbol}</a>`;
}

// ---- section frame -----------------------------------------------------------------

function stamp(data, key, now) {
  const asOf = sectionAsOf(data, key);
  const fresh = freshnessOf(asOf, now, key);
  const src = sourceFor(data, key);
  const when = fresh.level === 'invalid'
    ? html`<span class="ins-flag bad">وقت غير صالح</span>`
    : html`<time datetime="${asOf}">حتى ${f.dateTime(asOf)} نيويورك</time> · <span class="muted">قبل ${f.age(asOf, now)}</span>`;
  return {
    stale: fresh.level !== 'ok',
    markup: html`<p class="ins-stamp">${when}${fresh.level === 'stale' ? html` <span class="ins-flag">بيانات قديمة</span>` : ''}${src ? html` · <span title="${src.delay_note ?? ''}">${src.name}</span>` : ''}</p>`,
  };
}

function section(key, title, data, now, body, { id = `ins-${key}`, wide = false, extra = '' } = {}) {
  const s = stamp(data, key, now);
  return html`<section class="ins-card ${wide ? 'wide' : ''} ${s.stale ? 'ins-stale' : ''}" id="${id}" data-key="${id}" aria-labelledby="${id}-h">
    <header class="ins-card-head"><div><h2 id="${id}-h">${title}</h2>${s.markup}</div>${extra}</header>
    ${s.stale ? html`<p class="notice n-warn ins-stale-note">هذا القسم أقدم من المتوقع لتحديثه؛ اقرأه كصورة من وقتها لا كحالة السوق الآن.</p>` : ''}
    ${body}
  </section>`;
}

const empty = (text) => html`<p class="ins-empty">${text}</p>`;

// ---- charts ------------------------------------------------------------------------

/** 30-close sparkline; a dashed baseline marks the first close so direction reads without color. */
export function sparkline(values, label) {
  const pts = list(values).filter(finite);
  if (pts.length < 2) return html`<span class="ins-spark-none">لا سلسلة</span>`;
  const W = 120, H = 34, P = 3;
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const span = Math.max(hi - lo, hi * 1e-6 || 1e-6);
  const x = (i) => P + (i / (pts.length - 1)) * (W - 2 * P);
  const y = (v) => P + (1 - (v - lo) / span) * (H - 2 * P);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const up = pts.at(-1) >= pts[0];
  const base = y(pts[0]).toFixed(1);
  const change = ((pts.at(-1) / pts[0]) - 1) * 100;
  const title = `${label}: آخر ${pts.length} إغلاقًا، من ${f.price(pts[0])} إلى ${f.price(pts.at(-1))} (${f.pct(change)})`;
  return html`<svg class="ins-spark ${up ? 'up' : 'down'}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}" dir="ltr" preserveAspectRatio="none">
    <title>${title}</title>
    <line class="ins-spark-base" x1="${P}" x2="${W - P}" y1="${base}" y2="${base}"/>
    <path d="${d}"/>
    <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(pts.at(-1)).toFixed(1)}" r="2.6"/>
  </svg>`;
}

/** Diverging bar from a zero line, with an optional tick (e.g. equal-weight median). */
function divergingBar(value, tick, scale, label) {
  const W = 200, H = 18, mid = W / 2;
  const px = (v) => (finite(v) ? (Math.max(-1, Math.min(1, v / scale)) * (mid - 2)) : 0);
  const w = px(value);
  const bar = finite(value)
    ? raw(`<rect class="${value >= 0 ? 'b-up' : 'b-down'}" x="${(w >= 0 ? mid : mid + w).toFixed(1)}" y="4" width="${Math.max(1, Math.abs(w)).toFixed(1)}" height="10" rx="3"/>`)
    : '';
  const t = finite(tick) ? raw(`<line class="b-tick" x1="${(mid + px(tick)).toFixed(1)}" x2="${(mid + px(tick)).toFixed(1)}" y1="1" y2="17"/>`) : '';
  return html`<svg class="ins-bar" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}" dir="ltr" preserveAspectRatio="none"><title>${label}</title><line class="b-zero" x1="${mid}" x2="${mid}" y1="0" y2="${H}"/>${bar}${t}</svg>`;
}

// ---- sections ---------------------------------------------------------------------

function pulseSection(data, now) {
  const pulse = data.pulse ?? {};
  const indices = list(pulse.indices);
  const regime = pulse.regime;
  const regimeCard = regime?.label_ar
    ? html`<div class="ins-regime r-${REGIME_TONE[regime.key] ?? 'mixed'}"><span class="ins-regime-k">حالة السوق (قاعدة ثابتة)${finite(regime.score) && finite(regime.max_score) ? html` · ${n(`${regime.score}/${regime.max_score}`)} نقاط` : ''}</span><strong>${regime.label_ar}</strong>
        ${list(regime.reasons_ar).length ? html`<ul>${list(regime.reasons_ar).map((r) => html`<li>${r}</li>`)}</ul>` : ''}
        <small class="muted">تصنيف آلي من قواعد مكتوبة في خط البيانات، وليس توقعًا ولا توصية.</small></div>`
    : html`<div class="ins-regime is-empty"><span class="ins-regime-k">حالة السوق</span><strong>غير متاحة</strong><small class="muted">لم يُحسب تصنيف لهذه الجلسة.</small></div>`;
  const ma = (flag, label) => html`<span class="ins-ma ${flag === true ? 'above' : flag === false ? 'below' : ''}">${flag === true ? '▲' : flag === false ? '▼' : '؟'} ${label}</span>`;
  const cards = indices.map((i) => html`<article class="ins-index" data-key="idx-${i.symbol}">
      <div class="ins-index-top"><div><strong class="ins-tick" dir="ltr">${i.symbol}</strong><small>${i.name_ar ?? ''}</small></div>
        <div class="ins-index-px">${n(f.price(i.last), 'px')}${chg(i.chg_1d_pct)}</div></div>
      ${sparkline(i.spark, i.symbol)}
      <dl class="ins-periods"><div><dt>٥ أيام</dt><dd>${chg(i.chg_5d_pct, 1)}</dd></div><div><dt>شهر</dt><dd>${chg(i.chg_1m_pct, 1)}</dd></div><div><dt>منذ بداية السنة</dt><dd>${chg(i.chg_ytd_pct, 1)}</dd></div></dl>
      <div class="ins-mas">${ma(i.above_50dma, 'م50')}${ma(i.above_200dma, 'م200')}</div>
    </article>`);
  const body = html`<div class="ins-pulse">${regimeCard}
    ${indices.length ? html`<div class="ins-indices">${cards}</div>` : empty('لا تتوفر أسعار المؤشرات وصناديق القطاعات في هذا الملف.')}</div>
    <p class="note">▲/▼ م50 و م200: الإغلاق فوق/تحت متوسط ٥٠ و٢٠٠ يوم. الخط المنقط في الرسم = أول إغلاق في السلسلة.</p>`;
  return section('pulse', 'نبض السوق', data, now, body, { wide: true });
}

function gauge(title, b) {
  if (!b || !finite(b.advancers) || !finite(b.decliners)) {
    return html`<div class="ins-gauge is-empty"><h3>${title}</h3>${empty('لا تتوفر بيانات الاتساع.')}</div>`;
  }
  const unch = finite(b.unchanged) ? b.unchanged : 0;
  const total = b.advancers + b.decliners + unch || 1;
  const w = (v) => `${((v / total) * 100).toFixed(2)}%`;
  const pctUp = finite(b.pct_above_0) ? b.pct_above_0 : (b.advancers / total) * 100;
  return html`<div class="ins-gauge"><h3>${title} <small class="muted">${n(f.num(b.universe, 0))} سهم</small></h3>
    <div class="ins-gauge-main"><strong class="${pctUp >= 50 ? 'up' : 'down'}">${n(`${f.num(pctUp, 1)}%`)}</strong><span>من الأسهم مرتفعة اليوم</span></div>
    <div class="ins-stack" role="img" aria-label="صاعدة ${b.advancers}، دون تغير ${unch}، هابطة ${b.decliners}" dir="ltr">
      <i class="adv" style="inline-size:${w(b.advancers)}"></i><i class="unch" style="inline-size:${w(unch)}"></i><i class="dec" style="inline-size:${w(b.decliners)}"></i>
    </div>
    <div class="ins-stack-legend"><span><i class="adv"></i>صاعدة ${n(f.num(b.advancers, 0))}</span><span><i class="unch"></i>دون تغير ${n(f.num(unch, 0))}</span><span><i class="dec"></i>هابطة ${n(f.num(b.decliners, 0))}</span></div>
    <dl class="ins-kv">
      <div><dt>صاعد/هابط</dt><dd>${n(ratio(b.adv_dec_ratio))}</dd></div>
      <div><dt>‎+5% أو أكثر</dt><dd>${n(f.num(b.up_5pct, 0), 'up')}</dd></div>
      <div><dt>‎−5% أو أقل</dt><dd>${n(f.num(b.down_5pct, 0), 'down')}</dd></div>
      <div><dt>قمة ٢٠ يومًا</dt><dd>${n(f.num(b.new_high_20d, 0))}</dd></div>
      <div><dt>حجم غير معتاد</dt><dd>${n(f.num(b.unusual_volume, 0))}</dd></div>
    </dl></div>`;
}

function breadthSection(data, now) {
  const p = data.pulse ?? {};
  return section('breadth', 'اتساع السوق', { ...data, breadth: { as_of: p.breadth?.as_of ?? data.movers?.as_of ?? sectionAsOf(data, 'pulse') } }, now,
    html`<div class="ins-gauges">${gauge('كل الأسهم', p.breadth)}${gauge('الشركات الصغيرة (< $300M)', p.small_caps)}</div>`);
}

function sectorsSection(data, ui, now) {
  const sectors = sortSectors(data.sectors, ui.sectorSort);
  const scale = maxAbs(sectors.flatMap((s) => [s.chg_1d_pct, s.median_chg_pct]));
  const sorts = html`<div class="seg ins-seg" role="group" aria-label="ترتيب القطاعات">${Object.entries(SECTOR_SORTS).map(([k, s]) => html`<button type="button" data-sector-sort="${k}" aria-pressed="${ui.sectorSort === k}" class="${ui.sectorSort === k ? 'is-active' : ''}">${s.label}</button>`)}</div>`;
  if (!sectors.length) return section('sectors', 'القطاعات', data, now, empty('لا تتوفر بيانات القطاعات في هذا الملف.'), { wide: true });
  const rows = sectors.map((s) => html`<li class="ins-sector" data-key="sec-${s.sector}">
      <div class="ins-sector-name"><strong>${s.name_ar ?? s.sector}</strong><small dir="ltr">${s.sector} · ${s.etf ?? ''}</small></div>
      <div class="ins-sector-bar">${divergingBar(s.chg_1d_pct, s.median_chg_pct, scale, `${s.name_ar ?? s.sector}: مرجّح ${f.pct(s.chg_1d_pct)}، الوسيط ${f.pct(s.median_chg_pct)}`)}</div>
      <div class="ins-sector-chg">${chg(s.chg_1d_pct)}<small>وسيط ${chg(s.median_chg_pct)}</small></div>
      <dl class="ins-sector-kv">
        <div><dt>اتساع</dt><dd>${n(finite(s.breadth_pct_up) ? `${f.num(s.breadth_pct_up, 0)}%` : f.DASH)}</dd></div>
        <div><dt>حجم نسبي</dt><dd>${n(ratio(s.rel_volume), finite(s.rel_volume) && s.rel_volume >= 1.3 ? 'hot' : '')}</dd></div>
        <div><dt>٥ أيام <span dir="ltr">${s.etf ?? 'ETF'}</span></dt><dd>${chg(s.etf_chg_5d_pct, 1)}</dd></div>
        <div><dt>شهر <span dir="ltr">${s.etf ?? 'ETF'}</span></dt><dd>${chg(s.etf_chg_1m_pct, 1)}</dd></div>
      </dl>
    </li>`);
  const body = html`<ol class="ins-sectors">${rows}</ol>
    <p class="note">العمود: تغير اليوم مرجّحًا بالقيمة السوقية؛ الخط الرأسي الصغير = الوسيط (وزن متساوٍ لكل سهم). فرق كبير بينهما يعني أن الشركات الكبرى وحدها تحرك القطاع. الاتساع = نسبة الأسهم الصاعدة.</p>`;
  return section('sectors', 'القطاعات', data, now, body, { wide: true, extra: sorts });
}

function industryList(items, title, cls) {
  if (!items.length) return html`<div class="ins-ind-col"><h3>${title}</h3>${empty('لا توجد صناعات تستوفي حد الأسهم الخمسة.')}</div>`;
  return html`<div class="ins-ind-col ${cls}"><h3>${title}</h3><ol class="ins-inds">${items.map((i) => html`<li data-key="ind-${i.industry}">
      <div class="ins-ind-head"><div><strong>${i.name_ar ?? i.industry}</strong><small dir="ltr">${i.name_ar ? `${i.industry} · ` : ''}${i.sector ?? ''}</small></div>${chg(i.chg_1d_pct)}</div>
      <div class="ins-ind-meta">وسيط ${chg(i.median_chg_pct)} · اتساع ${n(finite(i.breadth_pct_up) ? `${f.num(i.breadth_pct_up, 0)}%` : f.DASH)} · حجم ${n(ratio(i.rel_volume))} · ${n(f.num(i.count, 0))} سهم</div>
      ${list(i.leaders).length ? html`<div class="ins-leaders"><span class="muted">أبرزها:</span>${list(i.leaders).map((l) => html`<span class="ins-leader">${dossierLink(l.symbol)} ${chg(l.chg_pct, 1)}</span>`)}</div>` : ''}
    </li>`)}</ol></div>`;
}

function industriesSection(data, now) {
  const ind = data.industries ?? {};
  const body = html`<div class="ins-ind-grid">${industryList(list(ind.top), 'الأقوى اليوم', 'top')}${industryList(list(ind.bottom), 'الأضعف اليوم', 'bottom')}</div>
    <p class="note">الصناعات التي تضم ${n(ind.min_stocks ?? 5)} أسهم على الأقل، مرتبة ${ind.rank_by === 'chg_1d_pct' ? 'بالتغير المرجّح بالقيمة السوقية' : 'بوسيط تغير أسهمها (وزن متساوٍ)'}. «أبرزها» في الأضعف = الأكثر هبوطًا.</p>`;
  return section('industries', 'الصناعات الأقوى والأضعف', data, now, body);
}

const MOVER_TABS = { gainers: 'الأكثر ارتفاعًا', losers: 'الأكثر انخفاضًا', unusual_volume: 'حجم غير معتاد' };

function moversSection(data, ui, now) {
  const movers = data.movers ?? {};
  const tab = MOVER_TABS[ui.movers] ? ui.movers : 'gainers';
  const rows = list(movers[tab]);
  const tabs = html`<div class="seg ins-seg" role="group" aria-label="نوع الحركة">${Object.entries(MOVER_TABS).map(([k, label]) => html`<button type="button" data-movers="${k}" aria-pressed="${tab === k}" class="${tab === k ? 'is-active' : ''}">${label} <span class="count">${list(movers[k]).length}</span></button>`)}</div>`;
  const newsById = new Map(list(data.news).map((x) => [x.id, x]));
  const body = rows.length
    ? html`<div class="ins-scroll"><table class="ins-table"><thead><tr><th scope="col">السهم</th><th scope="col">السعر</th><th scope="col">التغير</th><th scope="col">حجم نسبي</th><th scope="col" class="opt">القيمة السوقية</th><th scope="col" class="opt">الصناعة</th><th scope="col">خبر</th></tr></thead>
      <tbody>${rows.map((r) => {
        const linked = list(r.news_ids).map((id) => newsById.get(id)).filter(Boolean);
        return html`<tr data-key="mv-${tab}-${r.symbol}"><th scope="row">${dossierLink(r.symbol)}<small class="ins-co" dir="auto" title="${r.company ?? ''}">${r.company ?? ''}</small></th>
          <td>${n(f.usd(r.price))}</td><td>${chg(r.chg_pct)}</td><td>${n(ratio(r.rel_volume), finite(r.rel_volume) && r.rel_volume >= 2 ? 'hot' : '')}</td>
          <td class="opt">${n(capM(r.market_cap_m))}</td><td class="opt"><small>${r.industry ?? f.DASH}</small></td>
          <td>${linked.length ? html`<button type="button" class="ins-news-link" data-news-symbol="${r.symbol}" title="${linked.map((x) => x.headline).join(' | ')}">${linked.length} خبر</button>` : html`<span class="muted">—</span>`}</td></tr>`;
      })}</tbody></table></div>
      <p class="note">اضغط الرمز لفتح ملفه في مساحة السوق. «خبر» يعرض الأخبار المطابقة للرمز؛ التزامن ليس دليلًا على السبب.</p>`
    : empty('لا توجد أسهم في هذه القائمة لهذه اللقطة.');
  return section('movers', 'الأسهم الأكثر حركة', data, now, body, { extra: tabs });
}

/** Evidence values are numbers (strings tolerated); unknown shows a dash. */
const evidenceValue = (v) => (finite(v) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v) : typeof v === 'string' && v ? v : f.DASH);

function trendsSection(data, now) {
  const trends = list(data.trends);
  const body = trends.length
    ? html`<ul class="ins-trends">${trends.map((t) => html`<li data-key="tr-${t.id}"><div class="ins-trend-head"><strong>${t.title_ar}</strong>${t.horizon ? html`<span class="badge">${HORIZON[t.horizon] ?? t.horizon}</span>` : ''}</div>
        ${t.detail_ar ? html`<p>${t.detail_ar}</p>` : ''}
        ${list(t.evidence).length ? html`<dl class="ins-evidence">${list(t.evidence).map((e) => html`<div><dt>${e.metric}</dt><dd dir="ltr">${evidenceValue(e.value)}</dd></div>`)}</dl>` : ''}</li>`)}</ul>
      <p class="note">ملاحظات تولّدها قواعد ثابتة من الأرقام أعلاه، وكل ملاحظة تعرض دليلها. ليست توقعًا للجلسة القادمة.</p>`
    : empty('لم تُطلق أي قاعدة ملاحظة في هذه اللقطة.');
  return section('trends', 'اتجاهات ملحوظة', data, now, body);
}

const NEWS_PAGE = 10;

function newsSection(data, ui, now) {
  const news = list(data.news);
  const facets = newsFacets(news);
  const shown = filterNews(news, ui);
  const option = (value, label, selected) => html`<option value="${value}" ${selected ? raw('selected') : ''}>${label}</option>`;
  const filters = html`<div class="ins-news-filters" role="group" aria-label="تصفية الأخبار">
    <label class="select"><span>القطاع</span><select data-news-filter="sector">${option('', 'الكل', !ui.sector)}${facets.sectors.map((s) => option(s, sectorName(data, s), s === ui.sector))}</select></label>
    <label class="select"><span>الصناعة</span><select data-news-filter="industry">${option('', 'الكل', !ui.industry)}${facets.industries.map((s) => option(s, s, s === ui.industry))}</select></label>
    <label class="search ins-news-search"><span class="sr-only">تصفية بالرمز</span><input data-news-filter="symbol" type="search" placeholder="رمز السهم" value="${ui.symbol}" autocomplete="off" spellcheck="false" dir="ltr"></label>
    ${ui.sector || ui.industry || ui.symbol ? html`<button type="button" class="btn ins-clear" data-news-clear>مسح التصفية</button>` : ''}
  </div>`;
  const item = (x) => html`<li class="ins-news-item" data-key="nw-${x.id}">
      <div class="ins-news-meta"><time datetime="${x.time}">${f.dateTime(x.time)}</time><span>${x.source ?? ''}</span>${finite(x.move_pct) ? html`<span class="ins-move ${f.tone(x.move_pct)}" title="تغير السهم المرتبط في الجلسة؛ تزامن لا سببية">حركة ${isSymbol(x.linked_symbol) ? html`<span dir="ltr">${x.linked_symbol}</span> ` : 'مرتبطة '}${n(f.pct(x.move_pct))}</span>` : ''}</div>
      <a class="ins-headline" href="${safeUrl(x.url)}" target="_blank" rel="noopener noreferrer" dir="auto">${x.headline}</a>
      ${x.summary ? html`<p class="ins-summary" dir="auto">${x.summary}</p>` : ''}
      <div class="ins-tags">${list(x.symbols).map((s) => dossierLink(s, 'ins-chip sym'))}${list(x.industries).map((s) => html`<button type="button" class="ins-chip" data-news-industry="${s}">${s}</button>`)}</div>
      ${x.impact_note_ar ? html`<p class="ins-impact">${x.impact_note_ar}</p>` : ''}
    </li>`;
  const body = news.length
    ? html`${filters}<p class="notice n-info ins-honest">الربط بين الخبر والحركة قائم على تطابق الرمز أو الصناعة وقرب التوقيت فقط، ولا يعني أن الخبر سبب الحركة.</p>
      ${shown.length ? html`<ol class="ins-news">${shown.slice(0, ui.newsAll ? shown.length : NEWS_PAGE).map(item)}</ol>` : empty('لا أخبار تطابق التصفية الحالية.')}
      ${shown.length > NEWS_PAGE ? html`<button type="button" class="btn ins-more" data-news-more>${ui.newsAll ? 'عرض أقل' : html`عرض المزيد (${n(shown.length - NEWS_PAGE)})`}</button>` : ''}
      <p class="note">${n(shown.length)} من ${n(news.length)} خبرًا${data.news_window?.from ? html` · النافذة من ${f.dateTime(data.news_window.from)} إلى ${f.dateTime(data.news_window.to)}` : ''} · الأوقات بتوقيت نيويورك · النصوص كما نشرها المصدر.</p>`
    : empty('لا تتوفر أخبار في هذا الملف.');
  return section('news', 'الأخبار', data, now, body, { wide: true });
}

function sectorName(data, sector) {
  return list(data.sectors).find((s) => s.sector === sector)?.name_ar ?? sector;
}

function themesSection(data, now) {
  const themes = list(data.themes);
  const body = themes.length
    ? html`<ul class="ins-themes">${themes.map((t) => {
        const scope = t.industry ?? t.sector;
        return html`<li data-key="th-${scope}-${t.title_ar}"><div class="ins-trend-head"><strong>${t.title_ar}</strong>${chg(t.avg_move_pct)}</div>
          <small dir="ltr" class="muted">${t.industry ? 'Industry' : 'Sector'}: ${scope ?? f.DASH}</small>
          <div class="ins-tags">${list(t.symbols).map((s) => dossierLink(s, 'ins-chip sym'))}</div>
          <button type="button" class="ins-news-link" ${raw(t.industry ? 'data-news-industry' : 'data-news-sector')}="${scope ?? ''}">${list(t.news_ids).length} خبر ←</button></li>`;
      })}</ul><p class="note">متوسط الحركة لأسهم الموضوع في الجلسة؛ تجميع للأخبار حسب الصناعة، لا تفسير سببي.</p>`
    : empty('لا توجد مجموعات أخبار تتركز في صناعة واحدة الآن.');
  return section('themes', 'موضوعات الأخبار حسب الصناعة', data, now, body);
}

const EARN_TIME = { 'pre-market': 'قبل الافتتاح', 'after-hours': 'بعد الإغلاق', during: 'أثناء الجلسة' };

function calendarSection(data, now) {
  const cal = data.calendar ?? {};
  const earnings = list(cal.earnings_today);
  const eco = list(cal.economic);
  const body = html`<div class="ins-cal">
    <div><h3>نتائج الأعمال</h3>${earnings.length
      ? html`<ul class="ins-cal-list">${earnings.map((e) => html`<li data-key="er-${e.symbol}">${dossierLink(e.symbol)}<span class="ins-co">${e.company ?? ''}</span><span class="badge">${EARN_TIME[e.time] ?? 'وقت غير معلن'}</span><span class="muted">EPS متوقع ${n(finite(e.eps_forecast) ? f.num(e.eps_forecast, 2) : f.DASH)}</span></li>`)}</ul>`
      : empty('لا نتائج أعمال مدرجة اليوم أو لم يُجلب التقويم.')}</div>
    <div><h3>البيانات الاقتصادية</h3>${eco.length
      ? html`<div class="ins-scroll"><table class="ins-table"><thead><tr><th scope="col">الوقت</th><th scope="col">الحدث</th><th scope="col">الفعلي</th><th scope="col">المتوقع</th><th scope="col">السابق</th></tr></thead>
        <tbody>${eco.map((e, i) => html`<tr data-key="eco-${i}"><td>${f.dateTime(e.time)}</td><td dir="ltr" class="ins-event">${e.event}</td><td>${n(e.actual ?? f.DASH, 'strong')}</td><td>${n(e.forecast ?? f.DASH)}</td><td>${n(e.previous ?? f.DASH)}</td></tr>`)}</tbody></table></div>`
      : empty('لا بيانات اقتصادية مدرجة اليوم.')}</div>
  </div>`;
  return section('calendar', cal.date ? html`تقويم جلسة ${n(cal.date)}` : 'تقويم اليوم', data, now, body);
}

// ---- page ----------------------------------------------------------------------------

/**
 * @param {{phase:'idle'|'loading'|'ok'|'error', data:object|null, error:string|null, loadedAt:number|null}} store
 * @param {typeof DEFAULT_INSIGHTS_UI} ui
 */
export function renderInsights(store, ui = DEFAULT_INSIGHTS_UI, now = Date.now()) {
  const data = store?.data;
  const head = html`<section class="intro ins-intro" data-key="ins-intro"><div><p class="eyebrow">نبض ← قطاعات ← أخبار</p><h1>رؤى السوق الأمريكي</h1>
      <p class="coverage-line">${data
        ? html`جلسة ${n(data.session ?? f.DASH)} · ${MARKET_STATE[data.market_state] ?? 'حالة غير معروفة'} · أُنتج الملف ${f.dateTime(data.generated_at)} نيويورك (قبل ${f.age(data.generated_at, now)})`
        : 'حقائق مؤرخة بمصادرها: المؤشرات، الاتساع، القطاعات، الأخبار والتقويم. لا توصيات شراء أو بيع.'}</p></div>
      <div class="intro-actions"><button type="button" class="btn btn-primary" data-insights-refresh ${store?.phase === 'loading' ? raw('disabled') : ''}>↻ تحديث</button></div></section>`;
  if (!data) {
    const msg = store?.phase === 'error'
      ? html`<div class="ins-card wide ins-failed" data-key="ins-failed"><h2>تعذر تحميل ملف الرؤى</h2><p>لم نتمكن من قراءة <code dir="ltr">data/insights.json</code> (${store.error ?? 'غير متاح'}). لا نعرض أرقامًا بديلة أو قديمة مخمنة. حاول التحديث بعد قليل؛ يُحدَّث الملف كل ١٥–٣٠ دقيقة أثناء أيام التداول.</p></div>`
      : html`<div class="ins-card wide ins-loading" data-key="ins-loading" aria-busy="true"><p>جارٍ تحميل رؤى السوق…</p></div>`;
    return html`${head}<div class="ins-grid">${msg}</div>`;
  }
  const overall = freshnessOf(data.generated_at, now);
  const warn = store.phase === 'error'
    ? html`<p class="notice n-warn" data-key="ins-refresh-fail">فشل آخر تحديث؛ المعروض هو آخر ملف ناجح.</p>` : '';
  const oldFile = overall.level !== 'ok'
    ? html`<p class="notice n-warn" data-key="ins-old">الملف كله أقدم من المتوقع (${f.age(data.generated_at, now)}). قد يكون خط البيانات متوقفًا؛ الأرقام صورة من وقتها.</p>` : '';
  const notes = list(data.notes_ar);
  const sources = list(data.sources);
  const foot = html`<section class="ins-card wide ins-foot" data-key="ins-foot"><details><summary>المصادر وحدود البيانات</summary>
      ${sources.length ? html`<ul class="ins-sources">${sources.map((s) => html`<li><strong dir="ltr">${s.name}</strong> · حتى ${f.dateTime(s.as_of)} نيويورك${s.delay_note ? html` · <span class="muted">${s.delay_note}</span>` : ''}</li>`)}</ul>` : empty('لم يذكر الملف مصادره.')}
      ${notes.length ? html`<ul class="ins-notes">${notes.map((x) => html`<li>${x}</li>`)}</ul>` : ''}
      <p class="note">كل الأرقام من الملف المنشور كما هي؛ القيم غير المعروفة تظهر «—» ولا تُستبدل بصفر. للمتابعة والتعلم، لا توصية استثمارية.</p></details></section>`;
  return html`${head}${warn}${oldFile}<div class="ins-grid">
    ${pulseSection(data, now)}${breadthSection(data, now)}${trendsSection(data, now)}${sectorsSection(data, ui, now)}
    ${industriesSection(data, now)}${moversSection(data, ui, now)}${newsSection(data, ui, now)}${themesSection(data, now)}${calendarSection(data, now)}${foot}
  </div>`;
}
