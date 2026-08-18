'use strict';
(function(){
  const BUILD='TAG547';
  function currentSession(){
    try{return window.TAG500SessionClock?.state?.(Date.now())?.code||'UNKNOWN';}catch(_){return 'UNKNOWN';}
  }
  function ahBuckets(z){
    const buckets=Array.isArray(z?.temporal?.buckets)?z.temporal.buckets:[];
    return [...new Set(buckets.map(x=>String(x).toUpperCase()).filter(x=>/^AH\d+$/.test(x)||x.includes('AFTER')) )];
  }
  function gate(z){
    const inAH=currentSession()==='AH';
    const buckets=ahBuckets(z);
    const count=buckets.length;
    const slope=Number.isFinite(z?.temporal?.slope)?z.temporal.slope:null;
    const retention=Number.isFinite(z?.temporal?.retention)?z.temporal.retention:null;
    const central=z?.temporal?.source==='CENTRAL_PIPELINE' || z?.centralPersistence===true;
    const pass=!inAH || (central && count>=2 && Number.isFinite(slope) && Number.isFinite(retention));
    return {inAH,pass,count,buckets,slope,retention,central};
  }
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function') window.analyze=function(x){
    const z=baseAnalyze(x);
    const g=gate(z);
    z.extendedHoursPersistence=g;
    if(g.inAH&&!g.pass){
      if(z?.signalOrigin?.confirmation==='EARLY_CONFIRMED') z.signalOrigin.confirmation='EARLY_PENDING';
      z.reasons=z.reasons||[];
      z.reasons.push(`Extended-Hours Persistence Gate: بانتظار مسارين AH مركزيين على الأقل (${g.count}/2)`);
    } else if(g.inAH&&g.pass){
      z.reasons=z.reasons||[];
      z.reasons.push(`Extended-Hours Persistence Gate ✓ · ${g.buckets.join('→')} · slope ${g.slope>=0?'+':''}${g.slope.toFixed(1)} · retention ${(g.retention*100).toFixed(0)}%`);
    }
    return z;
  };
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    const a=window.analyzed||[];
    const ah=a.filter(x=>x.extendedHoursPersistence?.inAH);
    const passed=ah.filter(x=>x.extendedHoursPersistence?.pass).length;
    const blocked=ah.length-passed;
    const log=document.querySelector('#integrityLog');
    if(log&&ah.length) log.insertAdjacentHTML('beforeend',`<div class="log-item">Extended-Hours Persistence ${BUILD}: ${passed} اجتازت البوابة · ${blocked} بانتظار ≥2 AH buckets مركزية. لا يمنح LocalStorage تأكيدًا تنفيذيًا في AH.</div>`);
  };
  window.TAG500ExtendedHoursPersistence={build:BUILD,gate};
})();