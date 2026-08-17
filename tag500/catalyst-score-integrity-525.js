'use strict';
(function(){
  const BUILD='TAG525';
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze!=='function') return;

  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(Number(v))?Number(v):0));
  function catalystState(z){
    const c=z?.catalystClock||{};
    const validCode=c.code==='FRESH_PRE_SIGNAL'||c.code==='RECENT_PRE_SIGNAL';
    const usable=validCode && c.attributionError!==true && Number(c.relevantCount||0)>0 && c.candidate;
    const rawAge=c.ageAtSignalHours;
    const age=rawAge!==null&&rawAge!==undefined&&Number.isFinite(Number(rawAge))?Number(rawAge):null;
    return {usable:Boolean(usable&&age!==null),age,code:c.code||'UNKNOWN'};
  }
  function corrected(z){
    const cat=catalystState(z);
    const catalystFresh=cat.usable?clamp(1-cat.age/72):0;
    const volumeFactor=clamp(Number(z.volAccel||0)/5);
    const floatFactor=clamp(Number(z.floatVelocity||0)/3);
    const rvolFactor=clamp(Math.log2(1+Math.max(0,Number(z.rvol||0)))/5);
    const persistence=clamp((Number(z.persistenceSlope)||0)/12+.5);
    const retention=clamp(Number(z.gainRetention)||0);
    const latePenalty=(z.originStatus==='LATE'||z.originStatus==='VERY_LATE')?0.20:0;
    const exhaustionPenalty=(z.stage==='EXHAUSTION'||z.stage==='LATE')?0.12:0;
    const early=Math.round(clamp(.30*volumeFactor+.20*floatFactor+.16*rvolFactor+.18*persistence+.16*retention+.10*catalystFresh-latePenalty-exhaustionPenalty)*100);
    const continuation=Math.round(clamp((early/100)*.60+.20*retention+.12*persistence+.08*catalystFresh)*100);
    return {early,continuation,catalystInput:cat.usable?'VALID_RELEVANT_PRE_SIGNAL_CATALYST':'CATALYST_CREDIT_ZERO',catalystCode:cat.code,catalystAgeAtSignalHours:cat.age};
  }

  window.analyze=function(row,ctx){
    const z=baseAnalyze(row,ctx);
    if(!z) return z;
    const c=corrected(z);
    z.rawEarlyRegimeScore=z.earlyRegimeScore;
    z.rawContinuationScore=z.continuationScore;
    z.earlyRegimeScore=c.early;
    z.continuationScore=c.continuation;
    z.catalystScoreInput=c.catalystInput;
    z.catalystScoreCode=c.catalystCode;
    z.catalystScoreAgeAtSignalHours=c.catalystAgeAtSignalHours;
    if((z.decision==='NOW'||z.decision==='FORMING')&&c.early<55) z.decision='WATCH';
    z.tags=Array.isArray(z.tags)?z.tags:[];
    z.tags=z.tags.filter(t=>!String(t).startsWith('Catalyst credit:'));
    z.tags.push('Catalyst credit: '+(c.catalystInput==='VALID_RELEVANT_PRE_SIGNAL_CATALYST'?'validated':'0'));
    return z;
  };

  window.__TAG500Corrections=window.__TAG500Corrections||{};
  window.__TAG500Corrections.catalystScoreIntegrity=BUILD;
  window.__TAG500Corrections.required=true;
  window.TAG500CatalystScoreIntegrity={version:BUILD,corrected,catalystState};
})();
