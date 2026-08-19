'use strict';
(function(){
  const BUILD='TAG556';
  const n=v=>{
    if(v===null||v===undefined||v==='') return null;
    const x=Number(String(v).replace(/[$,%\s,]/g,''));
    return Number.isFinite(x)?x:null;
  };
  const arr=v=>Array.isArray(v)?v:[];
  const clamp01=v=>Number.isFinite(v)?Math.max(0,Math.min(1,v)):null;
  function correctedRetention(points){
    const p=arr(points).map(n).filter(Number.isFinite);
    if(p.length<2) return null;
    const positivePeak=Math.max(...p.filter(v=>v>0),0);
    const current=p[p.length-1];
    if(!(positivePeak>0)) return null;
    return clamp01(current/positivePeak);
  }
  function trajectory(slope,retention,count){
    if(!Number.isFinite(count)||count<2) return 'NO_HISTORY';
    if(Number.isFinite(slope)&&Number.isFinite(retention)&&slope>=3&&retention>=.75) return 'ACCELERATING';
    if(Number.isFinite(slope)&&Number.isFinite(retention)&&slope>=.5&&retention>=.65) return 'BUILDING';
    if((Number.isFinite(slope)&&slope<=-2)||(Number.isFinite(retention)&&retention<.55)) return 'FADING';
    return 'STABLE';
  }
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function') window.analyze=function(x){
    const z=baseAnalyze(x);
    const t=z?.temporal;
    if(t?.source==='CENTRAL_PIPELINE'&&Array.isArray(t.points)&&t.points.length>=2){
      const oldRetention=Number.isFinite(t.retention)?t.retention:null;
      const retention=correctedRetention(t.points);
      if(Number.isFinite(retention)){
        t.retentionLegacy=oldRetention;
        t.retention=retention;
        t.retentionMethod='CURRENT_GAIN_OVER_MAX_POSITIVE_GAIN_IN_CONTIGUOUS_PATH';
        t.trajectory=trajectory(t.slope,retention,t.count);
        z.reasons=(z.reasons||[]).filter(s=>!/^Gain retention مركزي /.test(String(s))&&!/^المسار المركزي:/.test(String(s)));
        z.reasons.push(`Gain retention مركزي ${(retention*100).toFixed(0)}% من قمة المسار`);
        z.reasons.push(`المسار المركزي: ${{ACCELERATING:'يتسارع',BUILDING:'يبني',STABLE:'ثابت',FADING:'يتلاشى',NO_HISTORY:'غير كافٍ'}[t.trajectory]||t.trajectory}`);
      }
    }
    return z;
  };
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    queueMicrotask(()=>{
      const a=arr(window.analyzed);
      const corrected=a.filter(z=>z?.temporal?.retentionMethod==='CURRENT_GAIN_OVER_MAX_POSITIVE_GAIN_IN_CONTIGUOUS_PATH');
      const materiallyLower=corrected.filter(z=>Number.isFinite(z.temporal.retentionLegacy)&&z.temporal.retentionLegacy-z.temporal.retention>=.15).length;
      const log=document.querySelector('#integrityLog');
      if(log) log.insertAdjacentHTML('beforeend',`<div class="log-item">Gain Retention ${BUILD}: ${corrected.length} مسار مركزي أعيد احتسابه مقابل أعلى مكسب داخل المسار بدل أول bucket · ${materiallyLower} حالة انخفض retention فيها ≥15 نقطة مئوية. لا تغيير للـthresholds.</div>`);
    });
  };
  window.TAG500GainRetention={build:BUILD,correctedRetention,method:'CURRENT_GAIN_OVER_MAX_POSITIVE_GAIN_IN_CONTIGUOUS_PATH'};
})();
