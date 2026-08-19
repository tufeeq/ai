'use strict';
(function(){
  const BUILD='TAG549';
  const n=v=>Number.isFinite(+v)?+v:null;
  const arr=v=>Array.isArray(v)?v:[];
  function trajectory(z){
    const r=z?.raw||{};
    const buckets=arr(r._ahVolumeBuckets).filter(Boolean);
    const points=arr(r._ahVolumePoints).map(n).filter(Number.isFinite);
    const participation=arr(r._ahVolumeParticipationPoints).map(n).filter(Number.isFinite);
    const count=Math.min(buckets.length,points.length);
    if(count<2) return {build:BUILD,verified:false,state:'INSUFFICIENT_AH_VOLUME_HISTORY',count,buckets,points,participation,slope:null,acceleration:null};
    const xs=points.slice(0,count);
    const bs=buckets.slice(0,count);
    const deltas=xs.slice(1).map((v,i)=>v-xs[i]);
    const slope=deltas.length?deltas.reduce((a,b)=>a+b,0)/deltas.length:null;
    const acceleration=deltas.length>=2?deltas[deltas.length-1]-deltas[deltas.length-2]:null;
    let state='STABLE';
    if(Number.isFinite(acceleration)) state=acceleration>0?'ACCELERATING':acceleration<0?'DECELERATING':'STABLE';
    else if(Number.isFinite(slope)) state=slope>0?'BUILDING':slope<0?'FADING':'STABLE';
    return {build:BUILD,verified:true,state,count,buckets:bs,points:xs,participation,slope,acceleration,deltas};
  }
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function') window.analyze=function(x){
    const z=baseAnalyze(x);
    const t=trajectory(z);
    z.ahVolumeTrajectory=t;
    if(window.TAG500SessionClock?.state?.(Date.now())?.code==='AH'){
      z.reasons=z.reasons||[];
      if(!t.verified) z.reasons.push('AH Volume Trajectory: سجل ساعة-بساعة غير كافٍ؛ لا استنتاج عن تسارع السيولة');
      else {
        const a=Number.isFinite(t.acceleration)?`${t.acceleration>=0?'+':''}${Math.round(t.acceleration).toLocaleString('en-US')}`:'—';
        z.reasons.push(`AH Volume Trajectory ${t.state} · buckets ${t.buckets.join('→')} · Δaccel ${a}`);
      }
    }
    return z;
  };
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    const a=window.analyzed||[];
    const rows=a.filter(x=>x.ahVolumeTrajectory);
    const verified=rows.filter(x=>x.ahVolumeTrajectory?.verified);
    const accel=verified.filter(x=>x.ahVolumeTrajectory?.state==='ACCELERATING').length;
    const decel=verified.filter(x=>x.ahVolumeTrajectory?.state==='DECELERATING').length;
    const log=document.querySelector('#integrityLog');
    if(log) log.insertAdjacentHTML('beforeend',`<div class="log-item">AH Volume Trajectory ${BUILD}: ${verified.length} سهم بسجل ساعة-بساعة قابل للقراءة · ${accel} يتسارع · ${decel} يتباطأ · ${rows.length-verified.length} بلا تاريخ كافٍ. المقياس وصفي فقط ولا يغيّر score أو Actionability حتى يتم اختباره متعدد الجلسات.</div>`);
  };
  window.TAG500AHVolumeTrajectory={build:BUILD,trajectory};
})();