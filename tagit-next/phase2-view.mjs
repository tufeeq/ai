// Format development evidence only. This module cannot rank or emit live signals.

/**
 * Headline of the evidence page, computed only from the published study files (data/*.json).
 * Missing files give null values, never zeros. Returns { kpis:[{key,label,value,hint,tone}], verdict, held:[...] }.
 */
export function evidenceSummary({ sip = null, exits = null, filters = null, daily = null, fade = null, paper = null } = {}) {
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  const pp = (v) => (fin(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : null);
  const int = (v) => (fin(v) ? Math.round(v).toLocaleString('en-US') : '—');
  const tone = (v) => (fin(v) ? (v > 0 ? 'up' : v < 0 ? 'down' : '') : '');
  const kpis = [];
  const h = sip?.holdout?.at_detection;
  kpis.push({ key: 'sip', label: 'إشارات الدقائق · العينة المختومة', value: pp(h?.mean_return_pct), tone: tone(h?.mean_return_pct),
    hint: h ? `${int(h.signals)} إشارة · ${int(sip.split?.holdout_sessions)} جلسة منذ ${sip.split?.holdout_from ?? '—'} · بعد تكلفة ${sip.cost_pp ?? 0.5} نقطة` : 'ملف الدراسة غير متاح' });
  const x = exits?.selected_holdout;
  kpis.push({ key: 'exit', label: 'أفضل قاعدة خروج · المختومة', value: pp(x?.mean_pct), tone: tone(x?.mean_pct),
    hint: x ? `${exits.selected_on_development ?? '—'} (اختيرت على التطوير) · ${int(x.trades)} صفقة` : 'ملف الدراسة غير متاح' });
  const held = filters ? (filters.candidates ?? []).filter((c) => c.holds).length : null;
  kpis.push({ key: 'filters', label: 'تركيبات فلاتر صمدت', value: filters ? `${held} / ${int(filters.combinations_tested)}` : null, tone: held ? 'up' : filters ? 'down' : '',
    hint: filters ? `بلا فلتر: ${pp(filters.baseline?.holdout?.mean_pct) ?? '—'} في المختومة` : 'ملف الدراسة غير متاح' });
  const b = paper?.books?.SIP_DELAYED?.all;
  kpis.push({ key: 'paper', label: 'السجل الورقي الأمامي', value: fin(b?.net_usd) ? `${b.net_usd < 0 ? '-' : '+'}$${Math.abs(b.net_usd).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : null, tone: tone(b?.net_usd),
    hint: b ? `${int(b.trades)} صفقة · ${int(paper.sessions)} جلسة · رأس مال $${int(paper.account?.capital)} · منها تكاليف $${int(b.cost_usd)}` : 'ملف السجل غير متاح' });
  const buyRulesFailed = [
    fin(h?.mean_return_pct) ? h.mean_return_pct < 0 : null, fin(x?.mean_pct) ? x.mean_pct < 0 : null,
    filters ? !filters.any_candidate_holds : null, daily ? !daily.holds : null, fade?.short ? !fade.short.holds : null,
  ];
  const known = buyRulesFailed.filter((v) => v !== null).length;
  const allFailed = known === 5 && buyRulesFailed.every(Boolean);
  const heldFindings = [];
  const av = fade?.avoid;
  if (av?.holds && av.primary?.holdout) heldFindings.push(`الشراء في الأسهم الممتدة (${av.primary.flag}) أسوأ من غيره بـ ${pp(av.primary.holdout.diff_pct)} خلال ${av.primary.horizon_days} أيام في العينة المختومة: هذه قاعدة تجنّب، لا قاعدة ربح.`);
  const verdict = allFailed
    ? 'لم تصمد أي قاعدة شراء أو بيع على المكشوف في العينة المختومة بعد التكلفة. الأرقام أدناه سالبة، وهي النتيجة الفعلية وليست خطأ في العرض.'
    : known < 5 ? 'بعض ملفات الدراسات غير متاح؛ لا يُستنتج من الغياب شيء.' : 'راجع كل دراسة أدناه؛ لا تعني نتيجة موجبة في مرحلة واحدة اكتمال التحقق.';
  return { kpis, verdict, held: heldFindings };
}
const titles = {core_session:'استبعاد أول وآخر 30 دقيقة', momentum_atr:'الحركة ≥ وحدة تقلب سابقة واحدة'};
const finite = n => typeof n === 'number' && Number.isFinite(n);
const pct = n => n === null ? 'غير متاح' : `${n.toFixed(2)}٪`;
const interval = values => values === null ? 'غير متاح' : `[${values.map(v=>v.toFixed(3)).join(', ')}]`;
function counts(c){
 if(!c||!['signals','evaluable','missing_outcomes'].every(k=>Number.isSafeInteger(c[k])&&c[k]>=0)||
 c.signals!==c.evaluable+c.missing_outcomes||
 (c.evaluable ? !finite(c.conditional_mean_pct) : c.conditional_mean_pct!==null)||
 (c.missing_outcomes>0&&c.all_signal_expectancy_pct!==null))throw Error('INVALID_COUNTS');
}
function checkInterval(a){if(a!==null&&(!Array.isArray(a)||a.length!==2||!a.every(finite)||a[0]>a[1]))throw Error('INVALID_INTERVAL');}
export function comparisonRows(e){
 if(e?.status!=='DEVELOPMENT_DIAGNOSTIC_ONLY'||e.profitability_claim_allowed!==false||e.live_rules_changed!==false||
 e.holdout_opens!==0||e.independent_validation!==null||e.final_configuration!==null||
 typeof e.as_of!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(e.as_of)||e.comparisons?.length!==2)throw Error('UNSUPPORTED_EVIDENCE');
 counts(e.full_baseline);const seen=new Set();
 return e.comparisons.map(c=>{
  if(!titles[c.id]||seen.has(c.id)||c.decision!=='NOT_APPROVED_DEVELOPMENT_ONLY')throw Error('UNSUPPORTED_COMPARISON');seen.add(c.id);
  for(const k of ['selected','excluded','unknown_feature','same_observable_population_baseline'])counts(c[k]);
  for(const k of ['signals','evaluable','missing_outcomes']){
   if(c.selected[k]+c.excluded[k]+c.unknown_feature[k]!==e.full_baseline[k]||
    c.selected[k]+c.excluded[k]!==c.same_observable_population_baseline[k])throw Error('DENOMINATOR_MISMATCH');
  }
  const b=c.bootstrap;
  if(b?.family_size!==2||b.per_interval_confidence!==.975||b.p_adjusted!==null||b.confirmatory_significance!=='NOT_ELIGIBLE')throw Error('UNSUPPORTED_INFERENCE');
  checkInterval(b.effect_ci95_percentage_points);checkInterval(b.effect_family_adjusted_ci_percentage_points);
  if(c.effect_percentage_points!==null&&!finite(c.effect_percentage_points))throw Error('INVALID_EFFECT');
  const p=c.same_observable_population_baseline, s=c.selected;
  const expected=s.evaluable&&p.evaluable?s.conditional_mean_pct-p.conditional_mean_pct:null;
  if(expected===null?c.effect_percentage_points!==null:!finite(c.effect_percentage_points)||Math.abs(c.effect_percentage_points-expected)>1e-10)throw Error('EFFECT_MISMATCH');
  return [titles[c.id],`${s.signals} / ${s.evaluable} / ${s.missing_outcomes}`,pct(p.conditional_mean_pct),pct(s.conditional_mean_pct),
   c.effect_percentage_points===null?'غير متاح':c.effect_percentage_points.toFixed(3),interval(b.effect_ci95_percentage_points),
   interval(b.effect_family_adjusted_ci_percentage_points),String(c.unknown_feature.signals)];
 });
}
