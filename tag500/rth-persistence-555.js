'use strict';
(function(){
  const BUILD='TAG555';
  const arr=v=>Array.isArray(v)?v:[];
  function sourceSession(z){return String(z?.raw?._session||'').toLowerCase();}
  function bucket(z){return String(z?.raw?._sessionBucket||'—');}
  function eligible(z){return z?.raw?._persistenceTrainingEligible===true||String(z?.raw?._persistenceTrainingEligible).toLowerCase()==='true';}
  function snapshot(){
    const a=arr(window.analyzed);
    const rth=a.filter(z=>sourceSession(z)==='regular');
    const central=rth.filter(z=>z?.persistenceAuthority?.ok||z?.centralPersistence).length;
    const eligibleRows=rth.filter(eligible).length;
    const b=rth[0]?bucket(rth[0]):'—';
    const cadence=String(rth[0]?.raw?._cadenceStatus||'UNKNOWN');
    const continuity=String(rth[0]?.raw?._bucketContinuityStatus||'UNKNOWN');
    return {count:rth.length,central,eligibleRows,bucket:b,cadence,continuity};
  }
  function render(){
    const log=document.querySelector('#integrityLog');
    if(!log) return;
    const s=snapshot();
    if(!s.count) return;
    const warmup=s.bucket==='R09'||s.continuity==='INITIAL_BUCKET';
    const state=s.central>0?'ACTIVE':warmup?'WARMUP':'WAITING_CONTIGUOUS_BUCKET';
    const text=state==='ACTIVE'
      ?`RTH Persistence ${BUILD}: ${s.central}/${s.count} حالة لديها Persistence مركزي مؤهل · bucket ${s.bucket} · cadence ${s.cadence} · continuity ${s.continuity}.`
      :state==='WARMUP'
        ?`RTH Persistence ${BUILD}: مرحلة warm-up في ${s.bucket}. لا EARLY_CONFIRMED مركزي قبل وصول bucket نظامي لاحق متصل (بدءًا من R10) مع cadence سليم.`
        :`RTH Persistence ${BUILD}: بانتظار bucket نظامي متصل؛ cadence ${s.cadence} · continuity ${s.continuity}. التأكيد التنفيذي يبقى محجوبًا ولا يستخدم LocalStorage كبديل.`;
    log.insertAdjacentHTML('beforeend',`<div class="log-item">${text}</div>`);
  }
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){baseRender();queueMicrotask(render);};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>queueMicrotask(render)); else queueMicrotask(render);
  window.TAG500RTHPersistence={build:BUILD,snapshot,diagnosticOnly:true};
})();
