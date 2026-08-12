/* TAG6 Behavioral Learning Engine
 * Research/decision-support only. No retroactive prediction claims.
 */
(function(root){
  const median=a=>{const x=[...a].filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return 0;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2};
  const mad=a=>{const m=median(a);return median(a.map(v=>Math.abs(v-m)))||1e-9};
  const z=(v,a)=>{const m=median(a),d=mad(a)*1.4826;return d?((v-m)/d):0};
  function snapshotFeatures(r,baseline){
    const vols=baseline.map(x=>+x.volume||0), turns=baseline.map(x=>+x.turnover||0), ranges=baseline.map(x=>+x.rangePct||0), spreads=baseline.map(x=>+x.spreadPct||0), closes=baseline.map(x=>+x.closeLocation||0);
    return {
      volumeZ:z(+r.volume||0,vols), turnoverZ:z(+r.turnover||0,turns), volatilityZ:z(+r.rangePct||0,ranges),
      spreadZ:z(+r.spreadPct||0,spreads), closeLocationZ:z(+r.closeLocation||0,closes),
      higherLow:!!r.higherLow, absorption:!!r.absorption, extendedHoursParticipation:+r.extendedHoursParticipation||0,
      priceVolumeDivergence:+r.priceVolumeDivergence||0, relativeStrengthShift:+r.relativeStrengthShift||0
    };
  }
  function deviationScore(f){
    const pos=v=>Math.max(0,v);
    return pos(f.volumeZ)*1.4+pos(f.turnoverZ)*1.2+Math.abs(f.volatilityZ)*0.7+pos(-f.spreadZ)*0.5+pos(f.closeLocationZ)*0.6+(f.higherLow?0.7:0)+(f.absorption?0.9:0)+f.extendedHoursParticipation*2+Math.max(0,f.relativeStrengthShift)*0.8;
  }
  function classifyState(f,score){
    if(score<2)return 'NORMAL';
    if(f.volatilityZ<-0.8 && (f.volumeZ>0.8||f.turnoverZ>0.8))return 'COMPRESSION';
    if(score<4)return 'ACCUMULATION_OR_ANOMALY';
    if(score<6)return 'PRE_IGNITION';
    return 'IGNITION';
  }
  function buildFingerprint(record,baseline){
    const f=snapshotFeatures(record,baseline),score=deviationScore(f);
    return {ticker:record.ticker,timestampET:record.timestampET,features:f,deviationScore:score,state:classifyState(f,score),catalystState:record.catalystState||'CATALYST_UNVERIFIED',shariaStatus:record.shariaStatus||'UNVERIFIED',dataConfidence:record.dataConfidence||'UNVERIFIED'};
  }
  function reconstruct(history,lookback=20){
    const out=[];
    for(let i=lookback;i<history.length;i++)out.push(buildFingerprint(history[i],history.slice(i-lookback,i)));
    return out;
  }
  function firstDeviation(sequence,minScore=4){return sequence.find(x=>x.deviationScore>=minScore)||null;}
  function distance(a,b){const keys=['volumeZ','turnoverZ','volatilityZ','spreadZ','closeLocationZ','extendedHoursParticipation','relativeStrengthShift'];return Math.sqrt(keys.reduce((s,k)=>s+Math.pow((a.features[k]||0)-(b.features[k]||0),2),0));}
  function matchedControls(target,candidates,k=10){return candidates.filter(x=>x.ticker!==target.ticker).map(x=>({case:x,distance:distance(target,x)})).sort((a,b)=>a.distance-b.distance).slice(0,k);}
  function catalystRegime({freshNews=false,preconditioned=false,noNews=false}){if(freshNews&&preconditioned)return 'CATALYST_ON_PRECONDITION';if(freshNews)return 'NEWS_SHOCK';if(noNews&&preconditioned)return 'NO_NEWS_MOMENTUM';if(preconditioned)return 'PRECONDITIONED_MOVE';return 'CATALYST_UNVERIFIED';}
  function labelRetrospectivePattern(pattern){return {...pattern,status:'HYPOTHESIS_ONLY',countsAsPrediction:false};}
  root.TAG6Behavioral={snapshotFeatures,deviationScore,classifyState,buildFingerprint,reconstruct,firstDeviation,matchedControls,catalystRegime,labelRetrospectivePattern};
})(typeof window!=='undefined'?window:globalThis);
