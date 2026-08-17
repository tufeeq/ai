'use strict';
(function(){
  const BUILD='TAG531';
  const FINAL_WINDOW_START_MIN=19*60+45;
  function etParts(ts){
    const d=new Date(ts||Date.now());
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(d);
    return Object.fromEntries(parts.map(p=>[p.type,p.value]));
  }
  function minutesET(ts){const p=etParts(ts);return Number(p.hour)*60+Number(p.minute);}
  function dateKeyET(ts){const p=etParts(ts);return `${p.year}-${p.month}-${p.day}`;}
  function sessionState(ts){
    const p=etParts(ts),m=minutesET(ts),wd=p.weekday;
    if(['Sat','Sun'].includes(wd)) return {code:'CLOSED',label:'السوق مغلق'};
    if(m<240) return {code:'CLOSED',label:'قبل pre-market'};
    if(m<570) return {code:'PRE',label:'Pre-market'};
    if(m<960) return {code:'RTH',label:'Regular session'};
    if(m<1200) return {code:'AH',label:'After-hours'};
    return {code:'FINAL',label:'After-hours closed'};
  }
  function sourceTimestamp(){
    const u=window.sourceMeta?.updated;
    if(!u) return null;
    const t=new Date(u).getTime();
    return Number.isFinite(t)?t:null;
  }
  function sourceSession(){
    const t=sourceTimestamp();
    if(t===null) return {code:'UNKNOWN',label:'وقت المصدر غير معروف'};
    return sessionState(t);
  }
  function recState(){return String(window.sourceMeta?.reconciliation||'UNKNOWN').toUpperCase();}
  function finalReconciled(){return ['FINAL_RECONCILED','RECONCILED','MATCHED','PASS','VERIFIED'].includes(recState()) && Number(window.sourceMeta?.independentSourceCount||0)>=2;}
  function finalCandidate(){
    const nowTs=Date.now(),srcTs=sourceTimestamp();
    if(srcTs===null||sessionState(nowTs).code!=='FINAL') return false;
    if(dateKeyET(srcTs)!==dateKeyET(nowTs)) return false;
    const src=sourceSession(),srcMin=minutesET(srcTs);
    return ['AH','FINAL'].includes(src.code) && srcMin>=FINAL_WINDOW_START_MIN;
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
        : `<strong>Final AH Close Candidate</strong> · لقطة المصدر من نافذة الإغلاق النهائية لنفس يوم التداول، لكنها تبقى <b>Research Only</b> حتى Final Snapshot Reconciliation من مصدرين مستقلين على الأقل.`;
    } else if(now.code==='FINAL'){
      note.innerHTML=`<strong>After-hours closed</strong> · لا توجد لقطة مؤهلة كإغلاق نهائي لنفس جلسة اليوم (يلزم مصدر من نافذة 7:45–8:00+ PM ET). تبقى البيانات Research Only ولا يتم تجاوز stale gate.`;
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
  window.TAG500SessionClock={build:BUILD,state:sessionState,sourceState:sourceSession,finalCandidate,finalReconciled,dateKeyET};
})();
