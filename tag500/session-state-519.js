'use strict';
(function(){
  const BUILD='TAG519';
  function etParts(ts){
    const d=new Date(ts||Date.now());
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(d);
    return Object.fromEntries(parts.map(p=>[p.type,p.value]));
  }
  function minutesET(ts){const p=etParts(ts);return Number(p.hour)*60+Number(p.minute);}
  function sessionState(ts){
    const p=etParts(ts),m=minutesET(ts),wd=p.weekday;
    if(['Sat','Sun'].includes(wd)) return {code:'CLOSED',label:'السوق مغلق'};
    if(m<240) return {code:'CLOSED',label:'قبل pre-market'};
    if(m<570) return {code:'PRE',label:'Pre-market'};
    if(m<960) return {code:'RTH',label:'Regular session'};
    if(m<1200) return {code:'AH',label:'After-hours'};
    return {code:'FINAL',label:'After-hours closed'};
  }
  function sourceSession(){
    const u=window.sourceMeta?.updated;
    if(!u) return {code:'UNKNOWN',label:'وقت المصدر غير معروف'};
    return sessionState(new Date(u).getTime());
  }
  function recState(){return String(window.sourceMeta?.reconciliation||'UNKNOWN').toUpperCase();}
  function finalReconciled(){return ['FINAL_RECONCILED','RECONCILED','MATCHED','PASS','VERIFIED'].includes(recState()) && Number(window.sourceMeta?.independentSourceCount||0)>=2;}
  function finalCandidate(){
    const src=sourceSession(),now=sessionState(Date.now());
    return now.code==='FINAL' && src.code==='AH';
  }
  function paint(){
    const status=document.querySelector('#finvizStatus');
    if(!status) return;
    let note=document.querySelector('#session519Note');
    if(!note){note=document.createElement('div');note.id='session519Note';note.className='release-note';note.style.marginTop='6px';status.after(note);}
    const now=sessionState(Date.now()),src=sourceSession();
    if(finalCandidate()){
      note.innerHTML=finalReconciled()
        ? `<strong>✓ Final AH Close — Reconciled</strong> · لقطة الإغلاق بعد 8:00 ET متصالحة من ${Number(window.sourceMeta?.independentSourceCount||0)} مصادر مستقلة ويمكن استخدامها وفق بوابة التدريب.`
        : `<strong>Final AH Close Candidate</strong> · انتهت جلسة after-hours، لكن اللقطة تبقى <b>Research Only</b> حتى Final Snapshot Reconciliation من مصدرين مستقلين على الأقل. لا تُعامل كـstale intraperiod ولا كحقيقة تدريبية.`;
    } else {
      note.innerHTML=`<strong>${now.label}</strong> · لقطة المصدر: ${src.label} · ${BUILD} يميز intraperiod عن final close ولا يغير thresholds.`;
    }
  }
  const oldHealth=window.TAG500RefreshHealth?.getState;
  if(window.TAG500RefreshHealth&&typeof oldHealth==='function'){
    window.TAG500RefreshHealth.getState=function(){
      const h=oldHealth();
      const fc=finalCandidate();
      return {...h,session:sessionState(Date.now()).code,sourceSession:sourceSession().code,finalCloseCandidate:fc,finalReconciled:finalReconciled(),stale:fc?false:h.stale};
    };
  }
  const oldRefresh=window.TAG500RefreshHealth?.refresh;
  if(window.TAG500RefreshHealth&&typeof oldRefresh==='function'){
    window.TAG500RefreshHealth.refresh=function(reason){
      if(sessionState(Date.now()).code==='FINAL' && finalCandidate()) {paint(); return Promise.resolve();}
      return oldRefresh(reason);
    };
  }
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){baseRender();queueMicrotask(paint);};
  setInterval(paint,15000);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',paint); else paint();
  window.TAG500SessionClock={build:BUILD,state:sessionState,sourceState:sourceSession,finalCandidate,finalReconciled};
})();
