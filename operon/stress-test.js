const E=require('./engine');
let seed=20260913;function rnd(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}function ri(a,b){return Math.floor(a+rnd()*(b-a+1))}
const N=10000;let alerts=0,healthyAlerts=0,domainHits={},scoreMin=101,scoreMax=-1,monotonicFailures=0;
for(let i=0;i<N;i++){
 const rev=ri(100000,5000000),active=ri(1,60);
 const s={monthlyRevenue:rev,cashRunwayDays:ri(5,180),overdueAR:ri(0,Math.floor(rev*.9)),activeProjects:active,atRiskProjects:ri(0,active),pipeline:ri(0,rev*12),stalePipeline:ri(0,rev*3),vendorLeakage:ri(0,Math.floor(rev*.35)),churnRiskPct:ri(0,90),revenueAtRisk:ri(0,rev*2),overCapacityPct:ri(0,70),capacityRevenueAtRisk:ri(0,rev)};
 const score=E.scoreCompany(s),d=E.detectDecisions(s);scoreMin=Math.min(scoreMin,score);scoreMax=Math.max(scoreMax,score);alerts+=d.length;d.forEach(x=>domainHits[x.domain]=(domainHits[x.domain]||0)+1);
 const healthy={...s,cashRunwayDays:120,overdueAR:0,atRiskProjects:0,stalePipeline:0,vendorLeakage:0,churnRiskPct:5,revenueAtRisk:0,overCapacityPct:5,capacityRevenueAtRisk:0};healthyAlerts+=E.detectDecisions(healthy).length;
 if(d.length){const before=score,after=E.scoreCompany(E.simulate(s,d[0]));if(after<before)monotonicFailures++;}
}
if(healthyAlerts!==0)throw new Error('False positive on healthy controls');if(monotonicFailures>0)throw new Error('Top-action simulation worsened health in '+monotonicFailures+' cases');
console.log(JSON.stringify({status:'PASS',scenarios:N,avgAlerts:+(alerts/N).toFixed(2),healthyControlFalseAlerts:healthyAlerts,scoreRange:[scoreMin,scoreMax],domainHits,monotonicFailures},null,2));