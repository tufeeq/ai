import {emptyState,detect,dayAdd} from '../core.mjs';
const date='2026-09-15';
function stateWith(kind,records){const s=emptyState('Day 2 diagnostic');s.records[kind]=records;return s;}
const customers=Array.from({length:100},(_,i)=>({id:'c'+i,name:'Borderline customer '+i,owner:'Owner',email:'',value:50000,health:59,renewal:dayAdd(date,180),status:'active',notes:'',updatedAt:date}));
const people=Array.from({length:100},(_,i)=>({id:'p'+i,name:'Borderline capacity '+i,owner:'Owner',team:'Delivery',capacity:40,allocated:41,status:'active',notes:'',updatedAt:date}));
const tickets=Array.from({length:100},(_,i)=>({id:'t'+i,name:'Low priority ticket '+i,customer:'',owner:'Owner',due:dayAdd(date,-1),priority:'low',status:'open',notes:'',updatedAt:date}));
const retention=detect(stateWith('customers',customers),date);
const capacity=detect(stateWith('people',people),date);
const service=detect(stateWith('tickets',tickets),date);
const highSeverity={retention:retention.filter(x=>x.severity==='high'||x.severity==='critical').length,capacity:capacity.filter(x=>x.severity==='high'||x.severity==='critical').length,service:service.filter(x=>x.severity==='high'||x.severity==='critical').length};
console.log(JSON.stringify({status:'DIAGNOSTIC',day:2,cases:300,borderlineRetentionAlerts:retention.length,borderlineCapacityAlerts:capacity.length,borderlineLowPriorityServiceAlerts:service.length,highSeverity,interpretation:'These are synthetic borderline scenarios used to measure possible alert fatigue. They are not labeled ground truth or real-world false positives.'},null,2));
