'use strict';
(function(){
  const BUILD='TAG558';
  const baseRender=window.render;
  if(typeof baseRender!=='function'){
    window.TAG500StateFinalizer={build:BUILD,ready:false,error:'RENDER_MISSING'};
    return;
  }
  let finalGeneration=0;
  window.render=function(){
    const result=baseRender.apply(this,arguments);
    const state=window.TAG500State&&typeof window.TAG500State==='object'?window.TAG500State:{};
    const analyzed=Array.isArray(window.analyzed)?window.analyzed:(Array.isArray(state.analyzed)?state.analyzed:[]);
    const rows=Array.isArray(window.rows)?window.rows:(Array.isArray(state.rows)?state.rows:[]);
    finalGeneration+=1;
    window.TAG500State={
      ...state,
      build:BUILD,
      phase:'FINAL',
      finalGeneration,
      rows,
      analyzed,
      analyzedCount:analyzed.length,
      finalizedAt:new Date().toISOString()
    };
    window.dispatchEvent(new CustomEvent('tag500:state-final',{detail:{build:BUILD,finalGeneration,analyzedCount:analyzed.length}}));
    return result;
  };
  window.TAG500StateFinalizer={build:BUILD,ready:true,source:'outermost-render-finalizer'};
})();
