'use strict';
(function(){
  const BUILD=(document.body&&document.body.dataset&&document.body.dataset.tagRelease)||'TAG558';
  const previousRender=window.render;
  if(typeof previousRender!=='function'){
    window.TAG500FinalState={build:BUILD,ready:false,error:'RENDER_MISSING'};
    return;
  }
  let depth=0;
  let generation=0;
  function finalize(){
    const current=window.TAG500State||{};
    generation=Math.max(generation+1,Number(current.generation)||0);
    const liveRows=Array.isArray(window.rows)?window.rows:(Array.isArray(current.rows)?current.rows:[]);
    const liveAnalyzed=Array.isArray(window.analyzed)?window.analyzed:(Array.isArray(current.analyzed)?current.analyzed:[]);
    window.TAG500State={
      ...current,
      build:BUILD,
      phase:'FINAL',
      generation,
      rows:liveRows,
      analyzed:liveAnalyzed,
      analyzedCount:liveAnalyzed.length,
      finalizedAt:new Date().toISOString()
    };
    const badge=document.getElementById('versionBadge');
    if(badge)badge.textContent=BUILD;
    document.title=BUILD+' — منصة TAG500';
    const footer=document.querySelector('footer strong');
    if(footer)footer.textContent=BUILD;
    window.dispatchEvent(new CustomEvent('tag500:state-final',{detail:{build:BUILD,generation,analyzedCount:liveAnalyzed.length}}));
  }
  window.render=function(){
    depth+=1;
    try{return previousRender.apply(this,arguments)}
    finally{
      depth-=1;
      if(depth===0)queueMicrotask(finalize);
    }
  };
  window.addEventListener('tag500:state-ready',function(){ if(depth===0)queueMicrotask(finalize); });
  window.TAG500FinalState={build:BUILD,ready:true,source:'outermost-render-finalizer'};
  if(window.TAG500State)queueMicrotask(finalize);
})();
