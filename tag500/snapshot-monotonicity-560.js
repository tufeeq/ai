'use strict';
(function(){
  const RELEASE='TAG560';
  if(typeof loadData!=='function') return;

  const baseLoad=loadData;
  let lastAcceptedTs=0;
  let rejected=0;

  function tsOf(meta){
    const v=meta&&meta.updated;
    const t=v instanceof Date?v.getTime():Date.parse(v||'');
    return Number.isFinite(t)?t:0;
  }

  function cloneRows(v){ return Array.isArray(v)?v.slice():[]; }
  function cloneMeta(v){ return v&&typeof v==='object'?{...v}:v; }

  loadData=async function(){
    const beforeRows=cloneRows(typeof rows!=='undefined'?rows:[]);
    const beforeAnalyzed=cloneRows(typeof analyzed!=='undefined'?analyzed:[]);
    const beforeMeta=cloneMeta(typeof sourceMeta!=='undefined'?sourceMeta:null);
    const beforeTs=Math.max(lastAcceptedTs,tsOf(beforeMeta));

    await baseLoad.apply(this,arguments);

    const afterTs=tsOf(typeof sourceMeta!=='undefined'?sourceMeta:null);
    if(beforeTs&&afterTs&&afterTs<beforeTs){
      rejected++;
      if(typeof rows!=='undefined') rows=beforeRows;
      if(typeof analyzed!=='undefined') analyzed=beforeAnalyzed;
      if(typeof sourceMeta!=='undefined') sourceMeta=beforeMeta;
      if(typeof render==='function') render();
      const log=document.querySelector('#integrityLog');
      if(log){
        const item=document.createElement('div');
        item.className='log-item warn';
        item.textContent=`Snapshot Monotonicity: رفض لقطة أقدم (${new Date(afterTs).toLocaleString('ar-SA')}) بعد لقطة أحدث (${new Date(beforeTs).toLocaleString('ar-SA')}).`;
        log.prepend(item);
      }
      window.TAG500SnapshotMonotonicity={release:RELEASE,lastAcceptedTs:beforeTs,rejected,lastResult:'OUT_OF_ORDER_SNAPSHOT_REJECTED'};
      document.dispatchEvent(new CustomEvent('tag500:snapshot-rejected',{detail:{afterTs,beforeTs,rejected}}));
      return;
    }

    if(afterTs) lastAcceptedTs=Math.max(beforeTs,afterTs);
    window.TAG500SnapshotMonotonicity={release:RELEASE,lastAcceptedTs,rejected,lastResult:afterTs?'ACCEPTED':'NO_TIMESTAMP'};
  };

  window.TAG500SnapshotMonotonicity={release:RELEASE,lastAcceptedTs,rejected,lastResult:'READY'};
})();
