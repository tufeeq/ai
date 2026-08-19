'use strict';
(function(){
  const BUILD='TAG560';
  if(typeof loadData!=='function'){
    window.TAG500SnapshotOrder={build:BUILD,ready:false,error:'LOAD_DATA_MISSING'};
    return;
  }
  const baseLoad=loadData;
  let lastAcceptedTs=Number.isFinite(new Date(sourceMeta?.updated).getTime())?new Date(sourceMeta.updated).getTime():0;
  let rejected=0;

  const cloneArray=v=>Array.isArray(v)?v.slice():[];
  function tsOf(meta){const t=new Date(meta?.updated).getTime();return Number.isFinite(t)?t:0;}
  function snapshotState(){return{rows:cloneArray(rows),analyzed:cloneArray(analyzed),sourceMeta:sourceMeta?{...sourceMeta}:null,ts:tsOf(sourceMeta)};}
  function validLoadedState(){
    const meta=sourceMeta||{};
    const ts=tsOf(meta);
    return meta.dataOrigin!=='failed'&&meta.name!=='none'&&Array.isArray(rows)&&rows.length>0&&ts?ts:0;
  }
  function markReject(candidateTs,acceptedTs){
    rejected+=1;
    const meta=sourceMeta||{};
    const warnings=Array.isArray(meta.warnings)?meta.warnings.slice():[];
    warnings.push('OUT_OF_ORDER_SNAPSHOT_REJECTED');
    sourceMeta={...meta,warnings,orderIntegrity:'REJECTED_OLDER_SNAPSHOT',rejectedSnapshotTimestamp:new Date(candidateTs).toISOString(),acceptedSnapshotTimestamp:new Date(acceptedTs).toISOString()};
    const log=document.querySelector('#integrityLog');
    if(log){
      const item=document.createElement('div');
      item.className='log-item warn';
      item.textContent=`Snapshot Order Gate: رفض لقطة أقدم (${new Date(candidateTs).toLocaleString('ar-SA')}) والإبقاء على الأحدث (${new Date(acceptedTs).toLocaleString('ar-SA')}).`;
      log.prepend(item);
    }
    window.dispatchEvent(new CustomEvent('tag500:snapshot-rejected',{detail:{build:BUILD,candidateTs,acceptedTs,rejected}}));
  }

  loadData=async function(){
    const before=snapshotState();
    const acceptedBefore=Math.max(lastAcceptedTs,before.ts||0);
    const out=await baseLoad.apply(this,arguments);
    const candidateTs=validLoadedState();
    if(candidateTs&&acceptedBefore&&candidateTs<acceptedBefore){
      const candidateMeta=sourceMeta?{...sourceMeta}:{};
      rows=before.rows;
      analyzed=before.analyzed;
      sourceMeta=before.sourceMeta?{...before.sourceMeta}:candidateMeta;
      markReject(candidateTs,acceptedBefore);
      if(typeof render==='function')render();
      return {rejected:true,reason:'OUT_OF_ORDER_SNAPSHOT',candidateTs,acceptedTs:acceptedBefore};
    }
    if(candidateTs)lastAcceptedTs=Math.max(lastAcceptedTs,candidateTs);
    window.TAG500SnapshotOrderState={build:BUILD,lastAcceptedTs,rejected,lastResult:candidateTs?'ACCEPTED':'NO_TIMESTAMP'};
    return out;
  };

  window.TAG500SnapshotOrder={build:BUILD,ready:true,authority:'canonical-lexical-state',getState:()=>({lastAcceptedTs,rejected})};
})();
