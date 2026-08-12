/* TAG6 Runtime Guard
 * Corrects directional semantics in extended hours and prevents stale/unreconciled data
 * or invalid ticker identities from being treated as high-confidence actionable evidence.
 */
(function(root){
  const baseAnalyze=root.analyze;
  if(typeof baseAnalyze!=='function') return;
  const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));

  // Primary-source verified ticker migrations. This is a safety backstop, not a substitute
  // for pipeline-level corporate-action reconciliation.
  const tickerMigrations={
    CIGL:{currentTicker:'YOOV',effectiveDate:'2026-04-13',source:'SEC 6-K filed 2026-04-14'}
  };

  function tickerIdentityState(x){
    const t=String(x.ticker||'').toUpperCase();
    const migration=tickerMigrations[t];
    if(migration){
      return {valid:false,status:'OBSOLETE_TICKER',ticker:t,...migration};
    }
    if(x.tickerIdentityVerified===false || x.corporateActionConflict===true){
      return {valid:false,status:'TICKER_IDENTITY_UNVERIFIED',ticker:t,currentTicker:x.currentTicker||null};
    }
    return {valid:true,status:x.tickerIdentityVerified===true?'VERIFIED':'NOT_CHECKED',ticker:t,currentTicker:x.currentTicker||t};
  }

  root.analyze=function TAG6AnalyzeGuarded(x){
    const r=baseAnalyze(x);
    const identity=tickerIdentityState(x);
    r.tickerIdentity=identity;

    // Corporate identity is upstream of scoring. An obsolete or conflicting ticker cannot
    // be ranked, trained, or treated as a market signal regardless of RVOL/momentum.
    if(!identity.valid){
      r.score=0;
      r.early=0;
      r.ignition=0;
      r.continuation=0;
      r.stage='LATE';
      r.dataConfidence='DATA_INTEGRITY_ERROR';
      r.trainingEligible=false;
      r.reasons=[...(r.reasons||[]), identity.status==='OBSOLETE_TICKER'
        ? `DATA INTEGRITY: ${identity.ticker} changed to ${identity.currentTicker} effective ${identity.effectiveDate}`
        : 'DATA INTEGRITY: ticker/corporate-action identity is unresolved'];
      return r;
    }

    const pm=Number(x.pmChange)||0;
    const ah=Number(x.ahChange)||0;
    const negativeExtended=Math.max(0,-pm)+Math.max(0,-ah);
    const positiveExtended=Math.max(0,pm,ah);

    // Critical semantic correction: a negative extended-hours move must never be rewarded
    // merely because its absolute magnitude is large.
    if(negativeExtended>0){
      const directionalPenalty=Math.min(32,negativeExtended*0.75);
      r.early=clamp(r.early-directionalPenalty);
      r.ignition=clamp(r.ignition-directionalPenalty*0.8);
      r.continuation=clamp(r.continuation-directionalPenalty*0.9);
      r.exhaustion=clamp(r.exhaustion+directionalPenalty);
      r.score=clamp(r.early*.55+r.continuation*.25+r.ignition*.2-r.exhaustion*.22);
      r.reasons=[...(r.reasons||[]),`Directional EH penalty ${directionalPenalty.toFixed(1)}`];
    }

    r.extendedHoursDirection={preMarket:pm,afterHours:ah,positiveMagnitude:positiveExtended,negativeMagnitude:negativeExtended};

    const runnerCount=Number(x.recentRunnerCount20d)||0;
    const priorMax=Number(x.priorMaxGain20d)||0;
    if(runnerCount>0 || priorMax>0){
      r.recentRunnerMemory={recentRunnerCount20d:runnerCount,priorMaxGain20d:priorMax};
      r.reasons.push('Recent-runner history present — apply Exhaustion Memory review');
    }

    const sourceCount=Number(x.independentSourceCount)||0;
    const reconciled=Boolean(x.finalReconciled) || x.dataIntegrityState==='RECONCILED';
    const stale=Boolean(root.TAGDataIntegrity&&root.TAGDataIntegrity.stale);
    r.dataConfidence=(reconciled&&sourceCount>=2&&!stale)?'RECONCILED':'UNRECONCILED';
    r.trainingEligible=Boolean(x.trainingEligible)&&r.dataConfidence==='RECONCILED';

    if(stale){
      r.reasons.push('STALE DATA — ranking is observational only');
      r.score=0;
      r.stage='LATE';
    } else if(!reconciled || sourceCount<2){
      r.reasons.push('Intraperiod/unreconciled snapshot — not training truth');
    }

    if(pm<0 && (r.stage==='DISCOVERY' || r.stage==='IGNITION')){
      r.stage='LATE';
      r.reasons.push('Negative pre-market directional gate');
    }
    return r;
  };

  root.TAG6TickerIdentity={tickerIdentityState,tickerMigrations};
})(typeof window!=='undefined'?window:globalThis);
