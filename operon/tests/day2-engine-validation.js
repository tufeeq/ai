const assert=require('assert');
const E=require('../engine');
const day1={monthlyRevenue:872000,cashRunwayDays:36,overdueAR:468000,activeProjects:15,atRiskProjects:5,pipeline:5980000,stalePipeline:1710000,vendorLeakage:224000,churnRiskPct:57,revenueAtRisk:310000,overCapacityPct:34,capacityRevenueAtRisk:215000};
const day2={monthlyRevenue:890000,cashRunwayDays:44,overdueAR:352000,activeProjects:16,atRiskProjects:3,pipeline:6150000,stalePipeline:1080000,vendorLeakage:71000,churnRiskPct:49,revenueAtRisk:255000,overCapacityPct:41,capacityRevenueAtRisk:275000};
const d1=E.detectDecisions(day1),d2=E.detectDecisions(day2),score1=E.scoreCompany(day1),score2=E.scoreCompany(day2);
assert(score2>score1,'Day 2 partial recovery should improve health versus Day 1');
assert.deepStrictEqual(new Set(d2.map(x=>x.domain)),new Set(['Finance','Revenue','Delivery','Procurement','Customer','People']));
const people=d2.find(x=>x.domain==='People');assert(people&&people.severity==='critical','Capacity shock should be critical on Day 2');
const cash=d2.find(x=>x.title.includes('cash runway'));assert(cash&&cash.severity==='high','44-day runway should remain high severity');
let state={...day2};for(const decision of d2)state=E.simulate(state,decision);const endScore=E.scoreCompany(state);assert(endScore>score2,'Modeled interventions should improve Day 2 health');
const healthy={monthlyRevenue:100000,cashRunwayDays:120,overdueAR:0,activeProjects:10,atRiskProjects:0,pipeline:300000,stalePipeline:0,vendorLeakage:0,churnRiskPct:5,revenueAtRisk:0,overCapacityPct:5,capacityRevenueAtRisk:0};
const materialCases=[
 [{...healthy,overdueAR:24000},'Finance'],
 [{...healthy,stalePipeline:40000},'Revenue'],
 [{...healthy,vendorLeakage:12000},'Procurement'],
 [{...healthy,churnRiskPct:80,revenueAtRisk:24000},'Customer'],
 [{...healthy,overCapacityPct:60,capacityRevenueAtRisk:20000},'People']
];
for(const [stateCase,domain] of materialCases)assert(E.detectDecisions(stateCase).some(x=>x.domain===domain),'SME materiality miss: '+domain);
const noiseCases=[
 {...healthy,overdueAR:4000},
 {...healthy,stalePipeline:8000},
 {...healthy,vendorLeakage:1000},
 {...healthy,churnRiskPct:30,revenueAtRisk:50000},
 {...healthy,overCapacityPct:15,capacityRevenueAtRisk:50000}
];
assert(noiseCases.every(x=>E.detectDecisions(x).length===0),'Noise controls should not create alerts');
const nearRunway={...healthy,cashRunwayDays:59};const runwayDecision=E.detectDecisions(nearRunway).find(x=>x.title.includes('cash runway'));assert(runwayDecision&&runwayDecision.severity==='medium','59-day runway should be monitored without high-severity escalation');
console.log(JSON.stringify({status:'PASS',day:2,day1Score:score1,day2Score:score2,postInterventionScore:endScore,healthLift:endScore-score2,decisionCount:d2.length,topDecisions:d2.slice(0,5).map(({domain,title,severity,impact,expectedImpact,priority})=>({domain,title,severity,impact,expectedImpact,priority})),smeMaterialityCases:materialCases.length,smeMaterialityMisses:0,noiseCases:noiseCases.length,noiseFalseAlerts:0,postState:state},null,2));
