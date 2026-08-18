'use strict';
(function(){
  const BUILD='TAG539';
  function truthy(v){return v===true||String(v).toLowerCase()==='true';}
  function continuity(raw){
    const cadence=String(raw?._cadenceStatus||'UNKNOWN').toUpperCase();
    const bucket=String(raw?._bucketContinuityStatus||'UNKNOWN').toUpperCase();
    const fieldIntegrity=String(raw?._extendedHoursFieldIntegrity||'UNKNOWN').toUpperCase();
    const eligible=truthy(raw?._persistenceTrainingEligible);
    const frozen=truthy(raw?._changeFieldFrozen)||truthy(raw?._volumeFieldFrozen);
    const pass=eligible&&cadence!=='GAP_ERROR'&&bucket!=='GAP_ERROR'&&!frozen;
    return {pass,cadence,bucket,fieldIntegrity,eligible,frozen};
  }
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function') window.analyze=function(x){
    const z=baseAnalyze(x),c=continuity(z?.raw||{}),t=z?.temporal||null;
    z.temporalContinuity=c;
    if(t?.source==='LOCAL_FALLBACK'&&!c.pass){
      z.temporalObserved={...t,source:'LOCAL_OBSERVATION_ONLY'};
      z.temporal={count:0,firstSeen:null,delta:null,slope:null,retention:null,trajectory:'NO_HISTORY',source:'CONTINUITY_BLOCKED'};
      z.centralPersistence=false;
      z.reasons=(z.reasons||[]).filter(s=>!/^Persistence |^Gain retention |^المسار:/.test(String(s)));
      z.reasons.push(`Persistence غير مؤكد: ${c.cadence==='GAP_ERROR'?'فجوة cadence':!c.eligible?'pipeline غير مؤهل للاستمرارية':c.frozen?'حقول مجمدة':'استمرارية غير موثقة'}`);
    }
    return z;
  };
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    const a=window.analyzed||[];
    const blocked=a.filter(z=>z.temporal?.source==='CONTINUITY_BLOCKED').length;
    const gap=a.filter(z=>z.temporalContinuity?.cadence==='GAP_ERROR').length;
    const log=document.querySelector('#integrityLog');
    if(log) log.insertAdjacentHTML('beforeend',`<div class="log-item">Temporal Continuity ${BUILD}: ${blocked} fallback محلي حُجب من تأكيد الإشارة · ${gap} حالة تحمل GAP_ERROR. LocalStorage يبقى للملاحظة فقط عند انقطاع cadence ولا يمنح EARLY_CONFIRMED.</div>`);
  };
  window.TAG500TemporalContinuity={build:BUILD,continuity};
})();