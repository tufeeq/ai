'use strict';
(function(){
  const RELEASE=document.body?.dataset?.tagRelease||'TAG563';
  const FINAL_STRICT_MIN=20*60;
  const FINAL_PREP_MIN=19*60+59;
  const FINAL_RETRY_MS=30000;
  const FINAL_CAPTURE_DEADLINE_MIN=20*60+10;
  const TRANSITION_CHECK_MS=10000;
  const TRANSITION_RETRY_MS=45000;
  let lastSessionCode=null,lastTransitionRefresh=0,lastTransitionReason='',lastFinalRefresh=0,finalRefreshAttempts=0,preCloseRefreshDone=false;
  function publishRelease(){const build=buildId();if(document.body)document.body.dataset.tagRelease=build;const b=document.querySelector('#versionBadge');if(b)b.textContent=build;const f=document.querySelector('footer strong');if(f)f.textContent=build;document.title=build+' — منصة TAG500';}
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
  function finalCandidate(){const ts=sourceTimestamp();if(ts===null)return false;const now=sessionState(Date.now()),src=sourceSession(),srcMin=minutesET(ts);return now.code==='FINAL'&&sameSessionDate()&&src.code==='FINAL'&&srcMin>=FINAL_STRICT_MIN;}
  function finalLocked(){return finalCandidate();}
  function actionableSession(code){return['PRE','RTH','AH'].includes(code);}
  async function doRefresh(reason,kind='transition'){
    if(finalLocked())return false;
    const r=window.TAG500RefreshHealth?.refresh;if(typeof r!=='function')return false;
    if(kind==='final'){lastFinalRefresh=Date.now();finalRefreshAttempts+=1;}else{lastTransitionRefresh=Date.now();lastTransitionReason=reason;}
    try{await r(reason);return true;}catch(_){return false;}
  }
  function finalCaptureTick(){
    const nowCode=sessionState(Date.now()).code,m=minutesET(Date.now());
    if(nowCode==='AH'&&m>=FINAL_PREP_MIN&&!preCloseRefreshDone){preCloseRefreshDone=true;doRefresh('تحضير لقطة الإغلاق النهائي قبل 8:00 ET','final');return;}
    if(nowCode!=='FINAL'||finalLocked())return;
    if(m>FINAL_CAPTURE_DEADLINE_MIN)return;
    if(Date.now()-lastFinalRefresh>=FINAL_RETRY_MS)doRefresh('التقاط Final AH Close بعد 8:00 ET','final');
  }
  function transitionTick(){
    const cur=sessionState(Date.now()).code,src=sourceSession().code;
    if(lastSessionCode===null){lastSessionCode=cur;return;}
    if(cur!==lastSessionCode){const prev=lastSessionCode;lastSessionCode=cur;if(actionableSession(cur))doRefresh(`انتقال الجلسة ${prev}→${cur}`);else if(cur==='FINAL')doRefresh('انتقال AH→FINAL: طلب لقطة 8:00+ ET','final');paint();return;}
    if(actionableSession(cur)&&src!=='UNKNOWN'&&src!==cur&&Date.now()-lastTransitionRefresh>=TRANSITION_RETRY_MS)doRefresh(`انتظار لقطة ${cur}`);
    finalCaptureTick();
  }
  function paint(){
    publishRelease();
    const status=document.querySelector('#finvizStatus');if(!status)return;
    let note=document.querySelector('#session531Note');if(!note){note=document.createElement('div');note.id='session531Note';note.className='release-note';note.style.marginTop='6px';status.after(note);}
    const now=sessionState(Date.now()),src=sourceSession(),build=buildId(),ts=sourceTimestamp(),srcMin=ts===null?null:minutesET(ts);
    if(finalCandidate()){
      note.innerHTML=finalReconciled()?`<strong>✓ Final AH Close — Reconciled</strong> · لقطة 8:00+ ET من نفس جلسة اليوم ومتَصالحة من ${Number(window.sourceMeta?.independentSourceCount||0)} مصادر مستقلة. · Final-Close Lock مفعّل.`:`<strong>Final AH Close Candidate</strong> · لقطة 8:00+ ET من نفس جلسة اليوم، محمية من التحديث الدوري بعد الإغلاق، لكنها تبقى <b>Research Only</b> حتى Final Snapshot Reconciliation من مصدرين مستقلين على الأقل.`;
    }else if(now.code==='FINAL'&&ts!==null&&sameSessionDate()&&srcMin<FINAL_STRICT_MIN){
      note.innerHTML=`<strong>Final Close capture pending</strong> · آخر لقطة ${String(Math.floor(srcMin/60)).padStart(2,'0')}:${String(srcMin%60).padStart(2,'0')} ET ما تزال intraperiod وليست إغلاق 8:00. لا قفل ولا تدريب؛ يجري طلب لقطة 8:00+ ET. المحاولات: ${finalRefreshAttempts}.`;
    }else if(now.code==='FINAL'&&ts!==null&&!sameSessionDate()){
      note.innerHTML=`<strong>Final Close blocked</strong> · لقطة المصدر من جلسة مختلفة (${dateKeyET(ts)}) وليست إغلاق اليوم؛ تبقى Research Only ولا تتجاوز Freshness/Reconciliation gates.`;
    }else if(actionableSession(now.code)&&src.code!==now.code){
      note.innerHTML=`<strong>Session Transition Gate</strong> · ${src.code}→${now.code}: الترتيب التنفيذي محجوب حتى تصل لقطة ${now.code}. تم طلب تحديث فوري${lastTransitionReason?` (${lastTransitionReason})`:''}.`;
    }else{
      note.innerHTML=`<strong>${now.label}</strong> · لقطة المصدر: ${src.label} · ${build} يميز intraperiod عن final close؛ Final-Close Lock يتطلب timestamp عند/بعد 8:00 ET من جلسة اليوم.`;
    }
  }
  const oldHealth=window.TAG500RefreshHealth?.getState;if(window.TAG500RefreshHealth&&typeof oldHealth==='function'){window.TAG500RefreshHealth.getState=function(){const h=oldHealth(),fc=finalCandidate();return{...h,session:sessionState(Date.now()).code,sourceSession:sourceSession().code,sameSessionDate:sameSessionDate(),finalCloseCandidate:fc,finalCloseLocked:finalLocked(),finalReconciled:finalReconciled(),finalCaptureAttempts:finalRefreshAttempts,finalCapturePending:sessionState(Date.now()).code==='FINAL'&&!fc,transitionLastRefresh:lastTransitionRefresh,transitionReason:lastTransitionReason,stale:fc?false:h.stale};};}
  const oldRefresh=window.TAG500RefreshHealth?.refresh;if(window.TAG500RefreshHealth&&typeof oldRefresh==='function'){window.TAG500RefreshHealth.refresh=function(reason){if(finalLocked()){paint();return Promise.resolve({skipped:true,reason:'FINAL_CLOSE_LOCK'});}return oldRefresh(reason);};}
  const oldLoad=window.loadData;if(typeof oldLoad==='function'){window.loadData=async function(){if(finalLocked()){paint();return{skipped:true,reason:'FINAL_CLOSE_LOCK'};}return oldLoad.apply(this,arguments);};}
  const baseRender=window.render;if(typeof baseRender==='function'){window.render=function(){baseRender();queueMicrotask(paint);};}
  publishRelease();lastSessionCode=sessionState(Date.now()).code;
  setInterval(paint,15000);setInterval(transitionTick,TRANSITION_CHECK_MS);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{publishRelease();paint();finalCaptureTick();});else{paint();finalCaptureTick();}
  window.TAG500SessionClock={build:buildId(),state:sessionState,sourceState:sourceSession,sameSessionDate,finalCandidate,finalLocked,finalReconciled,transitionState:()=>({lastTransitionRefresh,lastTransitionReason,current:lastSessionCode,lastFinalRefresh,finalRefreshAttempts})};
  window.dispatchEvent(new CustomEvent('tag500:runtime-ready',{detail:{build:buildId(),layer:'session-clock'}}));
})();
