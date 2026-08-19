'use strict';
(function(){
  const BUILD=(document.body&&document.body.dataset&&document.body.dataset.tagRelease)||'TAG559';
  const baseLoad=window.loadData;
  if(typeof baseLoad!=='function'){
    window.TAG500SnapshotOrder={build:BUILD,ready:false,error:'LOAD_DATA_MISSING'};
    return;
  }
  let lastAcceptedTs=Number.isFinite(new Date(window.sourceMeta?.updated).getTime())?new Date(window.sourceMeta.updated).getTime():0;
  let rejected=0;
  function cloneArray(v){return Array.isArray(v)?v.slice():[];}
  function snapshotState(){
    return {rows:cloneArray(window.rows),analyzed:cloneArray(window.analyzed),sourceMeta:window.sourceMeta?{...window.sourceMeta}:null,ts:Number.isFinite(new Date(window.sourceMeta?.updated).getTime())?new Date(window.sourceMeta.updated).getTime():0};
  }
  function validLoadedState(){
    const meta=window.sourceMeta||{};
    const ts=new Date(meta.updated).getTime();
    return meta.dataOrigin!=='failed'&&meta.name!=='none'&&Array.isArray(window.rows)&&window.rows.length>0&&Number.isFinite(ts)?ts:0;
  }
  function markReject(candidateTs,acceptedTs){
    rejected+=1;
    const meta=window.sourceMeta||{};
    const warnings=Array.isArray(meta.warnings)?meta.warnings.slice():[];
    warnings.push('OUT_OF_ORDER_SNAPSHOT_REJECTED');
    window.sourceMeta={...meta,warnings,orderIntegrity:'REJECTED_OLDER_SNAPSHOT',rejectedSnapshotTimestamp:new Date(candidateTs).toISOString(),acceptedSnapshotTimestamp:new Date(acceptedTs).toISOString()};
    const log=document.querySelector('#integrityLog');
    if(log){const item=document.createElement('div');item.className='log-item warn';item.textContent=`Snapshot Order Gate: رفض لقطة أقدم (${new Date(candidateTs).toLocaleString('ar-SA')}) والإبقاء على الأحدث (${new Date(acceptedTs).toLocaleString('ar-SA')}).`;log.prepend(item);}
    window.dispatchEvent(new CustomEvent('tag500:snapshot-rejected',{detail:{build:BUILD,candidateTs,acceptedTs,rejected}}));
  }
  window.loadData=async function(){
    const before=snapshotState();
    const acceptedBefore=Math.max(lastAcceptedTs,before.ts||0);
    const out=await baseLoad.apply(this,arguments);
    const candidateTs=validLoadedState();
    if(candidateTs&&acceptedBefore&&candidateTs<acceptedBefore){
      const candidateMeta=window.sourceMeta?{...window.sourceMeta}:{};
      window.rows=before.rows;
      window.analyzed=before.analyzed;
      window.sourceMeta=before.sourceMeta?{...before.sourceMeta}:candidateMeta;
      markReject(candidateTs,acceptedBefore);
      if(typeof window.render==='function')window.render();
      return {rejected:true,reason:'OUT_OF_ORDER_SNAPSHOT',candidateTs,acceptedTs:acceptedBefore};
    }
    if(candidateTs)lastAcceptedTs=Math.max(lastAcceptedTs,candidateTs);
    return out;
  };
  window.TAG500SnapshotOrder={build:BUILD,ready:true,getState:()=>({lastAcceptedTs,rejected})};
})();