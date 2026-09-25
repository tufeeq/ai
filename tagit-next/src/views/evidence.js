// Research evidence for the methodology section: the corrected historical relabel and the
// forward record of live alerts. Numbers come from the published JSON files, never from here.
import { html } from '../html.js';
import * as f from '../format.js';

const n = (v) => f.num(v, 0);
const pctCell = (v) => html`<span class="${f.tone(v)}" dir="ltr">${f.pct(v)}</span>`;

function relabelTable(r) {
  const c = r.corrected?.[r.primary_entry_window];
  if (!c || !r.reproduced) return '';
  return html`<div class="evidence-card">
    <h4>التحقق التاريخي بعد التصحيح <small>٩٦ سهمًا مختارة مسبقًا · ١٠ جلسات · دقائق SIP المجمّعة · بروتوكول ${r.protocol}</small></h4>
    <table class="evidence-table">
      <thead><tr><th></th><th>الطريقة القديمة</th><th>بعد التصحيح</th></tr></thead>
      <tbody>
        <tr><th>إشارات لها نتيجة</th><td dir="ltr">${n(r.reproduced.frozen_scorable)} / ${n(r.reproduced.events)}</td><td dir="ltr">${n(c.resolved)} / ${n(c.signals)}</td></tr>
        <tr><th>نتيجة مجهولة</th><td dir="ltr">${n(r.reproduced.events - r.reproduced.frozen_scorable)}</td><td dir="ltr">${n(c.unknown)}</td></tr>
        <tr><th>دون دخول خلال دقيقتين</th><td>—</td><td dir="ltr">${n(c.no_entry)}</td></tr>
        <tr><th>متوسط ٣٠ دقيقة بعد التكلفة</th><td>${pctCell(r.reproduced.frozen_mean_return_after_cost_pct)}</td><td>${pctCell(c.mean_return_after_cost_pct)}</td></tr>
        <tr><th>إيجابية بعد التكلفة</th><td>—</td><td dir="ltr">${n(c.positive_after_cost)} / ${n(c.resolved)}</td></tr>
        <tr><th>الخطة (وقف / هدف ٢R / وقت)</th><td>—</td><td dir="ltr">${n(c.plan.stop)} / ${n(c.plan.target_2r)} / ${n(c.plan.time)} · ${f.num(c.plan.mean_r, 2)}R</td></tr>
      </tbody>
    </table>
    <p class="note">الطريقة القديمة أسقطت كل إشارة تنقصها دقيقة واحدة بلا صفقة، مع أن السعر في تلك الدقيقة هو آخر صفقة. التصحيح يحمل آخر سعر حتى الخروج بعد ٣٠ دقيقة أو عند الإغلاق، ويعيد إنتاج النتائج القديمة حرفيًا قبل التصحيح. تكلفة ٠٫٥ نقطة مفترضة، والعينة ١٠ جلسات فقط: دليل تطوير، وليس إثبات ربحية.</p>
  </div>`;
}

function forwardCard(fw) {
  const t = fw?.totals;
  if (!t || !t.days) {
    return html`<div class="evidence-card"><h4>السجل الحي للتنبيهات</h4><p class="note">يبدأ التسجيل التلقائي للتنبيهات الحية وتقييمها بعد الإغلاق يوميًا. لا توجد أيام مقيّمة بعد.</p></div>`;
  }
  const recent = [...fw.days].reverse().slice(0, 7);
  return html`<div class="evidence-card">
    <h4>السجل الحي للتنبيهات <small>آخر تحديث ${f.dateTime(fw.updated_at)}</small></h4>
    <div class="stats">
      <div class="stat"><span class="stat-label">أيام مقيّمة</span><strong class="stat-value">${n(t.days)}</strong></div>
      <div class="stat"><span class="stat-label">تنبيهات / لها نتيجة</span><strong class="stat-value" dir="ltr">${n(t.alerts)} / ${n(t.resolved)}</strong></div>
      <div class="stat"><span class="stat-label">متوسط بعد التكلفة</span><strong class="stat-value">${pctCell(t.mean_return_after_cost_pct)}</strong></div>
      <div class="stat"><span class="stat-label">الخطة</span><strong class="stat-value" dir="ltr">${n(t.plan_traded)} · ${f.num(t.plan_mean_r, 2)}R</strong></div>
    </div>
    <table class="evidence-table">
      <thead><tr><th>اليوم</th><th>تنبيهات</th><th>لها نتيجة</th><th>المتوسط</th><th>الخادم متاح</th></tr></thead>
      <tbody>${recent.map(({ summary: s }) => html`<tr><th dir="ltr">${s.date}</th><td>${n(s.alerts)}</td><td>${n(s.resolved)}</td><td>${pctCell(s.mean_return_after_cost_pct)}</td>
        <td dir="ltr">${n(s.health.reachable)} / ${n(s.health.samples)}</td></tr>`)}</tbody>
    </table>
    <p class="note">${fw.source}. نفس بروتوكول التصحيح؛ الأسعار ملاحظات وليست تنفيذًا.</p>
  </div>`;
}

function sipStudyCard(st) {
  if (!st?.totals) return '';
  const row = (label, x) => html`<tr><th>${label}</th><td dir="ltr">${n(x.signals)}</td><td dir="ltr">${n(x.resolved)}</td><td>${pctCell(x.mean_return_pct)}</td>
    <td dir="ltr">${x.win_rate === null ? '—' : f.num(x.win_rate * 100, 0) + '%'}</td><td dir="ltr">${n(x.plan_traded)} · ${f.num(x.plan_mean_r, 2)}R</td></tr>`;
  return html`<div class="evidence-card wide">
    <h4>الدراسة المجمّعة الموسّعة <small>${n(st.sessions)} جلسة (${st.first_session} → ${st.last_session}) · كل الأسهم المؤهلة · دقائق SIP · آخر تحديث ${f.dateTime(st.updated_at)}</small></h4>
    <table class="evidence-table">
      <thead><tr><th></th><th>إشارات</th><th>لها نتيجة</th><th>متوسط بعد التكلفة</th><th>نسبة الربح</th><th>الخطة</th></tr></thead>
      <tbody>
        ${row(`التطوير · عند الرصد (${n(st.split.development_sessions)} جلسة)`, st.development.at_detection)}
        ${row(`الاختبار اللاحق · عند الرصد (من ${st.split.holdout_from ?? '—'})`, st.holdout.at_detection)}
        ${row('الاختبار اللاحق · بعد تأخير ١٧ دقيقة', st.holdout.delayed)}
        ${row('الكل · عند الرصد', st.totals.at_detection)}
      </tbody>
    </table>
    <p class="note">"عند الرصد" يقيس الحركة بعد الإشارة مباشرة؛ "بعد التأخير" يدخل حين تصبح الإشارة المجانية مرئية. الاختبار اللاحق هو آخر ثلث الجلسات ولم يُستخدم لضبط أي شيء. الكون الحالي للأسهم يعني انحياز بقاء للجلسات السابقة، والتكلفة ٠٫٥ نقطة مفترضة.</p>
  </div>`;
}

const RULE_NAMES = {
  T10: 'خروج بعد ١٠ د', T30: 'خروج بعد ٣٠ د (الحالي)', T60: 'خروج بعد ٦٠ د', T120: 'خروج بعد ١٢٠ د',
  TRAIL3: 'وقف متحرك ٣٪', TRAIL5: 'وقف متحرك ٥٪', TRAIL8: 'وقف متحرك ٨٪', DSTOP60: 'وقف الكاشف أو ٦٠ د',
  TP5_SL3_60: 'هدف ٥٪ / وقف ٣٪', TP10_SL5_120: 'هدف ١٠٪ / وقف ٥٪', HALF5_TRAIL3: 'نصف عند ٥٪ ثم متحرك ٣٪',
};

function exitCard(x) {
  if (!x?.development?.now) return '';
  const ci = (s) => (s?.ci95 ? html`<small dir="ltr">[${f.num(s.ci95[0], 2)}, ${f.num(s.ci95[1], 2)}]</small>` : '');
  const rows = Object.keys(x.development.now).map((k) => {
    const d = x.development.now[k], h = x.holdout.now[k], hl = x.holdout.late?.[k];
    return html`<tr class="${k === x.selected_on_development ? 'is-picked' : ''}"><th>${RULE_NAMES[k] ?? k}${k === x.selected_on_development ? ' ★' : ''}</th>
      <td>${pctCell(d.mean_pct)}</td><td>${pctCell(h.mean_pct)} ${ci(h)}</td><td>${pctCell(hl?.mean_pct)}</td>
      <td dir="ltr">${h.win_rate === null ? '—' : f.num(h.win_rate * 100, 0) + '%'}</td></tr>`;
  });
  return html`<div class="evidence-card wide">
    <h4>دراسة طرق الخروج <small>${n(x.signals)} إشارة · ${n(x.sessions)} جلسة · الاختيار ★ على فترة التطوير فقط · بروتوكول ${x.protocol}</small></h4>
    <table class="evidence-table">
      <thead><tr><th>قاعدة الخروج</th><th>التطوير</th><th>الاختبار اللاحق (هامش ٩٥٪)</th><th>الاختبار بعد تأخير ١٧ د</th><th>نسبة الربح (اختبار)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="note">كل القواعد حُددت قبل رؤية النتائج، وتُعرض كلها على فترة الاختبار لا الفائزة وحدها. الهامش من إعادة سحب جلسات كاملة؛ إن احتوى الصفر فالفرق غير مؤكد. التكلفة ٠٫٥ نقطة مفترضة، وعند لمس الوقف والهدف في الدقيقة نفسها يُحسب الوقف.</p>
  </div>`;
}

export function renderEvidence(evidence) {
  if (!evidence.relabel && !evidence.forward && !evidence.sip && !evidence.exits) {
    return html`<p class="note">تعذر تحميل سجلات التحقق.</p>`;
  }
  return html`${exitCard(evidence.exits)}${sipStudyCard(evidence.sip)}${evidence.relabel ? relabelTable(evidence.relabel) : ''}${forwardCard(evidence.forward)}`;
}
