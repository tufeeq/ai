import {seedState,apply,metrics,detect,dayAdd} from '../core.mjs';import assert from 'node:assert/strict';
const actor={role:'owner',name:'Synthetic test operator'},start='2026-09-13';let s=seedState(start),executed=0;const report=[];
for(let day=0;day<3;day++){
 const date=dayAdd(start,day);s=apply(s,{type:'cycle'},actor,date).state;const before=s.decisions.length;
 for(const d of s.decisions.filter(x=>x.status==='pending').slice(0,8)){
  s=apply(s,{type:'decision.approve',id:d.id},actor,date).state;s=apply(s,{type:'decision.execute',id:d.id},actor,date).state;
  const task=s.tasks.find(t=>t.decisionId===d.id&&t.revision===d.revision);s=apply(s,{type:'task.save',task:{...task,status:'completed',notes:'Synthetic work completed in accelerated simulation'}},actor,date).state;
  s=apply(s,{type:'decision.verify',id:d.id,category:'operational',amount:0,evidence:'SIMULATION ONLY: synthetic review and resolution evidence for day '+(day+1)},actor,date).state;executed++;
 }
 for(let i=0;i<24;i++)s=apply(s,{type:'cycle'},actor,date).state;
 assert.equal(s.decisions.length,before);assert.equal(new Set(s.tasks.map(t=>t.decisionId+':'+t.revision)).size,s.tasks.length);
 report.push({day:day+1,date,signals:detect(s,date).length,decisions:s.decisions.length,tasks:s.tasks.length,verified:s.outcomes.length,recordedCash:metrics(s,date).verified});
}
assert.equal(metrics(s,start).verified,0);assert.equal(s.outcomes.length,executed);
let companies=0,records=0,signals=0;
for(let i=0;i<100;i++){const x=seedState(dayAdd(start,i%30));for(const rs of Object.values(x.records))records+=rs.length;signals+=x.decisions.length;companies++;assert(x.decisions.every(d=>Number.isFinite(d.exposure)&&d.exposure>=0));}
console.log(JSON.stringify({kind:'accelerated synthetic simulation; not three elapsed days or live business validation',days:report,stress:{companies,records,signals},checks:['no duplicate decisions','one task per decision revision','no invented cash','finite nonnegative exposure','three simulated operating days']},null,2));
