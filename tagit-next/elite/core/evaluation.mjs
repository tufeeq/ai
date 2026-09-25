import {pct,mean} from './data.mjs';
export function discoveryOutcome(o,bars,close,{horizonMinutes=null}={}) {
 const start=Date.parse(o.first_at),end=Math.min(close,horizonMinutes?start+horizonMinutes*60000:close);
 const future=bars.filter(b=>Date.parse(b.t)>=start&&Date.parse(b.t)<end),expected=Math.max(0,(end-start)/60000);
 const complete=expected>0&&Number.isInteger(expected)&&future.length===expected&&future.every((b,i)=>Date.parse(b.t)===start+i*60000);
 const hits={};for(const target of [10,20,50]){
  const index=future.findIndex(b=>pct(b.h,o.first_price)>=target),hit=index<0?null:future[index];
  hits[target]={status:hit?'OBSERVED_HIT':complete?'NOT_HIT_COMPLETE_PATH':'UNKNOWN',minutesToHit:hit?(Date.parse(hit.t)+60000-start)/60000:null,
    drawdownThroughHitPct:hit?pct(Math.min(...future.slice(0,index+1).map(x=>x.l)),o.first_price):null,intrabarOrder:hit?'HIGH_LOW_ORDER_UNKNOWN':null};
 }
 return {complete,expectedMinutes:expected,observedMinutes:future.length,horizonMinutes:(end-start)/60000,censoredByClose:horizonMinutes!==null&&end<start+horizonMinutes*60000,
   observedPeakPct:future.length?pct(Math.max(...future.map(x=>x.h)),o.first_price):null,observedMAEPct:future.length?pct(Math.min(...future.map(x=>x.l)),o.first_price):null,
   closePct:future.at(-1)&&Date.parse(future.at(-1).t)===end-60000?pct(future.at(-1).c,o.first_price):null,hits,peakIsExecutableExit:false};
}
export function partitions(dates){const ds=[...new Set(dates)].sort();const train=Math.floor(ds.length*.6),val=Math.floor(ds.length*.8);return {development:ds.slice(0,train),validationDiagnostic:ds.slice(train,val),testDiagnostic:ds.slice(val),independent:false,reason:'All ten sessions were previously exposed. No untouched test exists.'};}
export function walkForward(dates,minTrain=5,testSize=1){const ds=[...new Set(dates)].sort(),folds=[];for(let i=minTrain;i<ds.length;i+=testSize)folds.push({train:ds.slice(0,i),test:ds.slice(i,i+testSize),independent:false});return folds;}
export function synchrony(events,eligibleAt,windowMinutes=5){
 return events.map(e=>{const at=Date.parse(e.first_at),windowStart=at-windowMinutes*60000;const denominator=eligibleAt?.(at)??null;const peers=new Set(events.filter(x=>Date.parse(x.first_at)>=windowStart&&Date.parse(x.first_at)<=at).map(x=>x.symbol)).size;
   return {at:e.first_at,signalSymbols:peers,eligibleDenominator:denominator,rate:denominator>0?peers/denominator:null,waveStartSynchrony:null,tradeAccelerationSynchrony:null,causalClaim:false};});
}
export function stockProfiles(opportunities){const groups=Map.groupBy(opportunities,o=>o.symbol);return [...groups].map(([symbol,os])=>({symbol,observations:os.length,status:os.length>=20?'DESCRIPTIVE_ONLY':'INSUFFICIENT',meanObservedFollowupMinutes:mean(os.map(o=>o.ageMinutes)),discoveryPhaseCounts:Object.fromEntries([...Map.groupBy(os,o=>o.firstSessionPhase)].map(([p,rs])=>[p,rs.length])),recoveryAttempts:os.reduce((a,o)=>a+o.recoveryAttempts,0),newsResponse:'NOT_EVALUABLE',peerGroup:'Requires point-in-time industry, float and capitalization'}));}
