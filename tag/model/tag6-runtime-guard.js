/* TAG6 Runtime Guard
 * Corrects directional semantics in extended hours and prevents stale/unreconciled data
 * from being treated as high-confidence actionable evidence.
 */
(function(root){
  const baseAnalyze=root.analyze;
  if(typeof baseAnalyze!=='function') return;
  const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));

  root.analyze=function TAG6AnalyzeGuarded(x){
    const r=baseAnalyze(x);
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

    // Positive extended-hours magnitude is descriptive only here; the base engine may use it,
    // but this guard does not add a second reward.
    r.extendedHoursDirection={preMarket:pm,afterHours:ah,positiveMagnitude:positiveExtended,negativeMagnitude:negativeExtended};

    // Recent-runner memory: consume historical fields when the data pipeline supplies them.
    const runnerCount=Number(x.recentRunnerCount20d)||0;
    const priorMax=Number(x.priorMaxGain20d)||0;
    if(runnerCount>0 || priorMax>0){
      r.recentRunnerMemory={recentRunnerCount20d:runnerCount,priorMaxGain20d:priorMax};
      r.reasons.push('Recent-runner history present — apply Exhaustion Memory review');
    }

    // Integrity semantics. Intraperiod and single-source observations may be displayed,
    // but cannot be promoted as reconciled training truth or high-confidence actionability.
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

    // A strongly negative pre-market state cannot remain DISCOVERY solely from RVOL/absolute EH magnitude.
    if(pm<0 && (r.stage==='DISCOVERY' || r.stage==='IGNITION')){
      r.stage='LATE';
      r.reasons.push('Negative pre-market directional gate');
    }
    return r;
  };
})(typeof window!=='undefined'?window:globalThis);
