'use strict';
(function(){
  const RELEASE='TAG546';
  const CHECK_MS=10000;
  const MIN_RETRY_MS=45000;
  let lastState=null,lastTriggered=0,lastReason='';
  function state(){const fn=window.TAG500SessionClock?.state;return typeof fn==='function'?fn(Date.now())?.code:null;}
  function actionableSession(s){return ['PRE','RTH','AH'].includes(s);}
  function sourceState(){const fn=window.TAG500SessionClock?.sourceState;return typeof fn==='function'?fn()?.code:null;}
  async function refresh(reason){const r=window.TAG500RefreshHealth?.refresh;if(typeof r!=='function')return false;lastTriggered=Date.now();lastReason=reason;try{await r(reason);return true;}catch(_){return false;}}
  function paint(){const host=document.querySelector('#finvizStatus');if(!host)return;let n=document.querySelector('#transition546Note');if(!n){n=document.createElement('div');n.id='transition546Note';n.className='release-note';n.style.marginTop='6px';host.after(n);}const cur=state()||'UNKNOWN',src=sourceState()||'UNKNOWN';const mismatch=actionableSession(cur)&&src!==cur;n.innerHTML=mismatch?`<strong>Session Transition Gate</strong> · ${src}→${cur}: الترتيب التنفيذي محجوب حتى تصل لقطة ${cur}؛ تم طلب تحديث فوري${lastReason?' ('+lastReason+')':''}.`:`<strong>Session Transition</strong> · ${cur} متوافق مع لقطة المصدر ${src}.`;}
  function tick(){const cur=state();if(!cur){paint();return;}if(lastState===null){lastState=cur;paint();return;}if(cur!==lastState){const prev=lastState;lastState=cur;if(actionableSession(cur))refresh(`انتقال الجلسة ${prev}→${cur}`);paint();return;}const src=sourceState();if(actionableSession(cur)&&src&&src!==cur&&Date.now()-lastTriggered>=MIN_RETRY_MS)refresh(`انتظار لقطة ${cur}`);paint();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{lastState=state();paint();});else{lastState=state();paint();}
  setInterval(tick,CHECK_MS);
  window.addEventListener('tag500:runtime-ready',tick);
  window.TAG500SessionTransition={release:RELEASE,state:()=>({current:state(),source:sourceState(),lastTriggered,lastReason})};
})();