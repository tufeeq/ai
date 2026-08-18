'use strict';
(function(){
  const RELEASE='TAG546';
  const FINAL_WINDOW_START_MIN=19*60+55;
  const TRANSITION_CHECK_MS=10000;
  const TRANSITION_RETRY_MS=45000;
  let lastSessionCode=null,lastTransitionRefresh=0,lastTransitionReason='';
  function publishRelease(){
    if(document.body)document.body.dataset.tagRelease=RELEASE;
    const b=document.querySelector('#versionBadge');if(b)b.textContent=RELEASE;
    const f=document.querySelector('footer strong');if(f)f.textContent=RELEASE;
    document.title=RELEASE+' — منصة TAG500';
  }
  function buildId(){return document.body?.dataset?.tagRelease||document.querySelector('#versionBadge')?.textContent?.trim()||RELEASE;}
  function etParts(ts){const d=new Date(ts||Date.now());const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(d);return Object.fromEntries(parts.map(p=>[p.type,p.value]));}
  function minutesET(ts){const p=etParts(ts);return Number(p.hour)*60+Number(p.minute);}
  function dateKeyET(ts){const p=etParts(ts);return `${p.year}-${p.month}-${p.day}`;}
  function sessionState(ts){const p=etParts(ts),m=minutesET(ts),wd=p.weekday;if(['Sat','Sun'].includes(wd))return{code:'CLOSED',label:'السوق مغلق'};if(m<240)return{code:'CLOSED',label:'قبل pre-market'};if(m<570)return{code:'PRE',label:'Pre-market'};if(m<960)return{code:'RTH',label:'Regular session'};if(m<1200)return{code:'AH',label:'After-hours'};return{code:'FINAL',label:'After-hours closed'};}
  function sourceTimestamp(){const u=window.sourceMeta?.updated;if(!u)return null;const ms=new Date(u).getTime();return Number.isFinite(ms)?ms:null;}
  function sourceSession(){const ts=sourceTimestamp();if(ts===null)return{code:'UNKNOWN',label:'وقت المصدر غير معروف'};return sessionState(ts);}
  function sameSessionDate(){const ts=sourceTimestamp();if(ts===null)return false;return dateKeyET(ts)===dateKeyET(Date.now());}
  function recState(){return String(window.sourceMeta?.reconciliation||'UNKNOWN').toUpperCase();}
  function finalReconciled(){return['FINAL_RECONCILED','RECONCILED','MATCHED','PASS','VERIFIED'].includes(recState())&&Number(window.sourceMeta?.independentSourceCount||0)>=2;}
  function finalCandidate(){const ts=sourceTimestamp();if(ts===null)return false;const now=sessionState(Date.now()),src=sourceSession(),srcMin=minutesET(ts);return now.code==='FINAL'&&sameSessionDate()&&(src.code==='AH'||src.code==='FINAL')&&srcMin>=FINAL_WINDOW_START_MIN;}
  function finalLocked(){return sessionState(Date.now()).code==='FINAL'&&finalCandidate();}
  function actionableSession(code){return['PRE','RTH','AH'].includes(code);}
  async function requestTransitionRefresh(reason){
    if(finalLocked())return false;
    const r=window.TAG500RefreshHealth?.refresh;if(typeof r!=='function')return false;
    lastTransitionRefresh=Date.now();lastTransitionReason=reason;
    try{await r(reason);return true;}catch(_){return false;}
  }
  function transitionTick(){
    const cur=sessionState(Date.now()).code,src=sourceSession().code;
    if(lastSessionCode===null){lastSessionCode=cur;return;}
    if(cur!==lastSessionCode){const prev=lastSessionCode;lastSessionCode=cur;if(actionableSession(cur))requestTransitionRefresh(`انتقال الجلسة ${prev}→${cur}`);paint();return;}
    if(actionableSession(cur)&&src!=='UNKNOWN'&&src!==cur&&Date.now()-lastTransitionRefresh>=TRANSITION_RETRY_MS){requestTransitionRefresh(`انتظار لقطة ${cur}`);}
  }
  function paint(){
    publishRelease();
    const status=document.querySelector('#finvizStatus');if(!status)return;
    let note=document.querySelector('#session531Note');if(!note){note=document.createElement('div');note.id='session531Note';note.className='release-note';note.style.marginTop='6px';status.after(note);}
    const now=sessionState(Date.now()),src=sourceSession(),build=buildId();
    if(finalCandidate()){
      note.innerHTML=finalReconciled()?`<strong>✓ Final AH Close — Reconciled</strong> · لقطة نفس جلسة اليوم قرب/بعد 8:00 ET متصالحة من ${Number(window.sourceMeta?.independentSourceCount||0)} مصادر مستقلة ويمكن استخدامها وفق بوابة التدريب. · Final-Close Lock مفعّل.`:`<strong>Final AH Close Candidate</strong> · لقطة نفس جلسة اليوم قرب/بعد 8:00 ET، محمية من التحديث الدوري بعد الإغلاق، لكنها تبقى <b>Research Only</b> حتى Final Snapshot Reconciliation من مصدرين مستقلين على الأقل.`;
    }else if(now.code==='FINAL'&&sourceTimestamp()!==null&&!sameSessionDate()){
      note.innerHTML=`<strong>Final Close blocked</strong> · لقطة المصدر من جلسة مختلفة (${dateKeyET(sourceTimestamp())}) وليست إغلاق اليوم؛ تبقى Research Only ولا تتجاوز Freshness/Reconciliation gates.`;
    }else if(actionableSession(now.code)&&src.code!==now.code){
      note.innerHTML=`<strong>Session Transition Gate</strong> · ${src.code}→${now.code}: الترتيب التنفيذي محجوب حتى تصل لقطة ${now.code}. تم طلب تحديث فوري${lastTransitionReason?` (${lastTransitionReason})`:''}.`;
    }else{
      note.innerHTML=`<strong>${now.label}</strong> · لقطة المصدر: ${src.label} · ${build} يميز intraperiod عن final close ويطلب تحديثًا فوريًا عند انتقال PRE/RTH/AH.`;
    }
  }
  const oldHealth=window.TAG500RefreshHealth?.getState;if(window.TAG500RefreshHealth&&typeof oldHealth==='function'){window.TAG500RefreshHealth.getState=function(){const h=oldHealth(),fc=finalCandidate();return{...h,session:sessionState(Date.now()).code,sourceSession:sourceSession().code,sameSessionDate:sameSessionDate(),finalCloseCandidate:fc,finalCloseLocked:finalLocked(),finalReconciled:finalReconciled(),transitionLastRefresh:lastTransitionRefresh,transitionReason:lastTransitionReason,stale:fc?false:h.stale};};}
  const oldRefresh=window.TAG500RefreshHealth?.refresh;if(window.TAG500RefreshHealth&&typeof oldRefresh==='function'){window.TAG500RefreshHealth.refresh=function(reason){if(finalLocked()){paint();return Promise.resolve({skipped:true,reason:'FINAL_CLOSE_LOCK'});}return oldRefresh(reason);};}
  const oldLoad=window.loadData;if(typeof oldLoad==='function'){window.loadData=async function(){if(finalLocked()){paint();return{skipped:true,reason:'FINAL_CLOSE_LOCK'};}return oldLoad.apply(this,arguments);};}
  const baseRender=window.render;if(typeof baseRender==='function'){window.render=function(){baseRender();queueMicrotask(paint);};}
  publishRelease();lastSessionCode=sessionState(Date.now()).code;
  setInterval(paint,15000);setInterval(transitionTick,TRANSITION_CHECK_MS);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{publishRelease();paint();});else paint();
  window.TAG500SessionClock={build:RELEASE,state:sessionState,sourceState:sourceSession,sameSessionDate,finalCandidate,finalLocked,finalReconciled,transitionState:()=>({lastTransitionRefresh,lastTransitionReason,current:lastSessionCode})};
  window.dispatchEvent(new CustomEvent('tag500:runtime-ready',{detail:{build:RELEASE,layer:'session-clock'}}));
})();