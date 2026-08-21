'use strict';
(function(){
  const BUILD='TAG580';
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze!=='function') return;

  function truthy(v){ return v===true || String(v).toLowerCase()==='true'; }
  function provenance(z){
    const r=z?.raw||{};
    const hasCentral=z?.persistenceAuthority?.source==='CENTRAL_PIPELINE' || z?.temporal?.source==='CENTRAL_PIPELINE';
    if(!hasCentral) return {ok:false,reason:'NO_CENTRAL_PERSISTENCE',sourceCorrected:false};
    const sourceCorrected=truthy(r._gainRetentionSourceCorrected);
    const method=String(r._gainRetentionMethod||'');
    const peakMethod=method==='CURRENT_GAIN_OVER_MAX_POSITIVE_GAIN_IN_CONTIGUOUS_PATH';
    const value=Number(r._gainRetentionPct);
    const inRange=Number.isFinite(value)&&value>=0&&value<=100;
    return {
      ok:sourceCorrected&&peakMethod&&inRange,
      reason:sourceCorrected?(peakMethod?(inRange?'SOURCE_PEAK_RETENTION_VERIFIED':'SOURCE_RETENTION_OUT_OF_RANGE'):'SOURCE_RETENTION_METHOD_UNVERIFIED'):'SOURCE_CORRECTION_PENDING',
      sourceCorrected,method,value
    };
  }

  window.analyze=function(x){
    const z=baseAnalyze(x);
    const p=provenance(z);
    z.persistenceProvenance=p;
    if(z.persistenceAuthority?.ok && !p.ok){
      z.persistenceAuthority={...z.persistenceAuthority,ok:false,reason:p.reason};
      if(z.temporal){
        z.temporalObservation={...(z.temporalObservation||z.temporal)};
        z.temporal={...z.temporal,count:0,slope:null,retention:null,trajectory:'NO_HISTORY',confirmed:false,researchOnly:true,authorityReason:p.reason};
      }
      z.centralPersistence=false;
      z.reasons=(z.reasons||[]).filter(s=>!/^Persistence مركزي|^Gain retention مركزي|^المسار المركزي:/.test(String(s)));
      z.reasons.push('Persistence المركزي ينتظر إثبات تصحيح Gain Retention من المصدر؛ Research Only مؤقتًا');
    }
    return z;
  };

  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    const a=window.analyzed||[];
    const pending=a.filter(z=>z.persistenceProvenance?.reason==='SOURCE_CORRECTION_PENDING').length;
    const invalid=a.filter(z=>['SOURCE_RETENTION_OUT_OF_RANGE','SOURCE_RETENTION_METHOD_UNVERIFIED'].includes(z.persistenceProvenance?.reason)).length;
    const verified=a.filter(z=>z.persistenceProvenance?.ok).length;
    const log=document.querySelector('#integrityLog');
    if(log) log.insertAdjacentHTML('beforeend',`<div class="log-item">Persistence Provenance ${BUILD}: ${verified} مصدر peak-referenced موثق · ${pending} ينتظر تصحيح المصدر · ${invalid} Data Integrity hold. لا EARLY_CONFIRMED من retention خام أو غير موثق.</div>`);
  };

  window.TAG500PersistenceProvenance={build:BUILD,provenance};
  window.dispatchEvent(new CustomEvent('tag500:runtime-ready',{detail:{layer:'persistenceProvenance',build:BUILD}}));
})();
