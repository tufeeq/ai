'use strict';
(function(){
 const URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/emergence-outcomes.json';
 const n=v=>Number.isFinite(Number(v))?Number(v):null;
 const median=a=>{const x=a.filter(Number.isFinite).sort((p,q)=>p-q);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2};
 function pct(v){return v==null?'—':v.toFixed(1)+'%'}
 function summarize(j){
   const s=Array.isArray(j.signals)?j.signals:[];
   const matured=s.filter(x=>(n(x.elapsedMin)||0)>=45);
   const mfe=matured.map(x=>n(x.subsequentMaxMovePct)).filter(Number.isFinite);
   const mae=matured.map(x=>n(x.subsequentMAEPct)).filter(Number.isFinite);
   const follow=matured.filter(x=>(n(x.subsequentMaxMovePct)||-999)>=5).length;
   const strong=matured.filter(x=>(n(x.subsequentMaxMovePct)||-999)>=10).length;
   const failed=matured.filter(x=>(n(x.subsequentMAEPct)||0)<=-6).length;
   const high=matured.filter(x=>(n(x.signalERS)||0)>=80&&(n(x.signalIgnition)||0)>=85);
   const highFollow=high.filter(x=>(n(x.subsequentMaxMovePct)||-999)>=5).length;
   return {matured,follow,strong,failed,medianMFE:median(mfe),medianMAE:median(mae),high,highFollow};
 }
 function render(j){
   const x=summarize(j); let sec=document.querySelector('[data-calibration30]');
   if(!sec){sec=document.createElement('section');sec.dataset.calibration30='1';sec.className='panel';const perf=document.querySelector('#performanceView');if(perf)perf.insertBefore(sec,perf.children[2]||null);else document.querySelector('#radarView')?.appendChild(sec)}
   const matureN=x.matured.length,followRate=matureN?100*x.follow/matureN:null,strongRate=matureN?100*x.strong/matureN:null,highRate=x.high.length?100*x.highFollow/x.high.length:null;
   const warn=highRate!=null&&highRate<25;
   sec.innerHTML='<h3>Challenger Calibration · V30</h3><div class="sub">Outcome-only layer. لا يغيّر ترتيب الفرص ولا يستخدم أي future data داخل scoring.</div><div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(145px,1fr))">'+
    '<div class="kpi"><small>Signals ≥45m</small><b>'+matureN+'</b></div>'+
    '<div class="kpi"><small>MFE ≥5%</small><b>'+pct(followRate)+'</b></div>'+
    '<div class="kpi"><small>MFE ≥10%</small><b>'+pct(strongRate)+'</b></div>'+
    '<div class="kpi"><small>Median MFE</small><b>'+pct(x.medianMFE)+'</b></div>'+
    '<div class="kpi"><small>High-score follow-through</small><b>'+pct(highRate)+'</b></div></div>'+
    '<div class="note" style="background:'+(warn?'#fef2f2':'#f8fafc')+';color:'+(warn?'#991b1b':'#475569')+'">'+
    (warn?'<b>Calibration warning:</b> ERS/Ignition المرتفعان وحدهما لا يثبتان actionability. أبقِ Persistence Critic إلزاميًا ولا ترقِّ thresholds من هذه الجلسة.':'البيانات غير كافية بعد لأي تعديل على Champion thresholds.')+
    ' · Median MAE '+pct(x.medianMAE)+' · Failed ≤-6%: '+x.failed+'</div>';
 }
 async function sync(){try{const r=await fetch(URL+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('outcomes '+r.status);render(await r.json())}catch(e){console.warn('TAGX calibration v30',e)}}
 window.TAGXOutcomeCalibrationV30={sync,summarize};sync();setInterval(sync,5*60*1000);
})();