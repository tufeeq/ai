'use strict';
(function(){
  const BUILD='TAG540';
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze!=='function') return;
  function authority(z){
    const t=z?.temporal||null;
    if(!t) return {ok:false,source:'NONE',reason:'NO_TEMPORAL'};
    if(t.source==='CENTRAL_PIPELINE'){
      const count=Number(t.count),slope=Number(t.slope),retention=Number(t.retention);
      const usable=Number.isFinite(count)&&count>=2&&Number.isFinite(slope)&&Number.isFinite(retention);
      return {ok:usable,source:'CENTRAL_PIPELINE',reason:usable?'CENTRAL_CONFIRMED':'CENTRAL_INCOMPLETE'};
    }
    return {ok:false,source:t.source||'LOCAL_FALLBACK',reason:'LOCAL_RESEARCH_ONLY'};
  }
  window.analyze=function(x){
    const z=baseAnalyze(x),a=authority(z);
    z.persistenceAuthority=a;
    if(z.temporal&&!a.ok){
      z.temporalObservation={...z.temporal};
      z.temporal={...z.temporal,count:0,slope:null,retention:null,trajectory:'NO_HISTORY',confirmed:false,researchOnly:true,authorityReason:a.reason};
      z.centralPersistence=false;
      z.reasons=(z.reasons||[]).filter(s=>!/^Persistence |^Gain retention |^المسار:|^Persistence مركزي|^Gain retention مركزي|^المسار المركزي:/.test(String(s)));
      z.reasons.push('Persistence محلي محفوظ للبحث فقط؛ التأكيد التنفيذي يتطلب سجل pipeline مركزي مؤهل');
    }
    return z;
  };
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    const a=window.analyzed||[];
    const central=a.filter(z=>z.persistenceAuthority?.ok).length;
    const local=a.filter(z=>z.persistenceAuthority?.reason==='LOCAL_RESEARCH_ONLY').length;
    const incomplete=a.filter(z=>z.persistenceAuthority?.reason==='CENTRAL_INCOMPLETE').length;
    const log=document.querySelector('#integrityLog');
    if(log) log.insertAdjacentHTML('beforeend',`<div class="log-item">Persistence Authority ${BUILD}: ${central} بتأكيد مركزي مؤهل · ${local} fallback محلي Research Only · ${incomplete} سجل مركزي غير مكتمل. LocalStorage لا يستطيع منح EARLY_CONFIRMED. لا تغيير للـthresholds.</div>`);
  };
  window.TAG500PersistenceAuthority={build:BUILD,authority};
  window.dispatchEvent(new CustomEvent('tag500:runtime-ready',{detail:{layer:'persistenceAuthority',build:BUILD}}));
})();