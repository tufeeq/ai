'use strict';
(function(){
  const BUILD='TAG548';
  function currentSession(){
    try{return window.TAG500SessionClock?.state?.(Date.now())?.code||'UNKNOWN';}catch(_){return 'UNKNOWN';}
  }
  function n(v){return Number.isFinite(+v)?+v:null;}
  function gate(z){
    const inAH=currentSession()==='AH';
    const ahVolume=n(z?.ahVolume);
    const totalVolume=n(z?.volume);
    if(!inAH) return {inAH:false,pass:true,state:'NOT_AH',ahVolume,totalVolume,participation:null,takeover:null};
    if(!(ahVolume>0) || !(totalVolume>0)) return {inAH:true,pass:false,state:'AH_VOLUME_UNVERIFIED',ahVolume,totalVolume,participation:null,takeover:null};
    if(ahVolume>totalVolume) return {inAH:true,pass:false,state:'AMBIGUOUS_VOLUME_SEMANTICS',ahVolume,totalVolume,participation:null,takeover:null};
    const regularVolume=Math.max(0,totalVolume-ahVolume);
    const participation=ahVolume/totalVolume;
    const takeover=regularVolume>0?ahVolume/regularVolume:null;
    return {inAH:true,pass:true,state:'MEASURED',ahVolume,totalVolume,regularVolume,participation,takeover,takeoverActive:Number.isFinite(takeover)&&takeover>1};
  }
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function') window.analyze=function(x){
    const z=baseAnalyze(x);
    const g=gate(z);
    z.extendedHoursVolume=g;
    if(g.inAH&&!g.pass){
      if(z?.signalOrigin?.confirmation==='EARLY_CONFIRMED') z.signalOrigin.confirmation='EARLY_PENDING';
      z.reasons=z.reasons||[];
      z.reasons.push(g.state==='AMBIGUOUS_VOLUME_SEMANTICS'?'Extended-Hours Volume: تعارض دلالة الحجم؛ لا تأكيد AH':'Extended-Hours Volume: ahVolume غير متحقق؛ لا تأكيد AH');
    } else if(g.inAH&&g.pass){
      z.reasons=z.reasons||[];
      const p=(g.participation*100).toFixed(1);
      const t=Number.isFinite(g.takeover)?`${g.takeover.toFixed(2)}×`:'—';
      z.reasons.push(`After-Hours Volume Participation ${p}% · Extended-Hours Volume Takeover ${t}${g.takeoverActive?' ✓':''}`);
    }
    return z;
  };
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    const a=window.analyzed||[];
    const ah=a.filter(x=>x.extendedHoursVolume?.inAH);
    const measured=ah.filter(x=>x.extendedHoursVolume?.pass).length;
    const blocked=ah.length-measured;
    const takeover=ah.filter(x=>x.extendedHoursVolume?.takeoverActive).length;
    const log=document.querySelector('#integrityLog');
    if(log&&ah.length) log.insertAdjacentHTML('beforeend',`<div class="log-item">Extended-Hours Volume ${BUILD}: ${measured} حجم AH قابل للقياس · ${blocked} غير متحقق/متعارض · ${takeover} حالة Volume Takeover (AH volume &gt; estimated regular-session volume). لا threshold جديد للـscore؛ البيانات غير المتحققة تخفض التأكيد إلى pending.</div>`);
  };
  window.TAG500ExtendedHoursVolume={build:BUILD,gate};
})();