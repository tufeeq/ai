// Research evidence is separate from live prices; this module cannot create signals.
const method=document.querySelector('.method details');
if(method){
 const performance=document.createElement('a');performance.href='performance.html';performance.textContent='سجل الأداء التاريخي والورقي';method.append(performance);
 const notice=document.createElement('p');notice.id='phase1-evidence';
 notice.textContent='المرحلة الأولى للتحقق: لم تكتمل بعد. جارٍ تحميل سجل الدليل المؤرخ…';method.append(notice);
 fetch(new URL('./phase1-evidence.json',import.meta.url),{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('Evidence unavailable');return r.json();}).then(e=>{
  if(e.phase1_complete!==false||e.profitability_claim_allowed!==false||e.signals!==e.evaluable+e.unevaluable||!Number.isFinite(e.resolved_expectancy_pct))throw Error('Unsupported evidence');
  notice.textContent=`سجل التحقق بتاريخ ${e.as_of}: أُعيد إنتاج خط الأساس (${e.signals} إشارة؛ ${e.evaluable} قابلة للتقييم و${e.unevaluable} ناقصة). متوسط الحالات القابلة للتقييم ${e.resolved_expectancy_pct.toFixed(2)}٪ بعد تكلفة افتراضية؛ ليس ربحيةً لكل الإشارات ولا اختبارًا للهدف والوقف. المرحلة الأولى غير مكتملة، ولم يُفتح الاختبار النهائي. `;
  const link=document.createElement('a');link.href='https://github.com/tufeeq/ai/blob/tagit-next-independent-20260914/tagit-next/PHASE1_REPORT.md';link.textContent='المصدر والمنهجية وطريقة إعادة الإنتاج';notice.append(link);
 }).catch(()=>{notice.textContent='تعذر تحميل سجل التحقق المؤرخ. المرحلة الأولى غير مكتملة؛ لا يوجد دليل معتمد على الربحية.';});
}
