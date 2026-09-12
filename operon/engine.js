(function(g){
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const ratio=(n,d)=>n/Math.max(d||1,1);
function scoreCompany(s){
 const cash=clamp((s.cashRunwayDays||0)/90*100,0,100);
 const ar=100-clamp(ratio(s.overdueAR,s.monthlyRevenue)*100,0,100);
 const delivery=100-clamp(ratio(s.atRiskProjects,s.activeProjects)*100,0,100);
 const pipeline=clamp(ratio(s.pipeline,s.monthlyRevenue)*25,0,100);
 const customer=100-clamp((s.churnRiskPct||0),0,100);
 const people=100-clamp((s.overCapacityPct||0),0,100);
 return Math.round(cash*.24+ar*.20+delivery*.20+pipeline*.16+customer*.10+people*.10);
}
function detectDecisions(s){
 const d=[],rev=Math.max(s.monthlyRevenue||1,1),arR=ratio(s.overdueAR,rev),riskR=ratio(s.atRiskProjects,s.activeProjects);
 if(s.overdueAR>=Math.max(25000,rev*.05)) d.push({domain:'Finance',severity:arR>.25?'critical':'high',title:'Accelerate overdue collections',impact:s.overdueAR,action:'Start risk-tiered collection sequence',confidence:clamp(Math.round(78+arR*40),78,97)});
 if(s.cashRunwayDays<60) d.push({domain:'Finance',severity:s.cashRunwayDays<30?'critical':'high',title:'Protect operating cash runway',impact:Math.round(rev*.15),action:'Model and delay non-critical spend',confidence:91});
 if(s.atRiskProjects>0&&riskR>=.10) d.push({domain:'Delivery',severity:riskR>.25?'critical':'high',title:'Recover project margin',impact:s.atRiskProjects*42000,action:'Review scope, staffing and commercial recovery',confidence:88});
 if(s.stalePipeline>=Math.max(50000,rev*.10)) d.push({domain:'Revenue',severity:ratio(s.stalePipeline,rev)>.75?'high':'medium',title:'Recover stale pipeline',impact:s.stalePipeline,action:'Launch prioritized personalized follow-up',confidence:86});
 if(s.vendorLeakage>=Math.max(15000,rev*.02)) d.push({domain:'Procurement',severity:ratio(s.vendorLeakage,rev)>.10?'high':'medium',title:'Consolidate supplier spend',impact:s.vendorLeakage,action:'Open supplier consolidation review',confidence:82});
 if((s.churnRiskPct||0)>=35&&(s.revenueAtRisk||0)>=Math.max(25000,rev*.05)) d.push({domain:'Customer',severity:s.churnRiskPct>=65?'critical':'high',title:'Prevent customer churn',impact:s.revenueAtRisk,action:'Launch executive recovery plan',confidence:clamp(Math.round(70+s.churnRiskPct*.25),75,95)});
 if((s.overCapacityPct||0)>=20&&(s.capacityRevenueAtRisk||0)>=Math.max(25000,rev*.04)) d.push({domain:'People',severity:s.overCapacityPct>=40?'critical':'high',title:'Resolve capacity bottleneck',impact:s.capacityRevenueAtRisk,action:'Rebalance workload or add temporary capacity',confidence:84});
 return d.map(x=>({...x,priority:Math.round(x.impact*(x.confidence/100))})).sort((a,b)=>b.priority-a.priority);
}
function simulate(s,decision){const out={...s};if(decision.domain==='Finance'&&decision.title.includes('collections'))out.overdueAR=Math.round(out.overdueAR*.68);if(decision.title.includes('cash runway'))out.cashRunwayDays=Math.round(out.cashRunwayDays*1.18);if(decision.domain==='Delivery')out.atRiskProjects=Math.max(0,out.atRiskProjects-1);if(decision.domain==='Revenue')out.pipeline+=Math.round(decision.impact*.12);if(decision.domain==='Procurement')out.vendorLeakage=Math.round(out.vendorLeakage*.25);if(decision.domain==='Customer'){out.churnRiskPct=Math.max(0,(out.churnRiskPct||0)-18);out.revenueAtRisk=Math.round((out.revenueAtRisk||0)*.7)}if(decision.domain==='People'){out.overCapacityPct=Math.max(0,(out.overCapacityPct||0)-15);out.capacityRevenueAtRisk=Math.round((out.capacityRevenueAtRisk||0)*.65)}return out}
const api={scoreCompany,detectDecisions,simulate};if(typeof module!=='undefined')module.exports=api;g.OperonEngine=api})(typeof window!=='undefined'?window:globalThis);