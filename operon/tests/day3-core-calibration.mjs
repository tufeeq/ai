import assert from 'node:assert/strict';
import {emptyState,detect,dayAdd} from '../core.mjs';

const date='2026-09-16';
function stateWith(kind,records){const s=emptyState('Day 3 calibration');s.records[kind]=records;return s;}

const borderlineCustomers=Array.from({length:100},(_,i)=>({id:'bc'+i,name:'Borderline customer '+i,owner:'Owner',email:'',value:50000,health:59,renewal:dayAdd(date,180),status:'active',notes:'',updatedAt:date}));
const borderlinePeople=Array.from({length:100},(_,i)=>({id:'bp'+i,name:'Borderline capacity '+i,owner:'Owner',team:'Delivery',capacity:40,allocated:41,status:'active',notes:'',updatedAt:date}));
const borderlineTickets=Array.from({length:100},(_,i)=>({id:'bt'+i,name:'Borderline ticket '+i,customer:'',owner:'Owner',due:dayAdd(date,-1),priority:'low',status:'open',notes:'',updatedAt:date}));

const borderline=[
 ...detect(stateWith('customers',borderlineCustomers),date),
 ...detect(stateWith('people',borderlinePeople),date),
 ...detect(stateWith('tickets',borderlineTickets),date)
];
assert.equal(borderline.length,0,'Borderline 300-case set should not create management alerts');

const seriousCustomers=Array.from({length:100},(_,i)=>({id:'sc'+i,name:'Critical customer '+i,owner:'Owner',email:'',value:150000,health:32,renewal:dayAdd(date,20),status:'at_risk',notes:'',updatedAt:date}));
const seriousPeople=Array.from({length:100},(_,i)=>({id:'sp'+i,name:'Critical capacity '+i,owner:'Owner',team:'Delivery',capacity:40,allocated:60,status:'active',notes:'',updatedAt:date}));
const seriousTickets=Array.from({length:100},(_,i)=>({id:'st'+i,name:'Critical ticket '+i,customer:'',owner:'Owner',due:dayAdd(date,-1),priority:'critical',status:'open',notes:'',updatedAt:date}));
const serious=[
 ...detect(stateWith('customers',seriousCustomers),date),
 ...detect(stateWith('people',seriousPeople),date),
 ...detect(stateWith('tickets',seriousTickets),date)
];
assert.equal(serious.length,300,'All serious controls must remain detectable');
assert.equal(serious.filter(x=>x.severity==='critical').length,300,'Serious controls should remain critical');

const mixed=emptyState('Tier calibration');
mixed.records.customers=[
 {id:'mc1',name:'At-risk far renewal',owner:'Owner',email:'',value:100000,health:55,renewal:dayAdd(date,180),status:'at_risk',notes:'',updatedAt:date},
 {id:'mc2',name:'Near renewal',owner:'Owner',email:'',value:100000,health:52,renewal:dayAdd(date,45),status:'active',notes:'',updatedAt:date}
];
mixed.records.people=[
 {id:'mp1',name:'Moderate overload',owner:'Owner',team:'Delivery',capacity:40,allocated:45,status:'active',notes:'',updatedAt:date},
 {id:'mp2',name:'High overload',owner:'Owner',team:'Delivery',capacity:40,allocated:50,status:'active',notes:'',updatedAt:date},
 {id:'mp3',name:'Critical overload',owner:'Owner',team:'Delivery',capacity:40,allocated:65,status:'active',notes:'',updatedAt:date}
];
mixed.records.tickets=[
 {id:'mt1',name:'Low old ticket',customer:'',owner:'Owner',due:dayAdd(date,-10),priority:'low',status:'open',notes:'',updatedAt:date},
 {id:'mt2',name:'Medium overdue',customer:'',owner:'Owner',due:dayAdd(date,-4),priority:'medium',status:'open',notes:'',updatedAt:date},
 {id:'mt3',name:'High overdue',customer:'',owner:'Owner',due:dayAdd(date,-1),priority:'high',status:'open',notes:'',updatedAt:date},
 {id:'mt4',name:'Critical overdue',customer:'',owner:'Owner',due:dayAdd(date,-1),priority:'critical',status:'open',notes:'',updatedAt:date}
];
const tiered=detect(mixed,date);
const byId=Object.fromEntries(tiered.map(x=>[x.sourceId,x]));
assert.equal(byId.mc1.severity,'high');
assert.equal(byId.mc2.severity,'high');
assert.equal(byId.mp1.severity,'medium');
assert.equal(byId.mp2.severity,'high');
assert.equal(byId.mp3.severity,'critical');
assert.equal(byId.mt1.severity,'medium');
assert.equal(byId.mt2.severity,'medium');
assert.equal(byId.mt3.severity,'high');
assert.equal(byId.mt4.severity,'critical');

console.log(JSON.stringify({status:'PASS',day:3,borderlineCases:300,borderlineAlerts:borderline.length,seriousControls:300,seriousDetected:serious.length,seriousCritical:serious.filter(x=>x.severity==='critical').length,tieredCases:tiered.length},null,2));
