(function(g){
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const ratio=(n,d)=>n/Math.max(d||1,1);
const materialThreshold=(rev,absoluteFloor,pctFloor,smallCompanyCapPct)=>Math.max(rev*pctFloor,Math.min(absoluteFloor,rev*smallCompanyCapPct));
function scoreCompany(s){
 const rev=Math.max(s.monthlyRevenue||1,1);
 const cash=clamp((s.cashRunwayDays||0)/90*100,0,100);
 const ar=100-clamp(ratio(s.overdueAR,rev)*100,0,100);
 const delivery=100-clamp(ratio(s.atRiskProjects,s.activeProjects)*100,0,100);
 const coverage=clamp(ratio(s.pipeline,rev)*25,0,100);
 const stalePenalty=clamp(ratio(s.stalePipeline,Math.max(s.pipeline||0,1))*100,0,100);
 const pipeline=clamp(coverage-stalePenalty*.5,0,100);
 const procurement=100-clamp(ratio(s.vendorLeakage,rev)*200,0,100);
 const customer=100-clamp((s.churnRiskPct||0),0,100);
 const people=100-clamp((s.overCapacityPct||0),0,100);
 return Math.round(cash*.20+ar*.18+delivery*.18+pipeline*.12+procurement*.08+customer*.12+people*.12);
}
function addDecision(d,x,realization){const expectedImpact=Math.round(x.impact*realization);d.push({...x,expectedImpact,priority:Math.round(expectedImpact*(x.confidence/100))});}
function detectDecisions(s){
 const d=[],rev=Math.max(s.monthlyRevenue||1,1),arR=ratio(s.overdueAR,rev),riskR=ratio(s.atRiskProjects,s.activeProjects);
 const arThreshold=materialThreshold(rev,25000,.05,.10),staleThreshold=materialThreshold(rev,50000,.10,.20),vendorThreshold=materialThreshold(rev,15000,.02,.05),customerThreshold=materialThreshold(rev,25000,.05,.10),peopleThreshold=materialThreshold(rev,25000,.04,.08);
 if(s.overdueAR>=arThreshold) addDecision(d,{domain:'Finance',severity:arR>.25?'critical':'high',title:'Accelerate overdue collections',impact:s.overdueAR,action:'Start risk-tiered collection sequence',confidence:clamp(Math.round(78+arR*40),78,97)},.32);
 if(s.cashRunwayDays<60) addDecision(d,{domain:'Finance',severity:s.cashRunwayDays<30?'critical':s.cashRunwayDays<45?'high':'medium',title:'Protect operating cash runway',impact:Math.round(rev*.15),action:'Model and delay non-critical spend',confidence:91},.50);
 if(s.atRiskProjects>0&&riskR>=.10) addDecision(d,{domain:'Delivery',severity:riskR>.25?'critical':'high',title:'Recover project margin',impact:s.atRiskProjects*42000,action:'Review scope, staffing and commercial recovery',confidence:88},.40);
 if(s.stalePipeline>=staleThreshold) addDecision(d,{domain:'Revenue',severity:ratio(s.stalePipeline,rev)>.75?'high':'medium',title:'Recover stale pipeline',impact:s.stalePipeline,action:'Launch prioritized personalized follow-up',confidence:86},.12);
 if(s.vendorLeakage>=vendorThreshold) addDecision(d,{domain:'Procurement',severity:ratio(s.vendorLeakage,rev)>.10?'high':'medium',title:'Consolidate supplier spend',impact:s.vendorLeakage,action:'Open supplier consolidation review',confidence:82},.75);
 if((s.churnRiskPct||0)>=35&&(s.revenueAtRisk||0)>=customerThreshold) addDecision(d,{domain:'Customer',severity:s.churnRiskPct>=65?'critical':'high',title:'Prevent customer churn',impact:s.revenueAtRisk,action:'Launch executive recovery plan',confidence:clamp(Math.round(70+s.churnRiskPct*.25),75,95)},.30);
 if((s.overCapacityPct||0)>=20&&(s.capacityRevenueAtRisk||0)>=peopleThreshold) addDecision(d,{domain:'People',severity:s.overCapacityPct>=40?'critical':'high',title:'Resolve capacity bottleneck',impact:s.capacityRevenueAtRisk,action:'Rebalance workload or add temporary capacity',confidence:84},.35);
 return d.sort((a,b)=>b.priority-a.priority||b.impact-a.impact);
}
function simulate(s,decision){const out={...s};if(decision.domain==='Finance'&&decision.title.includes('collections'))out.overdueAR=Math.round(out.overdueAR*.68);if(decision.title.includes('cash runway'))out.cashRunwayDays=Math.round(out.cashRunwayDays*1.18);if(decision.domain==='Delivery')out.atRiskProjects=Math.max(0,out.atRiskProjects-1);if(decision.domain==='Revenue'){const stale=out.stalePipeline||0;out.stalePipeline=Math.round(stale*.70);out.pipeline+=Math.round(stale*.05)}if(decision.domain==='Procurement')out.vendorLeakage=Math.round(out.vendorLeakage*.25);if(decision.domain==='Customer'){out.churnRiskPct=Math.max(0,(out.churnRiskPct||0)-18);out.revenueAtRisk=Math.round((out.revenueAtRisk||0)*.7)}if(decision.domain==='People'){out.overCapacityPct=Math.max(0,(out.overCapacityPct||0)-15);out.capacityRevenueAtRisk=Math.round((out.capacityRevenueAtRisk||0)*.65)}return out}
const api={scoreCompany,detectDecisions,simulate,materialThreshold};if(typeof module!=='undefined')module.exports=api;g.OperonEngine=api})(typeof window!=='undefined'?window:globalThis);
