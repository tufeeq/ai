(() => {
  let loading=false;
  async function loadGitHubFinviz() {
    if(loading)return; loading=true;
    const s=document.getElementById('finvizStatus');
    const b=document.getElementById('dataBadge');
    if(s){s.className='connector-status';s.textContent='جاري تحميل أحدث بيانات Finviz…';}
    try{
      const r=await fetch('./data/finviz.json?ts='+Date.now(),{cache:'no-store'});
      if(!r.ok) throw new Error('Data file HTTP '+r.status);
      const payload=await r.json();
      const finvizRows=Array.isArray(payload.data)?payload.data:(Array.isArray(payload.rows)?payload.rows:[]);
      if(!finvizRows.length) throw new Error('No Finviz rows found');
      if(typeof normalizeFinviz!=='function') throw new Error('TAG parser unavailable');

      const updatedMs=Date.parse(payload.updatedAt||payload.snapshotTimestampUTC||'');
      const ageMinutes=Number.isFinite(updatedMs)?Math.max(0,(Date.now()-updatedMs)/60000):null;
      const stale=ageMinutes===null||ageMinutes>15;
      const reconciled=payload.finalSnapshotReconciliation==='RECONCILED' && (payload.independentSourceCount||0)>=2;

      window.TAGDataIntegrity={
        updatedAt:payload.updatedAt||null,
        snapshotTimestampUTC:payload.snapshotTimestampUTC||null,
        snapshotTimestampET:payload.snapshotTimestampET||null,
        session:payload.session||null,
        sessionBucket:payload.sessionBucket||null,
        snapshotType:payload.snapshotType||null,
        finalCandidate:Boolean(payload.finalCandidate),
        finalSnapshotReconciliation:payload.finalSnapshotReconciliation||'UNKNOWN',
        independentSourceCount:payload.independentSourceCount||0,
        trainingEligible:Boolean(payload.trainingEligible)&&!stale,
        cadenceStatus:payload.cadenceStatus||null,
        bucketContinuityStatus:payload.bucketContinuityStatus||null,
        trainingBlockReasons:[...(Array.isArray(payload.trainingBlockReasons)?payload.trainingBlockReasons:[]),...(stale?['STALE_SNAPSHOT_RANKING_DISABLED']:[])],
        ageMinutes,
        stale,
        reconciled
      };

      if(stale){
        rows=[];
        render();
        if(b){b.textContent='● DATA: STALE — RANKING OFF';b.classList.remove('connected');}
        if(s){
          s.className='connector-status err';
          const ageText=ageMinutes===null?'عمر غير معروف':`${ageMinutes.toFixed(0)} دقيقة`;
          s.textContent=`بيانات Finviz متقادمة (${ageText}). تم تعطيل الترتيب وTop Opportunity تلقائيًا حتى تصل لقطة أحدث.`;
        }
        return;
      }

      const normalized=normalizeFinviz(finvizRows);
      const rawByTicker=new Map(finvizRows.map(o=>[String(o.Ticker||o.Symbol||'').toUpperCase(),o]));
      rows=normalized.map(x=>{
        const o=rawByTicker.get(x.ticker)||{};
        return {...x,
          snapshotTimestampUTC:o._snapshotTimestampUTC||payload.snapshotTimestampUTC||payload.updatedAt||null,
          snapshotTimestampET:o._snapshotTimestampET||payload.snapshotTimestampET||null,
          session:o._session||payload.session||null,
          sessionBucket:o._sessionBucket||payload.sessionBucket||null,
          snapshotType:o._snapshotType||payload.snapshotType||null,
          finalCandidate:Boolean(o._finalCandidate??payload.finalCandidate),
          finalReconciled:Boolean(o._finalReconciled),
          trainingEligible:Boolean(o._trainingEligible??payload.trainingEligible),
          cadenceStatus:o._cadenceStatus||payload.cadenceStatus||null,
          bucketContinuityStatus:o._bucketContinuityStatus||payload.bucketContinuityStatus||null,
          persistenceTrainingEligible:Boolean(o._persistenceTrainingEligible??payload.persistenceTrainingEligible),
          persistencePoints:Array.isArray(o._persistencePoints)?o._persistencePoints:[],
          persistenceBuckets:Array.isArray(o._persistenceBuckets)?o._persistenceBuckets:[],
          gainRetentionPct:o._gainRetentionPct??null,
          persistenceSlopePctPts:o._persistenceSlopePctPts??null,
          persistenceTrend:o._persistenceTrend||'INSUFFICIENT_HISTORY',
          independentSourceCount:o._independentSourceCount??payload.independentSourceCount??0,
          dataIntegrityState:o._dataIntegrityState||payload.dataIntegrityState||'UNKNOWN',
          firstObservedTimestampUTC:o._firstObservedTimestampUTC||null,
          firstObservedTimestampET:o._firstObservedTimestampET||null,
          firstObservedSession:o._firstObservedSession||null,
          firstObservedBucket:o._firstObservedBucket||null,
          firstObservedChange:o._firstObservedChange??null,
          firstObservedVolume:o._firstObservedVolume??null,
          firstSessionObservedTimestampUTC:o._firstSessionObservedTimestampUTC||null,
          firstSessionObservedTimestampET:o._firstSessionObservedTimestampET||null,
          firstSessionObservedBucket:o._firstSessionObservedBucket||null,
          firstActionableSignalTimestampET:o._firstActionableSignalTimestampET||null
        };
      });

      render();
      if(b){
        b.textContent=reconciled?'● DATA: RECONCILED':'● DATA: LIVE / UNRECONCILED';
        b.classList.add('connected');
      }
      if(s){
        s.className=reconciled?'connector-status ok':'connector-status';
        const ageText=`${ageMinutes.toFixed(0)} دقيقة`;
        const recText=reconciled?'تمت المصالحة النهائية':'غير مصالَح نهائيًا / مصدر واحد';
        s.textContent=`Finviz · ${finvizRows.length} سهم · ${ageText} · ${recText} · ${payload.sessionBucket||payload.session||'—'}`;
      }
    }catch(e){
      rows=[];
      if(typeof render==='function')render();
      if(b){b.textContent='● DATA ERROR — RANKING OFF';b.classList.remove('connected');}
      if(s){s.className='connector-status err';s.textContent='تعذر تحميل بيانات Finviz؛ تم تعطيل الترتيب: '+e.message;}
    } finally { loading=false; }
  }
  window.addEventListener('DOMContentLoaded',()=>{
    const btn=document.getElementById('connectFinviz');if(btn){btn.textContent='تحميل أحدث بيانات Finviz';btn.onclick=loadGitHubFinviz;}
    ['finvizToken','finvizUrl'].forEach(id=>{const el=document.getElementById(id);if(el&&el.closest('label'))el.closest('label').style.display='none';});
    ['toggleToken','forgetToken'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
    const remember=document.getElementById('rememberToken');if(remember&&remember.closest('label'))remember.closest('label').style.display='none';
    const s=document.getElementById('finvizStatus');if(s)s.textContent='جاهز لتحميل بيانات Finviz من GitHub Actions.';
    setTimeout(loadGitHubFinviz,250);
    setInterval(loadGitHubFinviz,5*60*1000);
  });
})();