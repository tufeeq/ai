// Format development evidence only. This module cannot rank or emit live signals.
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
