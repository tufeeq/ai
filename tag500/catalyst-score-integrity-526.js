'use strict';
(function(){
  const BUILD='TAG526';
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze!=='function') return;

  const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,Number.isFinite(Number(v))?Number(v):0));
  function weighted(parts){
    let s=0,w=0;
    for(const [v,wt] of parts){ if(Number.isFinite(v)){ s+=v*wt; w+=wt; } }
    return w?s/w:null;
  }
  function catalystState(z){
    const c=z?.catalystClock||{};
    const validCode=c.code==='FRESH_PRE_SIGNAL'||c.code==='RECENT_PRE_SIGNAL';
    const ageRaw=c.ageAtSignalHours;
    const age=ageRaw!==null&&ageRaw!==undefined&&Number.isFinite(Number(ageRaw))?Math.max(0,Number(ageRaw)):null;
    const usable=validCode&&c.attributionError!==true&&Number(c.relevantCount||0)>0&&Boolean(c.candidate)&&age!==null;
    return {usable:Boolean(usable),age,code:c.code||'UNKNOWN'};
  }
  function catalystScore(age){
    if(!Number.isFinite(age)) return null;
    return age<=12?95:age<=36?75:age<=96?50:25;
  }
  function corrected(z){
    const cat=catalystState(z);
    const catalyst=cat.usable?catalystScore(cat.age):null;
    const volScore=Number.isFinite(z.prevVolRatio)?clamp(Math.log2(1+Math.max(0,z.prevVolRatio))*22):Number.isFinite(z.volumeRank)?z.volumeRank:null;
    const gapScore=Number.isFinite(z.gapPct)?clamp(Math.max(0,z.gapPct)*1.2):null;
    const prior=Number.isFinite(z.prevSessionChangePct)?clamp(50+z.prevSessionChangePct*2):null;
    const changeComponent=Number.isFinite(z.changePct)?clamp(55+z.changePct*.5):null;
    let early=weighted([[volScore,.35],[gapScore,.25],[catalyst,.20],[prior,.20]]);
    let continuation=weighted([[volScore,.35],[catalyst,.25],[prior,.20],[changeComponent,.20]]);
    if(Number.isFinite(z.changePct)&&z.changePct>100&&Number.isFinite(early)) early=clamp(early-20);
    const score=weighted([[early,.42],[z.ignition,.30],[continuation,.20],[Number.isFinite(z.exhaustion)?100-z.exhaustion:null,.08]]);
    return {early,continuation,score,catalystInput:cat.usable?'VALID_RELEVANT_PRE_SIGNAL_CATALYST':'CATALYST_NEUTRAL',catalystCode:cat.code,catalystAgeAtSignalHours:cat.age};
  }

  window.analyze=function(row,ctx){
    const z=baseAnalyze(row,ctx);
    if(!z) return z;
    const c=corrected(z);
    z.rawEarlyBeforeCatalystGate=z.early;
    z.rawContinuationBeforeCatalystGate=z.continuation;
    z.rawScoreBeforeCatalystGate=z.score;
    if(Number.isFinite(c.early)) z.early=c.early;
    if(Number.isFinite(c.continuation)) z.continuation=c.continuation;
    if(Number.isFinite(c.score)) z.score=c.score;
    z.earlyRegimeScore=z.early;
    z.continuationScore=z.continuation;
    z.catalystScoreInput=c.catalystInput;
    z.catalystScoreCode=c.catalystCode;
    z.catalystScoreAgeAtSignalHours=c.catalystAgeAtSignalHours;
    z.reasons=Array.isArray(z.reasons)?z.reasons:[];
    z.reasons=z.reasons.filter(r=>!String(r).startsWith('Catalyst score gate:'));
    z.reasons.push('Catalyst score gate: '+(c.catalystInput==='VALID_RELEVANT_PRE_SIGNAL_CATALYST'?'validated':'neutral/no credit'));
    return z;
  };

  window.__TAG500Corrections=window.__TAG500Corrections||{};
  window.__TAG500Corrections.catalystScoreIntegrity=BUILD;
  window.__TAG500Corrections.required=true;
  window.TAG500CatalystScoreIntegrity={version:BUILD,corrected,catalystState};
})();
