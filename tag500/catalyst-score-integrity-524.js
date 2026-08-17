'use strict';
(function(){
  const BUILD='TAG524';
  const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
  function weighted(parts){
    let w=0,s=0;
    for(const [v,weight] of parts){if(Number.isFinite(v)){s+=v*weight;w+=weight;}}
    return w?s/w:null;
  }
  function catalystValue(c){
    if(!c||!['FRESH_PRE_SIGNAL','RECENT_PRE_SIGNAL'].includes(c.code)) return null;
    const age=Number(c.ageAtSignalHours);
    if(!Number.isFinite(age)) return null;
    return age<=12?95:age<=36?75:age<=96?50:null;
  }
  function corrected(z){
    const trustedCat=catalystValue(z.catalystClock);
    const volScore=Number.isFinite(z.prevVolRatio)?clamp(Math.log2(1+z.prevVolRatio)*22):Number.isFinite(z.volumeRank)?z.volumeRank:null;
    const gapScore=Number.isFinite(z.gapPct)?clamp(Math.max(0,z.gapPct)*1.2):null;
    const prior=Number.isFinite(z.prevSessionChangePct)?clamp(50+z.prevSessionChangePct*2):null;
    let early=weighted([[volScore,.35],[gapScore,.25],[trustedCat,.20],[prior,.20]]);
    const continuation=weighted([[volScore,.35],[trustedCat,.25],[prior,.20],[Number.isFinite(z.changePct)?clamp(55+z.changePct*.5):null,.20]]);
    if(Number.isFinite(z.changePct)&&z.changePct>100&&Number.isFinite(early)) early=clamp(early-20);
    const score=weighted([[early,.42],[z.ignition,.30],[continuation,.20],[Number.isFinite(z.exhaustion)?100-z.exhaustion:null,.08]]);
    return {trustedCat,early,continuation,score};
  }
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function') window.analyze=function(x){
    const z=baseAnalyze(x);
    const before={early:z.early,continuation:z.continuation,score:z.score};
    const c=corrected(z);
    if(Number.isFinite(c.early)) z.early=c.early;
    if(Number.isFinite(c.continuation)) z.continuation=c.continuation;
    if(Number.isFinite(c.score)) z.score=c.score;
    const delta=Number.isFinite(before.score)&&Number.isFinite(z.score)?z.score-before.score:null;
    z.catalystScoreIntegrity={build:BUILD,eligible:Boolean(Number.isFinite(c.trustedCat)),trustedCatalystValue:c.trustedCat,scoreBefore:before.score,scoreAfter:z.score,delta};
    if(!Number.isFinite(c.trustedCat)&&Number.isFinite(x.catalystAgeHours)){
      z.reasons=z.reasons||[];
      z.reasons.push('Catalyst Score Gate: الخبر الخام لم يُمنح وزنًا قبل اجتياز الارتباط والتوقيت');
    } else if(Number.isFinite(c.trustedCat)){
      z.reasons=z.reasons||[];
      z.reasons.push(`Catalyst Score Gate: محفز مرتبط وصحيح زمنيًا · قيمة ${c.trustedCat}`);
    }
    return z;
  };
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    const a=Array.isArray(window.analyzed)?window.analyzed:[];
    const correctedRows=a.filter(z=>Number.isFinite(z.catalystScoreIntegrity?.delta)&&Math.abs(z.catalystScoreIntegrity.delta)>=0.5);
    const removed=a.filter(z=>z.catalystScoreIntegrity&&!z.catalystScoreIntegrity.eligible&&Number.isFinite(z.catalystAgeHours)).length;
    const trusted=a.filter(z=>z.catalystScoreIntegrity?.eligible).length;
    const log=document.querySelector('#integrityLog');
    if(log) log.insertAdjacentHTML('beforeend',`<div class="log-item">Catalyst→Score Integrity ${BUILD}: trusted=${trusted} · raw-news-credit-removed=${removed} · score-adjusted=${correctedRows.length}. الأخبار غير المرتبطة/بعد الإشارة/غير المحسومة لا ترفع Early Regime أو Continuation.</div>`);
  };
})();