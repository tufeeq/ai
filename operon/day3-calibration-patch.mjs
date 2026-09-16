import fs from 'node:fs';
const path='operon/core.mjs';
let src=fs.readFileSync(path,'utf8');
const swaps=[
 ["export const VERSION='2.1.0';","export const VERSION='2.2.0';"],
 [" for(const r of s.records.customers)if(r.status!=='closed'&&r.health<60)add('customers',r,'retention','Protect '+r.name,r.value,`Account health ${r.health}/100; renewal ${r.renewal}.`,'Create an account recovery plan and document the customer response.','high','Account value at risk; overlaps may exist with pipeline');",
 " for(const r of s.records.customers){const renewDays=days(r.renewal,date);const material=r.health<45||r.status==='at_risk'||renewDays<=90;if(r.status!=='closed'&&r.health<60&&material){const severity=r.health<35&&renewDays<=45?'critical':r.health<45||renewDays<=60||r.status==='at_risk'?'high':'medium';add('customers',r,'retention','Protect '+r.name,r.value,`Account health ${r.health}/100; renewal ${r.renewal} (${renewDays} days).`,'Create an account recovery plan and document the customer response.',severity,'Account value at risk; overlaps may exist with pipeline');}}"],
 [" for(const r of s.records.people)if(r.status==='active'&&r.allocated>r.capacity)add('people',r,'capacity','Rebalance '+r.name,0,`${r.allocated} hours allocated against ${r.capacity} available.`,'Review commitments and move work to available capacity.','high','Capacity issue; no unsupported monetary estimate');",
 " for(const r of s.records.people){const overload=r.capacity>0?(r.allocated-r.capacity)/r.capacity:0;if(r.status==='active'&&overload>=.10){const severity=overload>=.50?'critical':overload>=.25?'high':'medium';add('people',r,'capacity','Rebalance '+r.name,0,`${r.allocated} hours allocated against ${r.capacity} available (${Math.round(overload*100)}% over capacity).`,'Review commitments and move work to available capacity.',severity,'Capacity issue; no unsupported monetary estimate');}}"],
 [" for(const r of s.records.tickets)if(r.status!=='resolved'&&r.due<date)add('tickets',r,'sla','Resolve '+r.name,0,`Service deadline ${r.due} missed; priority ${r.priority}.`,'Assign resolution, update the customer, and record acceptance.',r.priority==='critical'?'critical':'high','Service issue; no unsupported monetary estimate');",
 " for(const r of s.records.tickets){const overdueDays=days(date,r.due);const qualifies=r.priority==='critical'||r.priority==='high'||r.priority==='medium'&&overdueDays>=3||r.priority==='low'&&overdueDays>=7;if(r.status!=='resolved'&&r.due<date&&qualifies){const severity=r.priority==='critical'?'critical':r.priority==='high'?'high':'medium';add('tickets',r,'sla','Resolve '+r.name,0,`Service deadline ${r.due} missed by ${overdueDays} days; priority ${r.priority}.`,'Assign resolution, update the customer, and record acceptance.',severity,'Service issue; no unsupported monetary estimate');}}"]
];
for(const [oldText,newText] of swaps){if(!src.includes(oldText))throw new Error('Expected source pattern not found: '+oldText.slice(0,80));src=src.replace(oldText,newText);}
fs.writeFileSync(path,src);
console.log('OPERON core calibrated for contextual customer, capacity, and service severity.');
// day3 retry marker
