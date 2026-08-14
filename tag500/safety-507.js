'use strict';
(function(){
  const MAX_FEED_AGE_MIN=20;
  const priorAnalyze=window.analyze;
  if(typeof priorAnalyze==='function'){
    window.analyze=function(x){
      const z=priorAnalyze(x);
      const sh=String(x?.sharia||'UNVERIFIED').toUpperCase();
      if(sh!=='VERIFIED'){
        z.valid=false;
        z.score=null;
        z.executionEligible=false;
        z.trainingEligible=false;
        z.reasons=Array.isArray(z.reasons)?z.reasons:[];
        const msg=sh==='EXCLUDED'?'مستبعد شرعيًا':'غير متحقق شرعيًا — Research Only';
        if(!z.reasons.includes(msg)) z.reasons.unshift(msg);
      }else{
        z.executionEligible=Boolean(z.valid);
        z.trainingEligible=false;
      }
      return z;
    };
  }

  const priorLoad=window.loadData;
  if(typeof priorLoad==='function'){
    window.loadData=async function(){
      await priorLoad();
      const updated=window.sourceMeta?.updated instanceof Date?window.sourceMeta.updated:null;
      const ageMin=updated&&Number.isFinite(updated.getTime())?(Date.now()-updated.getTime())/60000:Infinity;
      const stale=!Number.isFinite(ageMin)||ageMin>MAX_FEED_AGE_MIN;
      if(stale){
        window.rows=[];
        window.analyzed=[];
        try{ window.render?.(); }catch(_e){}
        const badge=document.querySelector('#dataBadge');
        const status=document.querySelector('#finvizStatus');
        const log=document.querySelector('#integrityLog');
        if(badge){badge.textContent='● البيانات: قديمة / متوقفة';badge.classList.remove('connected');}
        if(status){status.className='connector-status err';status.textContent=`تم إيقاف الترتيب: عمر لقطة السوق ${Number.isFinite(ageMin)?Math.round(ageMin)+' دقيقة':'غير معروف'} (الحد ${MAX_FEED_AGE_MIN} دقيقة).`;}
        if(log){log.innerHTML=`<div class="log-item warn">FRESHNESS GATE: البيانات غير صالحة للترتيب أو التدريب. الحد ${MAX_FEED_AGE_MIN} دقيقة.</div>`;}
      }else{
        const log=document.querySelector('#integrityLog');
        if(log) log.insertAdjacentHTML('beforeend',`<div class="log-item">Freshness Gate: PASS · عمر اللقطة ${Math.max(0,Math.round(ageMin))} دقيقة.</div><div class="log-item">Sharia Gate: VERIFIED فقط مؤهل للترتيب التنفيذي؛ UNVERIFIED = Research Only.</div><div class="log-item">Final Snapshot Reconciliation: غير مكتمل أثناء intraperiod؛ Training Eligible = false حتى المطابقة النهائية.</div>`);
      }
    };
  }
})();
