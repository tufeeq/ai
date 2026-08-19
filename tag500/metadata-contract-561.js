'use strict';
(function(){
  const BUILD='TAG561';
  let installed=false,error='';
  try{
    const prior=Object.getOwnPropertyDescriptor(window,'sourceMeta');
    if(prior && prior.configurable===false && typeof prior.get!=='function') throw new Error('WINDOW_SOURCE_META_NON_CONFIGURABLE');
    Object.defineProperty(window,'sourceMeta',{
      configurable:true,
      enumerable:false,
      get(){return sourceMeta;},
      set(v){sourceMeta=v;}
    });
    installed=true;
  }catch(e){error=e?.message||String(e);}
  function state(){
    const m=installed?(sourceMeta||{}):{};
    const ts=new Date(m.updated||0).getTime();
    return {build:BUILD,ready:installed,error,updated:Number.isFinite(ts)&&ts>0?new Date(ts).toISOString():null,fresh:m.fresh===true,sessionAligned:m.sessionAligned!==false,reconciliation:m.reconciliation||'UNKNOWN',independentSourceCount:Number(m.independentSourceCount||0),trainingEligible:m.trainingEligible===true,dataOrigin:m.dataOrigin||'unknown'};
  }
  function publish(){
    window.TAG500MetadataState=state();
    window.dispatchEvent(new CustomEvent('tag500:metadata-ready',{detail:window.TAG500MetadataState}));
  }
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){const out=baseRender.apply(this,arguments);publish();return out;};
  window.TAG500MetadataContract={build:BUILD,ready:installed,error,getState:state,publish};
  publish();
})();
