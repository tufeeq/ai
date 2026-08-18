'use strict';
(function(){
  const BUILD='TAG536';
  function n(v){
    if(v===null||v===undefined||v==='') return null;
    if(typeof v==='number') return Number.isFinite(v)?v:null;
    const x=Number(String(v).replace(/[$,%\s,]/g,''));
    return Number.isFinite(x)?x:null;
  }
  function clamp01(v){ return Number.isFinite(v)?Math.max(0,Math.min(1,v)):null; }
  function arr(v){ return Array.isArray(v)?v:[]; }
  function trajectory(slope,retention,count){
    if(!Number.isFinite(count)||count<2) return 'NO_HISTORY';
    if(Number.isFinite(slope)&&Number.isFinite(retention)&&slope>=3&&retention>=.75) return 'ACCELERATING';
    if(Number.isFinite(slope)&&Number.isFinite(retention)&&slope>=.5&&retention>=.65) return 'BUILDING';
    if((Number.isFinite(slope)&&slope<=-2)||(Number.isFinite(retention)&&retention<.55)) return 'FADING';
    return 'STABLE';
  }
  function central(z){
    const r=z?.raw||{};
    const eligible=r._persistenceTrainingEligible===true || String(r._persistenceTrainingEligible).toLowerCase()==='true';
    const points=arr(r._persistencePoints).map(n).filter(Number.isFinite);
    const buckets=arr(r._persistenceBuckets).filter(Boolean);
    const slope=n(r._persistenceSlopePctPts);
    const rawRetention=n(r._gainRetentionPct);
    const retention=Number.isFinite(rawRetention)?clamp01(rawRetention/100):null;
    const firstChange=n(r._firstObservedChange);
    const firstSeen=r._firstObservedTimestampET||r._firstObservedTimestampUTC||null;
    const count=Math.max(points.length,buckets.length);
    const usable=eligible && count>=2 && Number.isFinite(slope) && Number.isFinite(retention);
    if(!usable) return null;
    return {
      count,
      firstSeen: firstSeen?Date.parse(firstSeen):null,
      delta:Number.isFinite(z?.changePct)&&Number.isFinite(firstChange)?z.changePct-firstChange:null,
      slope,
      retention,
      trajectory:trajectory(slope,retention,count),
      source:'CENTRAL_PIPELINE',
      buckets,
      points,
      retentionRawPct:rawRetention
    };
  }
  function label(t){return {ACCELERATING:'يتسارع',BUILDING:'يبني',STABLE:'ثابت',FADING:'يتلاشى',NO_HISTORY:'غير كافٍ'}[t]||t;}
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function') window.analyze=function(x){
    const z=baseAnalyze(x);
    const c=central(z);
    if(c){
      z.temporalLocal=z.temporal||null;
      z.temporal=c;
      z.centralPersistence=true;
      z.reasons=(z.reasons||[]).filter(s=>!/^Persistence |^Gain retention |^المسار:/.test(String(s)));
      z.reasons.push(`Persistence مركزي ${c.slope>=0?'+':''}${c.slope.toFixed(1)} نقطة/ساعة`);
      z.reasons.push(`Gain retention مركزي ${(c.retention*100).toFixed(0)}%`);
      z.reasons.push(`المسار المركزي: ${label(c.trajectory)}`);
    } else {
      z.centralPersistence=false;
      if(z.temporal) z.temporal.source='LOCAL_FALLBACK';
    }
    return z;
  };
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    const a=window.analyzed||[];
    const centralCount=a.filter(x=>x.centralPersistence).length;
    const fallbackCount=a.filter(x=>x.temporal?.source==='LOCAL_FALLBACK').length;
    const clipped=a.filter(x=>x.centralPersistence&&Number.isFinite(x.temporal?.retentionRawPct)&&x.temporal.retentionRawPct>100).length;
    const log=document.querySelector('#integrityLog');
    if(log) log.insertAdjacentHTML('beforeend',`<div class="log-item">Central Persistence ${BUILD}: ${centralCount} سهم من سجل pipeline المركزي · ${fallbackCount} fallback محلي · ${clipped} retention فوق 100% طُبّع إلى 100% عند صنع قمة جديدة. لا تغيير للـthresholds.</div>`);
  };
  window.TAG500CentralTemporal={build:BUILD,central};
})();