'use strict';
(function(){
  const RELEASE=(document.body&&document.body.dataset&&document.body.dataset.tagRelease)||'TAG577';
  const MAIN='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/';
  const ET='America/New_York';
  function parts(ts){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:ET,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new Date(ts||Date.now())).map(p=>[p.type,p.value]));}
  function session(ts){const p=parts(ts),m=Number(p.hour)*60+Number(p.minute);if(['Sat','Sun'].includes(p.weekday))return'CLOSED';if(m<240)return'CLOSED';if(m<570)return'PRE';if(m<960)return'RTH';if(m<1200)return'AH';return'FINAL';}
  function strictFinal(ts){const p=parts(ts),m=Number(p.hour)*60+Number(p.minute);return m>=1200&&m<=1210;}
  function tradingDate(ts){const p=parts(ts);return `${p.year}-${p.month}-${p.day}`;}
  async function json(name){const r=await fetch(MAIN+name+'?ts='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status+' '+name);return r.json();}
  function logLine(html,cls=''){const el=document.querySelector('#integrityLog');if(!el)return;const d=document.createElement('div');d.className='log-item '+cls;d.innerHTML=html;el.appendChild(d);}
  function publish(state){window.TAG500FinalSnapshotAuthority={build:RELEASE,...state};window.dispatchEvent(new CustomEvent('tag500:final-authority',{detail:state}));}
  if(typeof loadData!=='function'){publish({active:false,state:'LOAD_DATA_UNAVAILABLE',outcomeTrainingEligible:false,trainingEligible:false});return;}
  const previous=loadData;
  loadData=async function(){
    await previous();
    if(session(Date.now())!=='FINAL'){
      publish({active:false,state:'WAITING_FOR_20_00_ET',outcomeTrainingEligible:false,trainingEligible:false});
      return;
    }
    try{
      const [candidate,rec]=await Promise.all([json('final-ah-candidate.json'),json('final-reconciliation-v4.json')]);
      const cts=candidate.snapshotTimestampET||candidate.snapshotTimestampUTC;
      const rts=rec.sourceSnapshotTimestampET;
      const today=tradingDate(Date.now());
      const candidateValid=Boolean(candidate.finalCandidate===true&&candidate.session==='after-hours-finalization'&&strictFinal(cts)&&tradingDate(cts)===today);
      const contractOK=Boolean(rec.schemaVersion===4&&rec.matchingPolicy==='NEAREST_TIMESTAMP_TO_FINVIZ_CANDIDATE'&&rec.sameSessionDateRequired===true&&rec.sameSessionDateVerified===true);
      const reconciliationValid=Boolean(rec.finalBoundaryRecognized===true&&rec.snapshotType==='final-after-hours-close'&&rts&&tradingDate(rts)===today&&strictFinal(rts)&&contractOK&&rec.reconciliationSessionDateET===today&&rec.candidateSessionDateET===today);
      const matches=Number(rec?.counts?.priceChangeMatched||0),checked=Number(rec?.counts?.checked||0),sources=Number(rec.independentSourceCount||0);
      const outcomeOK=Boolean(candidateValid&&reconciliationValid&&rec.outcomeTrainingEligible===true&&matches>0&&sources>=2);
      const state=!candidateValid?'STRICT_FINAL_CANDIDATE_MISSING':!contractOK?'FINAL_SAME_SESSION_CONTRACT_INVALID':!reconciliationValid?'FINAL_RECONCILIATION_BLOCKED':outcomeOK?'FINAL_PRICE_CHANGE_RECONCILED':'FINAL_PRICE_CHANGE_NOT_RECONCILED';
      if(typeof sourceMeta==='object'&&sourceMeta){
        sourceMeta.strictFinalCapture={state,candidateTimestampET:cts,reconciliationTimestampET:rts,matchingPolicy:rec.matchingPolicy,sameSessionDateVerified:rec.sameSessionDateVerified,blockedReason:rec.blockedReason,checked,priceChangeMatched:matches,independentSourceCount:sources,outcomeTrainingEligible:outcomeOK,volumeTrainingEligible:false};
        sourceMeta.reconciliation=rec.finalSnapshotReconciliation||sourceMeta.reconciliation;
        sourceMeta.independentSourceCount=Math.max(Number(sourceMeta.independentSourceCount||0),sources);
        sourceMeta.outcomeTrainingEligible=outcomeOK;
        sourceMeta.trainingEligible=false;
      }
      const badge=document.querySelector('#dataBadge');
      if(badge){badge.textContent=outcomeOK?`● FINAL: نفس الجلسة · السعر/التغير ${matches}/${checked} مصالح · الحجم محجوب`:`● FINAL: ${state}`;badge.classList.toggle('connected',outcomeOK);}
      logLine(`Strict Final Capture: ${candidateValid?'PASS':'FAIL'} · ${cts||'no timestamp'} · same-session ${tradingDate(cts)===today?'PASS':'FAIL'}`,candidateValid?'':'warn');
      logLine(`Final Snapshot Reconciliation v4: ${rec.finalSnapshotReconciliation||'BLOCKED'} · same-session ${rec.sameSessionDateVerified===true?'PASS':'FAIL'} · ${rec.blockedReason||'no block'} · مصادر ${sources} · price/change ${matches}/${checked}`,outcomeOK?'':'warn');
      logLine('Final Volume: BLOCKED — no compatible independent cumulative extended-hours volume source is reconciled.','warn');
      publish({active:true,state,candidateValid,reconciliationValid,contractOK,sameSessionDateVerified:rec.sameSessionDateVerified===true,blockedReason:rec.blockedReason,matchingPolicy:rec.matchingPolicy,candidateTimestampET:cts,checked,priceChangeMatched:matches,independentSourceCount:sources,outcomeTrainingEligible:outcomeOK,trainingEligible:false,volumeTrainingEligible:false});
    }catch(err){
      if(typeof sourceMeta==='object'&&sourceMeta){sourceMeta.outcomeTrainingEligible=false;sourceMeta.trainingEligible=false;sourceMeta.strictFinalCapture={state:'FINAL_AUTHORITY_UNAVAILABLE',error:String(err.message||err)};}
      logLine('Final Snapshot Authority: FAIL-CLOSED · '+String(err.message||err),'warn');
      publish({active:true,state:'FINAL_AUTHORITY_UNAVAILABLE',error:String(err.message||err),outcomeTrainingEligible:false,trainingEligible:false});
    }
  };
  publish({active:session(Date.now())==='FINAL',state:session(Date.now())==='FINAL'?'AWAITING_SAME_SESSION_FINAL_DATA':'WAITING_FOR_20_00_ET',outcomeTrainingEligible:false,trainingEligible:false});
})();
