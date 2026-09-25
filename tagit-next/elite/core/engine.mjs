import {configuration} from './config.mjs';
import {quality,eligibility,visibleNews,pct,iso,mean} from './data.mjs';
import {features} from './features.mjs';
import {hash} from './store.mjs';
import {analyzeBars,RULES} from '../../quote-service/src/scanner.mjs';
export const STATES = {DETECTED:'نشاط غير اعتيادي',ACTIVE:'اندفاع نشط',PULLBACK:'تراجع تحت المراقبة',RECOVERY_PENDING:'استعادة قيد التأكيد',RECOVERY_CONFIRMED:'استعادة مؤكدة تجريبيًا',FAILED:'ضعف أو فشل',RENEWED:'تجدد الفرصة'};
export function createEngine({store,calendar,config={},runId='shadow-1',sourceHash='unrecorded',discoveryMode='LEGACY',metadata=[],news=[]}) {
  const cfg=configuration(config);store.run(runId,cfg,sourceHash);
  function process(bar,{detect=null,haltIntervals=[],feedOutages=[],confirmedNoTrades=[],corporateActions=[]}={}) {
    const now=Date.parse(bar.received_at),barTime=Date.parse(bar.t),session=calendar.at(barTime,cfg.periods);
    const key=`${bar.symbol}|${bar.feed}|${session.date}`;
    return store.transaction(()=>{
      // Read checkpoint inside the write transaction so concurrent workers cannot overwrite a newer state.
      let state=store.restore(runId,key)??{bars:[],opportunity:null,lastTime:null};
      const input={kind:'BAR',symbol:bar.symbol,event_at:bar.t,received_at:bar.received_at,bar};
      if(!store.input(runId,input))return state.opportunity;
      const equal=state.bars.find(x=>x.t===bar.t);
      // After a public decision snapshot restore, refill indicator context at its actual new receipt time.
      // Never evaluate those older bars as new decisions or rewrite the restored first signal.
      if(state.contextRehydration&&barTime<=state.lastTime){
        if(!equal){state.bars.push(bar);state.bars.sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));store.checkpoint(runId,key,state);}
        return state.opportunity;
      }
      if(equal&&['o','h','l','c','v','n','vw'].every(k=>equal[k]===bar[k]))return state.opportunity;
      if(equal||state.lastTime!==null&&barTime<state.lastTime) {
        if(state.opportunity){const correction={kind:equal?'CORRECTION_OR_DUPLICATE':'LATE_BAR',at:bar.received_at,bar_at:bar.t,reason:'Original decision retained; use a new run for corrected replay',revision:hash(bar)};store.event(state.opportunity,correction);}
        return state.opportunity;
      }
      if(!session.valid)return null;
      state.contextRehydration=false;
      const action=corporateActions.find(a=>a.symbol===bar.symbol&&Date.parse(a.received_at)<=now&&Date.parse(a.effective_at)<=barTime&&(!state.actionIds?.includes(a.id)));
      if(action){state.actionIds=[...(state.actionIds||[]),action.id];state.corporateActionHold=true;
        if(state.opportunity)store.event(state.opportunity,{kind:'CORPORATE_ACTION_BOUNDARY',at:bar.received_at,action,reason:'Raw price comparison paused; original discovery preserved. Resume in a separately versioned adjusted replay or next session.'});}
      state.bars.push(bar);state.bars=state.bars.slice(-1000);state.lastTime=barTime;
      const q=quality(state.bars,now,{feed:bar.feed,maxLatencyMs:cfg.maxLatencyMs,expectedStart:Math.max(session.pre,Date.parse(state.bars[0].t)),haltIntervals,feedOutages,confirmedNoTrades});
      const f=features(state.bars,{session,at:bar.received_at});
      const info=metadata.filter(x=>x.symbol===bar.symbol),eligible=eligibility(info,now,cfg);
      const legacyWindow=state.bars.filter(b=>Date.parse(b.t)>=now-90*60000);
      const signal=detect??(discoveryMode==='LEGACY'?analyzeBars(legacyWindow,now):null);
      const detected=Boolean(signal?.expansion||signal?.imported);
      if(state.opportunity&&detected&&signal?.imported)store.event(state.opportunity,{kind:'BASELINE_REDETECTION',at:bar.received_at,price:bar.c,signal,reason:'Repeated discovery linked to the same symbol/session opportunity'});
      if(!state.opportunity&&detected) {
        const initial={...signal};delete initial.outcomes;
        const id=hash([runId,bar.symbol,bar.feed,session.date]).slice(0,24);
        state.opportunity={id,symbol:bar.symbol,session:session.date,feed:bar.feed,mode:cfg.mode,first_at:bar.received_at,first_bar_at:bar.t,first_price:bar.c,
          methodology:cfg.version,detectorVersion:RULES.version,first_signal:initial,first_quality:q,first_eligibility:eligible,firstSessionPhase:session.phase,
          activityStartCandidate:state.bars.at(-3)?.t??bar.t,activityStartConfirmedAt:bar.received_at,
          discoveryProvenance:signal.imported?'PRESERVED_BASELINE_REPLAY':'LEGACY_BAR_DETECTOR',liveShortlistReproduced:signal.liveShortlistReproduced===true,
          state:'DETECTED',state_since:bar.received_at,peak:bar.h,peak_at:bar.received_at,trough:bar.l,support:f.priorLow??bar.l,
          wave:1,recoveryAttempts:0,failedBreakouts:0,pendingState:null,pendingCount:0,recoveryLevel:null,recoveryCount:0,
          impulseVolume:mean(state.bars.slice(-3).map(x=>x.v)),pullbackStart:null,pullVolumes:[],lastConfirmedAt:null,entryReady:false};
        store.first(state.opportunity,runId);
        store.event(state.opportunity,{kind:'DISCOVERY',at:bar.received_at,to:'DETECTED',price:bar.c,reason:'Original discovery preserved',signal:initial,quality:q,eligibility:eligible});
      }
      const o=state.opportunity;
      if(o) {
        const previousPeak=o.peak,previousSupport=o.support,atr=f.atr??Math.max(bar.h-bar.l,bar.c*0.01),gap=q.contiguousBars<cfg.stateContiguousBars;
        const priorBars=state.bars.slice(-4,-1),reclaim=priorBars.length===3?Math.max(...priorBars.map(x=>x.h)):null;
        let target=null,reason=null;
        const firstBar=o.first_at===bar.received_at;
        if(!firstBar&&!gap&&!state.corporateActionHold&&q.latencyMs<=cfg.maxLatencyMs) {
          const failed=bar.c<previousSupport-cfg.failureATR*atr;
          const pullback=previousPeak-bar.c>=Math.max(cfg.pullbackATR*atr,(previousPeak-o.first_price)*cfg.minPullbackFraction);
          if(failed&&o.state!=='FAILED'){target='FAILED';reason='Close below frozen support minus failure ATR buffer';}
          else if(o.state==='FAILED') {if(reclaim!==null&&bar.c>reclaim){target='RENEWED';reason='New close above preceding three completed-bar highs after failure';}}
          else if(o.state==='RECOVERY_PENDING') {
            if(now-Date.parse(o.state_since)>cfg.confirmationExpiryMinutes*60000||bar.c<=o.recoveryLevel){target='PULLBACK';reason='Recovery failed or expired';o.recoveryCount=0;}
            else {o.recoveryCount++;if(o.recoveryCount>=cfg.confirmationBars){target='RECOVERY_CONFIRMED';reason='Consecutive closes above the level frozen at recovery start';}}
          } else if(o.state==='PULLBACK'||o.state==='RENEWED') {
            if(reclaim!==null&&bar.c>reclaim){target='RECOVERY_PENDING';reason='Close reclaims prior three completed-bar highs';o.recoveryLevel=reclaim;o.recoveryCount=1;}
          } else if(pullback) {target='PULLBACK';reason='Price retraced from a previously observed high';}
          else if(o.state==='DETECTED'&&bar.c>=o.first_price+atr*0.5||o.state==='RECOVERY_CONFIRMED'&&bar.c>previousPeak) {target='ACTIVE';reason='Price progression above known reference';}
          // Pending/confirmed already require a multi-bar pattern; other changes use hysteresis.
          if(target){const immediate=['RECOVERY_PENDING','RECOVERY_CONFIRMED'].includes(target);o.pendingCount=o.pendingState===target?o.pendingCount+1:1;o.pendingState=target;
            if(immediate||o.pendingCount>=cfg.confirmationBars){const from=o.state;o.state=target;o.state_since=bar.received_at;o.pendingCount=0;o.pendingState=null;
              if(target==='PULLBACK'){o.pullbackStart=bar.received_at;o.pullVolumes=[];o.trough=bar.l;if(from==='RECOVERY_PENDING')o.failedBreakouts++;}
              if(target==='RECOVERY_PENDING')o.recoveryAttempts++;
              if(target==='RECOVERY_CONFIRMED')o.lastConfirmedAt=bar.received_at;
              if(target==='RENEWED'){o.wave++;o.support=f.priorLow??bar.l;o.peak=bar.h;o.peak_at=bar.received_at;o.pullVolumes=[];o.lastConfirmedAt=null;}
              store.event(o,{kind:'STATE',at:bar.received_at,from,to:target,reason,price:bar.c,level:o.recoveryLevel,support:o.support,quality:q,features:f});
            }
          }else{o.pendingCount=0;o.pendingState=null;}
        } else if(gap){o.pendingCount=0;o.pendingState=null;o.recoveryCount=0;}
        if(bar.h>o.peak){o.peak=bar.h;o.peak_at=bar.received_at;}
        o.trough=Math.min(o.trough,bar.l);if(o.state==='PULLBACK')o.pullVolumes.push(bar.v);
        const blocking=[...eligible.reasons];
        if(state.corporateActionHold)blocking.push('CORPORATE_ACTION_UNRECONCILED');
        if(!q.entryAllowed)blocking.push('DATA_QUALITY');
        if(!o.lastConfirmedAt||now-Date.parse(o.lastConfirmedAt)>cfg.confirmationExpiryMinutes*60000||!['ACTIVE','RECOVERY_CONFIRMED'].includes(o.state))blocking.push('RECOVERY_NOT_CONFIRMED');
        const extension=o.recoveryLevel?(bar.c-o.recoveryLevel)/atr:null;
        if(extension!==null&&extension>cfg.maxEntryExtensionATR)blocking.push('ENTRY_EXTENDED');
        const quote=bar.quote,age=quote?now-Date.parse(quote.t):Infinity;
        const spread=quote&&quote.ask>=quote.bid&&quote.bid>0?pct(quote.ask,quote.bid):null;
        if(spread===null||age<0||age>10000)blocking.push('FRESH_EXECUTION_QUOTE_MISSING');else if(spread>cfg.maxSpreadPct)blocking.push('WIDE_SPREAD');
        if(session.remainingMinutes<cfg.execution.entryCutoffMinutes)blocking.push('SESSION_END_APPROACHING');
        o.current_price=bar.c;o.price_at=bar.t;o.updated_at=bar.received_at;o.quality=q;o.eligibility=eligible;o.features=f;o.sessionPhase=session.phase;
        o.ageMinutes=(now-Date.parse(o.first_at))/60000;o.stateAgeMinutes=(now-Date.parse(o.state_since))/60000;o.sincePeakMinutes=(now-Date.parse(o.peak_at))/60000;
        o.pullbackMinutes=o.pullbackStart?(now-Date.parse(o.pullbackStart))/60000:null;o.pullbackPct=pct(bar.c,o.peak);o.retainedGainPct=pct(bar.c,o.first_price);
        o.pullbackActivityRatio=o.pullVolumes.length&&o.impulseVolume>0?mean(o.pullVolumes)/o.impulseVolume:null;
        o.researchConditionsMet=Boolean(o.lastConfirmedAt&&!blocking.some(x=>['DATA_QUALITY','RECOVERY_NOT_CONFIRMED','ENTRY_EXTENDED','SESSION_END_APPROACHING'].includes(x)));
        o.blocking=[...new Set(blocking)];o.entryReady=o.blocking.length===0;
        o.news=visibleNews(news,now,bar.symbol).slice(0,3);o.sharia=eligible.record?.sharia??{status:'UNKNOWN',source:null};
        o.awaiting=o.state==='RECOVERY_PENDING'?'إغلاق تالٍ فوق مستوى الاستعادة الثابت':'استعادة مؤكدة وجودة بيانات وتحقق أهلية وتكلفة تنفيذ';
        o.invalidation={support:o.support,failureLevel:o.support-cfg.failureATR*atr,basis:'Two consecutive closes below known support minus contemporaneous ATR buffer'};
        if(o.entryReady)store.event(o,{kind:'PAPER_ENTRY_CANDIDATE',at:bar.received_at,price:bar.c,reason:'Experimental conditions; execution occurs only after decision latency'});
      }
      store.checkpoint(runId,key,state);return o;
    });
  }
  return {process,config:cfg,runId,snapshots:()=>store.snapshots(runId),timeline:id=>store.timeline(id)};
}
