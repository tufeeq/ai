import {mean,pct} from './data.mjs';
const weighted=bs=>{const v=bs.reduce((a,b)=>a+b.v,0);return v?bs.reduce((a,b)=>a+(b.vw??b.c)*b.v,0)/v:null;};
export function features(bs,{session,history=[],at}) {
  const b=bs.at(-1),recent=bs.slice(-3),baseline=bs.slice(-23,-3),prior=bs.slice(-6,-1);
  const tr=bs.slice(-15).slice(1).map((x,i)=>Math.max(x.h-x.l,Math.abs(x.h-bs.slice(-15)[i].c),Math.abs(x.l-bs.slice(-15)[i].c)));
  const avg=mean(baseline.map(x=>x.v)),contiguous=recent.length===3&&Date.parse(recent[2].t)-Date.parse(recent[0].t)===120000;
  const sameMinute=history.filter(x=>Date.parse(x.received_at)<session.pre&&x.minute===Math.floor((Date.parse(b.t)-session.open)/60000)&&x.feed===b.feed);
  const regular=bs.filter(x=>Date.parse(x.t)>=session.open&&Date.parse(x.t)<session.close);
  const pre=bs.filter(x=>Date.parse(x.t)>=session.pre&&Date.parse(x.t)<session.open);
  return {version:'elite-features-1',atr:mean(tr),priorHigh:prior.length?Math.max(...prior.map(x=>x.h)):null,priorLow:prior.length?Math.min(...prior.map(x=>x.l)):null,
    volumeRatio3ObservedBars:avg>0?mean(recent.map(x=>x.v))/avg:null,
    volumeRatio3Minutes:contiguous&&avg>0?mean(recent.map(x=>x.v))/avg:null,
    return3ObservedBars:pct(b.c,recent[0]?.o),threeBarsAreContiguousMinutes:contiguous,
    trades3Minutes:contiguous&&recent.every(x=>x.n!==null)?recent.reduce((a,x)=>a+x.n,0):null,
    tradeRateChange:contiguous&&baseline.every(x=>x.n!==null)&&mean(baseline.map(x=>x.n))>0?mean(recent.map(x=>x.n))/mean(baseline.map(x=>x.n)):null,
    dollars3ObservedBars:recent.reduce((a,x)=>a+x.c*x.v,0),priceProgressPer100kShares:recent.reduce((a,x)=>a+x.v,0)>0?(b.c-recent[0].o)/recent.reduce((a,x)=>a+x.v,0)*100000:null,
    vwapRegularObserved:weighted(regular),vwapPremarketObserved:weighted(pre),vwapLast90ObservedBars:weighted(bs.slice(-90)),
    sameTimeRelativeVolume:sameMinute.length>=5?b.v/mean(sameMinute.map(x=>x.volume)):null,sameTimeSample:sameMinute.length,
    orderFlowImbalance:null,tradeSideFlow:null,unavailable:['ORDER_BOOK','AGGRESSOR_CLASSIFICATION',...(sameMinute.length<5?['SAME_TIME_HISTORY_INSUFFICIENT']:[])],at};
}
