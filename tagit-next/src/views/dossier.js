// The opportunity dossier: analysis, conditional plan, news and observed outcome.
import { html, safeUrl } from '../html.js';
import * as f from '../format.js';
import { finite, positive } from '../core/util.js';
import { CHECK_GROUPS, isExtended } from '../core/checks.js';
import { sizePosition } from '../core/sizing.js';
import { outcome } from '../core/journal.js';
import { shariaStatus } from '../core/sharia.js';
import { companyFacts } from '../core/risk.js';
import { assessRow, flowOf, selectedRow } from '../state.js';
import { STATE_HINTS, stateBadge, shariaBadge, meter, stat, riskFor } from './common.js';
import { samplesChart, planLadder } from './charts.js';

export const TABS = [
  ['overview', 'التحليل'],
  ['plan', 'الخطة'],
  ['news', 'الأخبار'],
  ['history', 'النتيجة'],
];

const NEWS_TOPICS = {
  FINANCING_OR_LISTING_RISK: 'تمويل / مخاطرة إدراج',
  CLINICAL_OR_REGULATORY: 'سريري / تنظيمي',
  EARNINGS: 'نتائج مالية',
  DEAL: 'صفقة / اتفاق',
  OTHER: 'خبر مرتبط',
};

function checkValue(c) {
  if (c.time) return f.time(c.value);
  if (finite(c.value)) {
    if (c.unit === '$') return f.compactUsd(c.value);
    return f.num(c.value, c.key === 'prints' ? 0 : 2) + (c.unit ?? '');
  }
  return typeof c.value === 'string' ? c.value : f.DASH;
}

const RISK_TEXT = { HIGH: 'مخاطر هيكلية ظاهرة', WATCH: 'إفصاحات تستحق الانتباه', NONE: 'لا إفصاحات خطرة في آخر ١٢٠ يومًا', UNKNOWN: 'لا بيانات إفصاح لهذا السهم' };

function riskSection(state, r, now) {
  const risk = riskFor(state, r, now);
  const e = state.enrichment;
  return html`<section class="risk-box rb-${risk.level}" data-key="risk-${r.symbol}">
    <h3>المخاطر والإفصاحات الرسمية <small>${RISK_TEXT[risk.level]}</small></h3>
    ${risk.items.length ? html`<ul class="risk-list">${risk.items.map((i) => html`<li class="ri-${i.level}">
      <b>${i.label}</b><span>${i.detail}${i.date ? html` · <span dir="ltr">${i.date}</span>` : ''}</span>
      ${i.url ? html`<a href="${safeUrl(i.url)}" target="_blank" rel="noopener noreferrer">المستند</a>` : ''}</li>`)}</ul>` : ''}
    <p class="note">${e
      ? html`المصادر: SEC EDGAR ودليل رموز ناسداك وFINRA · آخر تحديث ${f.dateTime(e.generated_at)}${risk.stale ? ' · البيانات أقدم من ٣٦ ساعة' : ''}. الإفصاح يصف ما قُدِّم رسميًا، ولا يثبت أثرًا على السعر.`
      : 'بيانات الإفصاحات غير محمّلة بعد.'}</p>
  </section>`;
}

function overview(state, r, a, now) {
  const s = r.signal;
  const facts = companyFacts(state.enrichment?.symbols?.[r.symbol], r);
  const cons = r.consolidated;
  const flow = flowOf(state, r.symbol, now);
  const sh = shariaStatus(r.sharia, now);
  const groups = Object.entries(CHECK_GROUPS).map(([key, title]) => {
    const checks = a.checks.filter((c) => c.group === key);
    return html`<section class="check-group"><h4>${title} <small>${checks.filter((c) => c.pass).length}/${checks.length}</small></h4>
      <ul>${checks.map((c) => html`<li class="${c.pass ? 'pass' : 'fail'}"><i aria-hidden="true">${c.pass ? '✓' : '✕'}</i><span>${c.name}</span><b dir="ltr">${checkValue(c)}</b></li>`)}</ul></section>`;
  });
  const flowTotal = (flow.up ?? 0) + (flow.down ?? 0);
  const upShare = flowTotal > 0 ? Math.round(((flow.up ?? 0) / flowTotal) * 100) : 50;
  const why = s?.ready
    ? `تحرك ${f.pct(s.return_3m)} خلال ٣ دقائق مكتملة، بحجم ${f.num(s.volume_ratio, 1)}× المعتاد وقيمة تداول ${f.compactUsd(s.dollars_3m)}.`
    : 'ظهر ضمن قائمة السوق، لكن بيانات الدقائق لا تكفي لتأكيد نمط انطلاق.';

  return html`
    <div class="decision d-${a.state}">
      <div class="decision-head">${stateBadge(a.state)}<span class="decision-score">${meter(a)}<b dir="ltr">${a.passed}/${a.total}</b></span></div>
      <p>${STATE_HINTS[a.state]}</p>
      ${a.blockers.length ? html`<p class="blockers"><b>ينقص الآن:</b> ${a.blockers.slice(0, 3).join('، ')}${a.blockers.length > 3 ? ` و${a.blockers.length - 3} غيرها` : ''}.</p>` : ''}
    </div>
    <h3>لماذا ظهر السهم؟</h3>
    <p class="why">${why}${isExtended(r) ? ' الحركة ممتدة؛ لا تُصنّف بداية مبكرة.' : ''}</p>
    ${riskSection(state, r, now)}
    <div class="checks">${groups}</div>
    <h3>السيولة التقديرية <small class="flow fl-${flow.status}">${flow.label}</small></h3>
    <div class="pressure" role="img" aria-label="ضغط شراء ${upShare}٪ مقابل ضغط بيع ${100 - upShare}٪">
      <span class="pressure-up" style="inline-size:${flowTotal > 0 ? upShare : 50}%"></span><span class="pressure-down"></span>
    </div>
    <div class="pressure-legend"><span>شراء <b dir="ltr">${f.compactUsd(flow.up)}</b></span><span>صافي <b dir="ltr">${f.compactUsd(flow.net)}</b></span><span>بيع <b dir="ltr">${f.compactUsd(flow.down)}</b></span></div>
    <p class="note">تقدير من الحجم الإضافي بين المسوحات وفق اتجاه السعر؛ يلزم ٣ عينات. تغطية IEX جزئية، ولا يثبت تدفق أموال فعليًا.</p>
    <h3>بيانات الشركة</h3>
    <div class="stats">
      ${stat('القيمة السوقية', facts.secMarketCap ? f.compactUsd(facts.secMarketCap) : positive(r.market_cap) ? f.compactUsd(r.market_cap) : f.DASH,
        facts.secMarketCap ? html`أسهم SEC × السعر · <span dir="ltr">${facts.sharesAsOf}</span>` : 'مرجع خارجي')}
      ${stat('الأسهم القائمة', facts.sharesOutstanding ? f.compact(facts.sharesOutstanding) : f.DASH, facts.sharesAsOf ? html`SEC · <span dir="ltr">${facts.sharesAsOf}</span>` : 'غير متاح')}
      ${stat('الأسهم الحرة', positive(r.float_shares) ? f.compact(r.float_shares) : f.DASH)}
      ${stat('حجم اليوم', cons?.volume ? f.compact(cons.volume) : f.compact(r.day_volume), cons?.volume ? 'مجمّع · كل البورصات' : 'IEX · جزئي')}
      ${stat('البيع المكشوف', facts.shortShares !== null ? f.compact(facts.shortShares) + (facts.shortOfFloat !== null ? ` · ${f.num(facts.shortOfFloat, 1)}%` : '') : finite(r.short_float_pct) ? f.num(r.short_float_pct) + '%' : f.DASH,
        facts.shortSettlement ? html`FINRA · تسوية <span dir="ltr">${facts.shortSettlement}</span>${facts.daysToCover !== null ? ` · ${f.num(facts.daysToCover, 1)} يوم تغطية` : ''}` : 'تاريخ القياس غير متاح')}
      ${stat('صفقات ٣ دقائق', f.num(s?.trades_3m, 0))}
      ${stat('متوسط النافذة المرجّح', f.usd(s?.vwap_window), 'ليس متوسط الجلسة')}
    </div>
    <details class="sharia-box" data-key="sharia-${r.symbol}">
      <summary>${shariaBadge(r, now)} ${sh.label}</summary>
      <p>${sh.status === 'UNKNOWN'
        ? 'لا تتوفر نتيجة فحص شرعي موثقة لهذا السهم. لا يُستنتج الامتثال من اسم الشركة أو قطاعها.'
        : html`الجهة: ${sh.source} · المنهج: ${sh.methodology} · المراجعة: ${f.dateTime(sh.reviewed_at)} · <a href="${safeUrl(sh.source_url)}" target="_blank" rel="noopener noreferrer">مصدر الفحص</a>`}</p>
    </details>
    <p class="note">مرجع الشركة: ${f.dateTime(r.metadata_at)}. اكتمال الشروط ليس احتمال ربح؛ التقييم المالي والإفصاحات الأصلية غير متصلة.</p>`;
}

function plan(state, r, a) {
  const p = a.plan;
  const s = r.signal;
  const entry = p?.entry ?? s?.trigger;
  const stop = p?.stop ?? s?.stop;
  const targets = p?.targets ?? (Array.isArray(s?.targets) ? s.targets : []);
  const levels = [
    { kind: 'target', value: targets[1], label: 'هدف ٢R' },
    { kind: 'target', value: targets[0], label: 'هدف ١R' },
    { kind: 'entry', value: entry, label: p ? 'التفعيل' : 'اختراق للمراقبة' },
    { kind: 'stop', value: stop, label: 'الإبطال' },
  ];
  const riskPct = positive(entry) && positive(stop) && entry > stop ? ((entry - stop) / entry) * 100 : null;
  const { capital, risk } = state.settings;
  const size = p ? sizePosition(p, Number(risk), Number(capital)) : null;
  let result;
  if (!p) result = html`<p class="calc-off">تعمل الحاسبة عند وجود خطة مستوفية فقط.</p>`;
  else if (!size) result = html`<p class="calc-off">أدخل رأس المال والخسارة القصوى بمبالغ موجبة.</p>`;
  else if (size.shares < 1) result = html`<p class="calc-off">حد الخسارة أو رأس المال لا يكفي لسهم واحد وفق هذه الخطة.</p>`;
  else {
    result = html`<div class="calc-result" role="status">
      <div class="calc-main"><strong dir="ltr">${f.num(size.shares, 0)}</strong><span>سهمًا · المحدِّد: ${size.limitedBy === 'RISK' ? 'حد الخسارة' : 'رأس المال'}</span></div>
      <div class="stats">
        ${stat('القيمة التقريبية', f.usd(size.notional))}
        ${stat('الخسارة المخططة', f.usd(size.plannedRisk))}
        ${stat('عند هدف ١R', size.rewards[0] !== undefined ? '+' + f.usd(size.rewards[0]) : f.DASH)}
        ${stat('عند هدف ٢R', size.rewards[1] !== undefined ? '+' + f.usd(size.rewards[1]) : f.DASH)}
      </div>
      <p class="note">قبل الرسوم والانزلاق. لا تضمن إمكان تنفيذ الكمية بهذا السعر، وقد يتجاوز التنفيذ الإبطال عند فجوة سعرية.</p>
    </div>`;
  }
  return html`
    <div class="decision d-${p ? 'READY' : a.state}">
      <div class="decision-head"><strong>${p ? 'خطة مشروطة متاحة الآن' : 'لا خطة مستوفية'}</strong></div>
      <p>${p
        ? 'التفعيل عند تجاوز المستوى مع استمرار السيولة. تُلغى الخطة عند كسر الإبطال أو تقادم البيانات.'
        : 'المستويات أدناه للمراقبة الفنية فقط، وليست توصية دخول.'}</p>
    </div>
    ${planLadder(levels, r.price)}
    <div class="stats">
      ${stat(p ? 'التفعيل' : 'اختراق للمراقبة', f.num(entry, 4))}
      ${stat('الإبطال', f.num(stop, 4), riskPct !== null ? html`مسافة <span dir="ltr">${f.num(riskPct)}%</span>` : '')}
      ${stat('الطلب / العرض', `${f.num(r.bid, 4)} / ${f.num(r.ask, 4)}`, 'IEX · ليس عمق السوق')}
      ${stat('فارق العرض والطلب', finite(r.spread_pct) ? f.num(r.spread_pct) + '%' : f.DASH)}
    </div>
    <h3>حاسبة الكمية وفق حدودك</h3>
    <form class="calc" data-key="calc" novalidate>
      <label>رأس المال المتاح ($)<input id="calc-capital" name="capital" type="text" inputmode="decimal" autocomplete="off" value="${capital}" placeholder="مثال: 5000" ${p ? '' : 'disabled'}></label>
      <label>أقصى خسارة مخططة ($)<input id="calc-risk" name="risk" type="text" inputmode="decimal" autocomplete="off" value="${risk}" placeholder="مثال: 50" ${p ? '' : 'disabled'}></label>
    </form>
    ${result}
    <p class="note">الأهداف مضاعفات للمخاطرة وليست توقعات. لا يوجد وقت وصول مثبت للهدف.</p>`;
}

function filingsList(state, r) {
  const filings = state.enrichment?.symbols?.[r.symbol]?.filings ?? [];
  if (!filings.length) return '';
  return html`<h3>آخر الإفصاحات لدى SEC</h3><ul class="filings">${filings.map((x) => html`<li>
    <span class="topic" dir="ltr">${x.form}</span><a href="${safeUrl(x.url)}" target="_blank" rel="noopener noreferrer" dir="ltr">${x.date}${x.items ? ` · items ${x.items}` : ''}</a></li>`)}</ul>`;
}

function news(state, r) {
  const items = r.news ?? [];
  return html`
    <p class="note">التصنيف حسب موضوع العنوان فقط، ولا يثبت إيجابية الخبر أو أنه سبب الحركة.</p>
    ${items.length
      ? html`<ul class="news">${items.map((n) => html`<li>
          <span class="topic">${NEWS_TOPICS[n.category] ?? NEWS_TOPICS.OTHER}</span>
          <a href="${safeUrl(n.url)}" target="_blank" rel="noopener noreferrer">${n.headline}</a>
          <small>${n.source} · نُشر ${f.dateTime(n.published_at)} · أول جلب ${f.dateTime(n.first_seen_at)}</small>
        </li>`)}</ul>`
      : html`<div class="empty-card"><strong>${r.catalyst_status === 'UNAVAILABLE' ? 'تعذر تحميل الأخبار' : 'لا خبر ضمن النتائج المسترجعة'}</strong><p>لا يعني ذلك غياب محفز، ولا يثبت العكس.</p></div>`}
    ${filingsList(state, r)}
    <h3>غير متحقق بعد</h3>
    <ul class="unknowns">
      <li>محتوى الإفصاحات ونتائج التجارب<span>عناوين النماذج فقط</span></li>
      <li>التقييم المالي والقيمة العادلة<span>غير محسوب</span></li>
    </ul>`;
}

function history(state, r) {
  const events = state.journal
    .filter((e) => e.symbol === r.symbol)
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .slice(0, 5);
  if (!events.length) {
    return html`<div class="empty-card"><strong>لا سجل لهذا السهم بعد</strong><p>أضفه للمتابعة ليبدأ الرصد عند وصول سعر حديث، أو انتظر تنبيهًا آليًا.</p></div>`;
  }
  return html`<p class="note">عينات أسعار أثناء فتح الصفحة فقط، وليست صفقات منفذة.</p>${events.map((e) => {
    const o = outcome(e);
    return html`<article class="event" data-key="ev-${e.id}">
      <header><strong>${e.kind === 'SIGNAL' ? 'تنبيه آلي' : 'متابعة يدوية'}</strong><span>${f.dateTime(e.started_at)}</span>
        <button class="icon-btn" data-remove-event="${e.id}" aria-label="حذف هذا السجل" title="حذف السجل">✕</button></header>
      <p>سعر الرصد <b dir="ltr">${f.usd(e.start_price)}</b> · آخر عينة <b dir="ltr">${f.usd(e.last_price)}</b> عند ${f.time(e.last_at)}</p>
      ${samplesChart(e)}
      <div class="stats">
        ${stat('التغير منذ الرصد', html`<span class="${f.tone(o.change)}" dir="ltr">${f.pct(o.change)}</span>`)}
        ${stat('أقصى صعود مرصود', html`<span class="up" dir="ltr">${f.pct(o.maximum)}</span>`)}
        ${stat('أقصى هبوط مرصود', html`<span class="down" dir="ltr">${f.pct(o.drawdown)}</span>`)}
        ${stat('المتبقي من أقصى مكسب', html`<span dir="ltr">${f.pct(o.retention)}</span>`, 'قد يصبح سالبًا')}
      </div>
    </article>`;
  })}`;
}

export function renderDossier(state, now) {
  const r = selectedRow(state);
  if (!r) {
    return html`<div class="dossier-empty"><span aria-hidden="true">◎</span><h2>اختر سهمًا</h2><p>ستجد هنا سبب ظهوره، شروطه، خطته، أخباره، ونتيجة متابعته.</p></div>`;
  }
  const a = assessRow(state, r, now);
  const tab = state.ui.tab;
  const body = r.placeholder
    ? html`<div class="empty-card"><strong>بانتظار بيانات هذا السهم</strong><p>يُطلب سعره تلقائيًا كل بضع ثوانٍ. إن لم يصل فقد يكون خارج نطاق الأسهم المؤهلة لدى الخادم.</p></div>`
    : tab === 'plan' ? plan(state, r, a)
    : tab === 'news' ? news(state, r)
    : tab === 'history' ? history(state, r)
    : overview(state, r, a, now);
  const watching = state.watched.has(r.symbol);
  return html`
    <header class="dossier-head">
      <button class="icon-btn sheet-close" data-close-sheet aria-label="رجوع إلى القائمة">→</button>
      <div class="dossier-title">
        <h2 dir="ltr">${r.symbol} ${shariaBadge(r, now)}</h2>
        <p>${r.name ?? ''}</p>
      </div>
      <div class="dossier-price">
        <strong dir="ltr">${f.usd(r.price)}</strong>
        <span class="chg ${f.tone(r.day_change)}" dir="ltr">${f.pct(r.day_change)}</span>
      </div>
    </header>
    <div class="dossier-meta">
      ${r.placeholder ? '' : stateBadge(a.state)}
      <span class="meta-age" data-age="${r.price_at ?? ''}"><i class="dot ${f.freshness(r.price_at, now, r.price_source)}"></i>آخر صفقة ${f.time(r.price_at)} · <span class="age-text">${f.age(r.price_at, now)}</span>${r.price_source ? html` · <span class="src">${r.price_source === 'CONSOLIDATED' ? 'مجمّع (ناسداك)' : 'IEX'}</span>` : ''}</span>
      <button class="btn ${watching ? 'btn-on' : ''}" data-watch="${r.symbol}" aria-pressed="${watching}">${watching ? '★ في المتابعة' : '☆ أضف للمتابعة'}</button>
    </div>
    <nav class="seg" role="tablist" aria-label="أقسام ملف السهم">${TABS.map(([id, label]) =>
      html`<button role="tab" data-tab="${id}" aria-selected="${tab === id}" class="${tab === id ? 'is-active' : ''}">${label}</button>`)}</nav>
    <div class="dossier-body" data-key="body-${r.symbol}-${tab}" role="tabpanel">${body}</div>`;
}

