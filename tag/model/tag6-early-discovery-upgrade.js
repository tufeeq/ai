/* TAG6 Early-Discovery Upgrade — 2026-08-12 after-close reflection
 * Goal: rank remaining-upside ignition ahead of already-public momentum.
 * Provisional research overlay: no retrospective success claims and no version promotion.
 */
(function(root){
  const baseAnalyze=root.analyze;
  if(typeof baseAnalyze!=='function') return;
  const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
  const num=v=>{const n=Number(String(v??'').replace(/[%,$]/g,''));return Number.isFinite(n)?n:0};

  function lateDiscoveryPenalty(firstObservedChange,currentChange){
    const first=Math.abs(num(firstObservedChange));
    const cur=Math.abs(num(currentChange));
    let p=0;
    // These are guardrails for detection-timeliness, not validated predictive thresholds.
    if(first>=80) p+=46;
    else if(first>=50) p+=32;
    else if(first>=35) p+=18;
    if(cur>=120) p+=18;
    else if(cur>=80) p+=10;
    return clamp(p,0,70);
  }

  function overnightContinuity(x){
    const ah=num(x.ahChange), pm=num(x.pmChange);
    // Preserve direction: AH strength carried into PM is useful; a gap-down is not continuity.
    const positive=ah>0&&pm>0;
    const fade=ah>0&&pm<0;
    return {
      state:positive?'POSITIVE_CARRY':(fade?'OVERNIGHT_FADE':'UNCONFIRMED'),
      score:positive?clamp(Math.min(ah,40)*0.55+Math.min(pm,35)*0.65):0,
      penalty:fade?clamp(Math.abs(pm)*0.9+Math.min(ah,35)*0.25):0
    };
  }

  function persistenceAdjustment(x){
    const trend=String(x.persistenceTrend||'').toUpperCase();
    const retention=num(x.gainRetentionPct);
    let bonus=0,penalty=0;
    if(trend==='STRENGTHENING') bonus+=8;
    if(trend==='DECAYING') penalty+=12;
    if(retention>=85&&retention<=180) bonus+=6;
    if(retention>0&&retention<55) penalty+=10;
    return {bonus,penalty,trend,retention};
  }

  root.analyze=function TAG6EarlyDiscoveryAnalyze(x){
    const r=baseAnalyze(x);
    if(!r || r.score===0 && (r.dataConfidence==='DATA_INTEGRITY_ERROR'||(root.TAGDataIntegrity&&root.TAGDataIntegrity.stale))) return r;

    const first=num(x.firstObservedChange ?? x._firstObservedChange ?? x.changePct);
    const current=num(x.changePct);
    const latePenalty=lateDiscoveryPenalty(first,current);
    const overnight=overnightContinuity(x);
    const persistence=persistenceAdjustment(x);

    const firstAbs=Math.abs(first);
    const inIgnitionWindow=firstAbs>=5&&firstAbs<=35;
    const stillHasRoom=Math.abs(current)<=55;
    const ignitionWindowBonus=(inIgnitionWindow&&stillHasRoom)?12:0;

    // Early Discovery Score is intentionally distinct from raw momentum.
    const earlyDiscoveryScore=clamp(
      r.early*0.42 +
      r.ignition*0.23 +
      r.continuation*0.15 +
      overnight.score*0.10 +
      persistence.bonus +
      ignitionWindowBonus -
      latePenalty -
      persistence.penalty -
      overnight.penalty -
      r.exhaustion*0.16
    );

    r.earlyDiscoveryScore=earlyDiscoveryScore;
    r.firstObservedChangePct=first;
    r.lateDiscoveryPenalty=latePenalty;
    r.overnightContinuity=overnight;
    r.persistenceAdjustment=persistence;
    r.discoveryStatus=firstAbs>=50?'DETECTED_LATE':(firstAbs>=35?'LATE_IGNITION':'EARLY_WINDOW');

    // Ranking prioritizes remaining-upside discovery, not the biggest current gainer.
    r.score=clamp(earlyDiscoveryScore*0.68+r.continuation*0.20+r.ignition*0.12-r.exhaustion*0.12);

    if(firstAbs>=50){
      if(r.stage==='DISCOVERY'||r.stage==='IGNITION') r.stage='LATE';
      r.reasons=[...(r.reasons||[]),`Late discovery: first seen ${first>=0?'+':''}${first.toFixed(1)}%`];
    }
    if(firstAbs>=80){
      r.reasons.push('Visibility saturation: move was already public/extended at first observation');
    }
    if(inIgnitionWindow&&stillHasRoom){
      r.reasons.push(`Ignition candidate window: first seen ${first>=0?'+':''}${first.toFixed(1)}%`);
    }
    if(overnight.state==='POSITIVE_CARRY') r.reasons.push('AH→PM positive continuity');
    if(overnight.state==='OVERNIGHT_FADE') r.reasons.push('AH→PM fade penalty');
    if(persistence.trend==='STRENGTHENING') r.reasons.push('Persistence strengthening');
    if(persistence.trend==='DECAYING') r.reasons.push('Persistence decaying');

    // Strict Sharia actionability: UNVERIFIED remains visible for research, never actionable.
    r.actionable=r.sharia==='VERIFIED' && r.dataConfidence!=='DATA_INTEGRITY_ERROR' && !(root.TAGDataIntegrity&&root.TAGDataIntegrity.stale) && r.discoveryStatus!=='DETECTED_LATE';
    if(r.sharia==='UNVERIFIED') r.reasons.push('Sharia financial screen UNVERIFIED — research only');
    if(r.sharia==='EXCLUDED'){r.score=0;r.actionable=false;}

    return r;
  };

  root.TAG6EarlyDiscovery={lateDiscoveryPenalty,overnightContinuity,persistenceAdjustment};
})(typeof window!=='undefined'?window:globalThis);
