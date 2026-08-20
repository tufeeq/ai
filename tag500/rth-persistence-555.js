'use strict';
(function(){
  const BUILD='TAG568';
  const arr=v=>Array.isArray(v)?v:[];
  const num=v=>{if(v===null||v===undefined||v==='')return null;const x=Number(String(v).replace(/[$,%\s,]/g,''));return Number.isFinite(x)?x:null;};
  const clamp01=v=>Number.isFinite(v)?Math.max(0,Math.min(1,v)):null;
  function sourceSession(z){return String(z?.raw?._session||'').toLowerCase();}
  function bucket(z){return String(z?.raw?._sessionBucket||'—');}
  function eligible(z){return z?.raw?._persistenceTrainingEligible===true||String(z?.raw?._persistenceTrainingEligible).toLowerCase()==='true';}
  function correctedRetention(points){
    const p=arr(points).map(num).filter(Number.isFinite);
    if(p.length<2)return null;
    const positive=p.filter(v=>v>0);
    const peak=positive.length?Math.max(...positive):null;
    const current=p[p.length-1];
    if(!Number.isFinite(peak)||peak<=0)return null;
    if(!Number.isFinite(current)||current<=0)return 0;
    return clamp01(current/peak);
  }
  function sourceRetentionIntegrity(rawPct,corrected){
    if(!Number.isFinite(corrected))return{state:'UNVERIFIED',deltaPct:null,material:false};
    if(!Number.isFinite(rawPct))return{state:'SOURCE_VALUE_MISSING',deltaPct:null,material:false};
    const correctedPct=corrected*100;
    const delta=Math.abs(rawPct-correctedPct);
    const invalidRange=rawPct<0||rawPct>100;
    const material=invalidRange||delta>=5;
    return{state:material?'DATA_INTEGRITY_ERROR':'OK',deltaPct:Math.round(delta*10)/10,material,rawPct,correctedPct:Math.round(correctedPct*10)/10};
  }
  function trajectory(slope,retention,count){
    if(!Number.isFinite(count)||count<2)return'NO_HISTORY';
    if(Number.isFinite(slope)&&Number.isFinite(retention)&&slope>=3&&retention>=.75)return'ACCELERATING';
    if(Number.isFinite(slope)&&Number.isFinite(retention)&&slope>=.5&&retention>=.65)return'BUILDING';
    if((Number.isFinite(slope)&&slope<=-2)||(Number.isFinite(retention)&&retention<.55))return'FADING';
    return'STABLE';
  }
  function trajectoryLabel(t){return{ACCELERATING:'يتسارع',BUILDING:'يبني',STABLE:'ثابت',FADING:'يتلاشى',NO_HISTORY:'غير كافٍ'}[t]||t;}
  function syncReleaseIdentity(){try{document.documentElement.dataset.rthPersistenceModule=BUILD;}catch(_){}}
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function')window.analyze=function(x){
    const z=baseAnalyze(x);
    const t=z?.temporal;
    if(t?.source==='CENTRAL_PIPELINE'&&Array.isArray(t.points)&&t.points.length>=2){
      const oldRetention=Number.isFinite(t.retention)?t.retention:null;
      const rawLegacy=num(z?.raw?._gainRetentionPct);
      const retention=correctedRetention(t.points);
      if(Number.isFinite(retention)){
        const integrity=sourceRetentionIntegrity(rawLegacy,retention);
        t.retentionLegacy=oldRetention;
        t.retentionRawLegacyPct=rawLegacy;
        t.retention=retention;
        t.retentionRawPct=Math.round(retention*1000)/10;
        t.retentionMethod='CURRENT_GAIN_OVER_MAX_POSITIVE_GAIN_IN_CONTIGUOUS_PATH';
        t.trajectory=trajectory(t.slope,retention,t.count);
        t.sourceRetentionIntegrity=integrity;
        if(z.raw&&typeof z.raw==='object'){
          z.raw._gainRetentionPctLegacy=rawLegacy;
          z.raw._gainRetentionPct=t.retentionRawPct;
          z.raw._gainRetentionMethod='CURRENT_GAIN_OVER_MAX_POSITIVE_GAIN_IN_CONTIGUOUS_PATH';
          z.raw._gainRetentionIntegrity='NORMALIZED_AT_TAG500_BOUNDARY';
          z.raw._sourcePersistenceIntegrity=integrity.state;
          z.raw._sourceGainRetentionMismatchPct=integrity.deltaPct;
          if(integrity.material){
            z.raw._trainingEligible=false;
            z.raw._dataIntegrityState='DATA_INTEGRITY_ERROR';
          }
        }
        if(integrity.material){
          z.trainingEligible=false;
          z.dataIntegrityError=true;
          z.reasons=(z.reasons||[]).filter(s=>!/^Source Gain Retention/.test(String(s)));
          z.reasons.push(`Source Gain Retention mismatch ${integrity.deltaPct?.toFixed?.(1)??integrity.deltaPct}pp — training blocked`);
        }
        z.reasons=(z.reasons||[]).filter(s=>!/^Gain retention مركزي /.test(String(s))&&!/^المسار المركزي:/.test(String(s)));
        z.reasons.push(`Gain retention مركزي ${(retention*100).toFixed(0)}% من قمة المسار`);
        z.reasons.push(`المسار المركزي: ${trajectoryLabel(t.trajectory)}`);
      }
    }
    return z;
  };
  function snapshot(){
    const a=arr(window.analyzed);
    const centralAll=a.filter(z=>z?.temporal?.retentionMethod==='CURRENT_GAIN_OVER_MAX_POSITIVE_GAIN_IN_CONTIGUOUS_PATH');
    const rawNormalized=centralAll.filter(z=>z?.raw?._gainRetentionIntegrity==='NORMALIZED_AT_TAG500_BOUNDARY').length;
    const rawWasOver100=centralAll.filter(z=>Number.isFinite(z?.temporal?.retentionRawLegacyPct)&&z.temporal.retentionRawLegacyPct>100).length;
    const sourceErrors=centralAll.filter(z=>z?.raw?._sourcePersistenceIntegrity==='DATA_INTEGRITY_ERROR').length;
    const rth=a.filter(z=>sourceSession(z)==='regular');
    const central=rth.filter(z=>z?.persistenceAuthority?.ok||z?.centralPersistence).length;
    const eligibleRows=rth.filter(eligible).length;
    const corrected=rth.filter(z=>z?.temporal?.retentionMethod==='CURRENT_GAIN_OVER_MAX_POSITIVE_GAIN_IN_CONTIGUOUS_PATH');
    const materiallyLower=corrected.filter(z=>Number.isFinite(z.temporal.retentionLegacy)&&z.temporal.retentionLegacy-z.temporal.retention>=.15).length;
    const b=rth[0]?bucket(rth[0]):'—';
    const cadence=String(rth[0]?.raw?._cadenceStatus||'UNKNOWN');
    const continuity=String(rth[0]?.raw?._bucketContinuityStatus||'UNKNOWN');
    return{count:rth.length,central,eligibleRows,corrected:corrected.length,materiallyLower,bucket:b,cadence,continuity,centralAll:centralAll.length,rawNormalized,rawWasOver100,sourceErrors};
  }
  function render(){
    syncReleaseIdentity();
    const log=document.querySelector('#integrityLog');if(!log)return;
    const s=snapshot();
    if(s.centralAll)log.insertAdjacentHTML('beforeend',`<div class="log-item">Gain Retention Integrity ${BUILD}: ${s.rawNormalized}/${s.centralAll} مسار مركزي طُبّع إلى current÷peak · ${s.sourceErrors} حالة source mismatch محجوبة من التدريب · ${s.rawWasOver100} قيمة خام كانت >100%. لا تغيير للـthresholds.</div>`);
    if(!s.count)return;
    const warmup=s.bucket==='R09'||s.continuity==='INITIAL_BUCKET';
    const state=s.central>0?'ACTIVE':warmup?'WARMUP':'WAITING_CONTIGUOUS_BUCKET';
    const text=state==='ACTIVE'
      ?`RTH Persistence ${BUILD}: ${s.central}/${s.count} حالة لديها Persistence مركزي مؤهل · ${s.corrected} retention مصحح مقابل قمة المسار · ${s.materiallyLower} حالة انخفض retention فيها ≥15 نقطة مئوية · bucket ${s.bucket} · cadence ${s.cadence} · continuity ${s.continuity}.`
      :state==='WARMUP'
        ?`RTH Persistence ${BUILD}: مرحلة warm-up في ${s.bucket}. لا EARLY_CONFIRMED مركزي قبل bucket نظامي لاحق متصل. Gain Retention عند التفعيل يقاس من قمة المسار لا من أول bucket.`
        :`RTH Persistence ${BUILD}: بانتظار bucket نظامي متصل؛ cadence ${s.cadence} · continuity ${s.continuity}. التأكيد التنفيذي يبقى محجوبًا ولا يستخدم LocalStorage كبديل.`;
    log.insertAdjacentHTML('beforeend',`<div class="log-item">${text}</div>`);
  }
  const baseRender=window.render;
  if(typeof baseRender==='function')window.render=function(){baseRender();queueMicrotask(render);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>queueMicrotask(render));else queueMicrotask(render);
  syncReleaseIdentity();
  window.TAG500RTHPersistence={build:BUILD,snapshot,correctedRetention,sourceRetentionIntegrity,retentionMethod:'CURRENT_GAIN_OVER_MAX_POSITIVE_GAIN_IN_CONTIGUOUS_PATH',rawBoundaryNormalization:true,sourceMismatchFailClosed:true,releaseMutation:false};
  window.TAG500GainRetention={build:BUILD,correctedRetention,sourceRetentionIntegrity,method:'CURRENT_GAIN_OVER_MAX_POSITIVE_GAIN_IN_CONTIGUOUS_PATH',rawBoundaryNormalization:true,sourceMismatchFailClosed:true};
})();
