export const VERSION='2.0.0';
export const kinds={
 customers:{label:'Customers',domain:'Customer',fields:{name:'text',owner:'text',email:'email',value:'money',health:'percent',renewal:'date',status:['active','at_risk','closed'],notes:'textarea'}},
 invoices:{label:'Receivables',domain:'Finance',fields:{name:'text',customer:'customer',owner:'text',amount:'money',paid:'money',due:'date',status:['open','disputed','paid'],notes:'textarea'}},
 deals:{label:'Sales pipeline',domain:'Revenue',fields:{name:'text',customer:'customer',owner:'text',amount:'money',probability:'percent',lastContact:'date',due:'date',status:['qualified','proposal','negotiation','won','lost'],notes:'textarea'}},
 projects:{label:'Delivery',domain:'Delivery',fields:{name:'text',customer:'customer',owner:'text',budget:'money',cost:'money',progress:'percent',due:'date',status:['active','blocked','completed'],notes:'textarea'}},
 vendors:{label:'Procurement',domain:'Procurement',fields:{name:'text',owner:'text',spend:'money',baseline:'money',due:'date',status:['active','review','closed'],notes:'textarea'}},
 people:{label:'Capacity',domain:'People',fields:{name:'text',owner:'text',team:'text',capacity:'number',allocated:'number',status:['active','leave'],notes:'textarea'}},
 tickets:{label:'Service desk',domain:'Customer',fields:{name:'text',customer:'customer',owner:'text',due:'date',priority:['low','medium','high','critical'],status:['open','in_progress','resolved'],notes:'textarea'}}
};
const clone=x=>structuredClone(x);
const uuid=()=>globalThis.crypto.randomUUID();
export const today=()=>new Date().toISOString().slice(0,10);
export const dayAdd=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const days=(a,b)=>Math.floor((Date.parse(a)-Date.parse(b))/86400000);
const sum=(xs,fn)=>xs.reduce((a,x)=>a+fn(x),0);
export function emptyState(name='My company'){return {version:0,company:{name,currency:'SAR',cash:0,monthlyBurn:0,approvalLimit:50000,cycleMinutes:60,automation:false},records:Object.fromEntries(Object.keys(kinds).map(k=>[k,[]])),payments:[],decisions:[],tasks:[],audit:[],outcomes:[],cycles:[],imports:[],lastCycle:null};}
export function seedState(date=today()){
 const s=emptyState('Meridian Advisory');s.company={...s.company,cash:420000,monthlyBurn:295000};
 const names=['Northstar Group','Falcon Industries','Cedar Health','Atlas Logistics','Horizon Education','Nova Digital','Palm Capital','Orbit Ventures'];
 s.records.customers=names.map((name,i)=>({id:'c'+i,name,owner:['Sara','Omar','Layla'][i%3],email:'',value:90000+i*25000,health:[38,82,61,45,92,76,55,88][i],renewal:dayAdd(date,i*11+8),status:i%3===0?'at_risk':'active',notes:'Synthetic example account',updatedAt:date}));
 for(let i=0;i<24;i++)s.records.invoices.push({id:'i'+i,name:'INV-'+(1040+i),customer:'c'+i%8,owner:'Sara',amount:18000+(i%7)*11500,paid:i%5===0?18000+(i%7)*11500:i%4===0?5000:0,due:dayAdd(date,(i-15)*3),status:i%5===0?'paid':i===3?'disputed':'open',notes:'Synthetic invoice',updatedAt:date});
 s.records.deals=Array.from({length:12},(_,i)=>({id:'d'+i,name:['Expansion retainer','Transformation program','Capability academy','Strategy engagement'][i%4]+' '+(i+1),customer:'c'+i%8,owner:['Omar','Layla'][i%2],amount:65000+i*28000,probability:25+i%4*20,lastContact:dayAdd(date,-i*4),due:dayAdd(date,10+i*4),status:['qualified','proposal','negotiation'][i%3],notes:'Synthetic opportunity',updatedAt:date}));
 s.records.projects=Array.from({length:8},(_,i)=>({id:'p'+i,name:['Falcon transformation','Northstar academy','Cedar operating model','Atlas rollout','Horizon strategy','Nova launch','Palm research','Orbit readiness'][i],customer:'c'+i,owner:['Layla','Omar'][i%2],budget:140000+i*17000,cost:50000+i*22000,progress:30+i*8,due:dayAdd(date,i*5-7),status:i===0?'blocked':'active',notes:'Synthetic delivery engagement',updatedAt:date}));
 s.records.vendors=Array.from({length:5},(_,i)=>({id:'v'+i,name:['Atlas Technology','Clearview Research','Studio Six','Cloud Services','Venue Partners'][i],owner:'Sara',spend:30000+i*11000,baseline:28000+i*7000,due:dayAdd(date,i*8+5),status:'active',notes:'Monthly supplier spend; synthetic',updatedAt:date}));
 s.records.people=Array.from({length:10},(_,i)=>({id:'h'+i,name:['Sara Ahmed','Omar Ali','Layla Hassan','Nora Saleh','Fahad Khalid','Reem Abdullah','Yousef Sami','Hana Adel','Zaid Nasser','Lina Tariq'][i],owner:'Layla',team:['Advisory','Delivery','Research'][i%3],capacity:40,allocated:25+i*4,status:'active',notes:'Weekly hours; synthetic',updatedAt:date}));
 s.records.tickets=Array.from({length:6},(_,i)=>({id:'t'+i,name:['Scope clarification','Reporting discrepancy','Access request','Milestone acceptance','Invoice dispute','Training feedback'][i],customer:'c'+i,owner:'Omar',priority:i%2?'medium':'high',due:dayAdd(date,i-3),status:'open',notes:'Synthetic service request',updatedAt:date}));
 return apply(s,{type:'cycle'},{role:'owner',name:'Demo operator'},date).state;
}
export function metrics(s,date=today()){
 const r=s.records, outstanding=sum(r.invoices,x=>Math.max(0,x.amount-x.paid)),overdue=sum(r.invoices.filter(x=>x.due<date&&x.status!=='paid'),x=>Math.max(0,x.amount-x.paid));
 const pipeline=sum(r.deals.filter(x=>!['won','lost'].includes(x.status)),x=>x.amount),weighted=sum(r.deals.filter(x=>!['won','lost'].includes(x.status)),x=>x.amount*x.probability/100);
 const projects=r.projects.filter(x=>x.status!=='completed'),risk=projects.filter(x=>x.status==='blocked'||x.due<date||x.cost>x.budget*.85&&x.progress<80).length;
 const verified=sum(s.outcomes.filter(x=>x.category==='cash_received'),x=>x.amount);
 return {outstanding,overdue,pipeline,weighted,projects:projects.length,atRisk:risk,runway:s.company.monthlyBurn?Math.floor(s.company.cash/s.company.monthlyBurn*30):null,verified,pending:s.decisions.filter(x=>x.status==='pending').length,openTasks:s.tasks.filter(x=>x.status!=='completed').length};
}
export function detect(s,date=today()){
 const out=[];const add=(kind,r,rule,title,exposure,evidence,action,severity='high',basis='Exposure, not guaranteed recovery')=>out.push({id:rule+':'+r.id,kind,sourceId:r.id,domain:kinds[kind].domain,rule,title,exposure:Math.round(exposure),evidence,action,severity,basis,owner:r.owner||'Unassigned',due:dayAdd(date,2),sourceUpdatedAt:r.updatedAt});
 for(const r of s.records.invoices)if(r.amount>r.paid&&r.due<date&&r.status!=='paid')add('invoices',r,'overdue','Collect '+r.name,r.amount-r.paid,`${days(date,r.due)} days overdue; ${r.paid} received against ${r.amount}.`,r.status==='disputed'?'Resolve the invoice dispute and record an agreed payment date.':'Review the invoice and prepare a payment follow-up.',days(date,r.due)>30?'critical':'high');
 for(const r of s.records.deals)if(!['won','lost'].includes(r.status)&&days(date,r.lastContact)>14)add('deals',r,'stale','Re-engage '+r.name,r.amount,`${days(date,r.lastContact)} days without contact; stage ${r.status}.`,'Review the opportunity and record the next customer meeting.','medium','Open deal value; not incremental revenue');
 for(const r of s.records.projects)if(r.status!=='completed'&&(r.status==='blocked'||r.due<date||r.cost>r.budget*.85&&r.progress<80))add('projects',r,'delivery','Recover '+r.name,Math.max(0,r.budget-r.cost),`${r.progress}% delivered; cost ${r.cost} of ${r.budget}; due ${r.due}.`,'Agree a recovery plan, owner, milestone, and revised delivery date.',r.due<date?'critical':'high','Remaining budget exposed; not savings');
 for(const r of s.records.vendors)if(r.status!=='closed'&&r.baseline>0&&r.spend>r.baseline*1.1)add('vendors',r,'spend','Review '+r.name,r.spend-r.baseline,`${Math.round((r.spend/r.baseline-1)*100)}% above baseline (${r.baseline}).`,'Review like-for-like scope and negotiate a revised supplier rate.','medium','Spend above baseline; validate scope before claiming savings');
 for(const r of s.records.customers)if(r.status!=='closed'&&r.health<60)add('customers',r,'retention','Protect '+r.name,r.value,`Account health ${r.health}/100; renewal ${r.renewal}.`,'Create an account recovery plan and document the customer response.','high','Account value at risk; overlaps may exist with pipeline');
 for(const r of s.records.people)if(r.status==='active'&&r.allocated>r.capacity)add('people',r,'capacity','Rebalance '+r.name,0,`${r.allocated} hours allocated against ${r.capacity} available.`,'Review commitments and move work to available capacity.','high','Capacity issue; no unsupported monetary estimate');
 for(const r of s.records.tickets)if(r.status!=='resolved'&&r.due<date)add('tickets',r,'sla','Resolve '+r.name,0,`Service deadline ${r.due} missed; priority ${r.priority}.`,'Assign resolution, update the customer, and record acceptance.',r.priority==='critical'?'critical':'high','Service issue; no unsupported monetary estimate');
 return out.sort((a,b)=>(a.severity==='critical'?-1:1)-(b.severity==='critical'?-1:1)||b.exposure-a.exposure);
}
function required(v,msg){if(!v)throw Error(msg);}
function text(v,max=2000){return String(v??'').trim().slice(0,max);}
function num(v,min=0,max=1e12){const n=Number(v);required(Number.isFinite(n)&&n>=min&&n<=max,'Invalid numeric value');return Math.round(n*100)/100;}
export function validateRecord(kind,data,s){
 required(kinds[kind],'Unknown record type');const out={};
 for(const [k,t] of Object.entries(kinds[kind].fields)){
  if(Array.isArray(t)){required(t.includes(data[k]),'Invalid '+k);out[k]=data[k];}
  else if(['money','number','percent'].includes(t))out[k]=num(data[k]??0,0,t==='percent'?100:1e12);
  else if(t==='date'){out[k]=text(data[k],10);required(/^\d{4}-\d{2}-\d{2}$/.test(out[k])&&Number.isFinite(Date.parse(out[k]))&&new Date(out[k]).toISOString().slice(0,10)===out[k],'Valid '+k+' date required');}
  else if(t==='customer'){out[k]=text(data[k],100);required(!out[k]||s.records.customers.some(x=>x.id===out[k]),'Customer does not exist in this workspace');}
  else out[k]=text(data[k],t==='textarea'?4000:200);
 }
 required(out.name,'Name is required');
 if(kind==='invoices'){required(out.paid<=out.amount,'Payment exceeds invoice amount');required((out.status==='paid')===(out.paid===out.amount),'Paid status must match the invoice balance');}
 return out;
}
export function apply(input,command,actor={role:'viewer',name:'Unknown'},date=today()){
 required(['owner','manager','operator'].includes(actor.role),'Read-only role cannot change workspace data');
 const s=clone(input),c=command;let result={};const timestamp=new Date().toISOString();
 const audit=(action,entity,detail)=>s.audit.unshift({id:uuid(),at:timestamp,actor:actor.name,action,entity,detail:text(detail,4000)});
 const manage=()=>required(['owner','manager'].includes(actor.role),'Manager approval required');
 const findDecision=()=>{let d=s.decisions.find(x=>x.id===c.id);required(d,'Decision not found');return d;};
 if(c.type==='record.save'){
  const value=validateRecord(c.kind,c.record,s);let existing=s.records[c.kind].find(x=>x.id===c.record.id);
  if(c.record.id)required(existing,'Record not found');if(existing&&c.kind==='invoices')required(existing.paid===value.paid,'Use Record payment to change the paid balance');
  const r={...(existing?.dealId?{dealId:existing.dealId}:{}),...value,id:existing?.id||uuid(),updatedAt:timestamp};
  if(existing)s.records[c.kind][s.records[c.kind].indexOf(existing)]=r;else s.records[c.kind].push(r);
  audit(existing?'Record updated':'Record created',r.id,r.name);result={id:r.id};
 }else if(c.type==='invoice.payment'){
  manage();const invoice=s.records.invoices.find(x=>x.id===c.id);required(invoice,'Invoice not found');const amount=num(c.amount,0.01);required(amount<=Math.round((invoice.amount-invoice.paid)*100)/100,'Payment exceeds outstanding balance');const reference=text(c.reference,200);required(reference.length>=4,'Payment reference required');s.payments??=[];required(!s.payments.some(x=>x.reference===reference),'Payment reference already recorded');
  invoice.paid=Math.round((invoice.paid+amount)*100)/100;invoice.status=invoice.paid===invoice.amount?'paid':invoice.status;invoice.updatedAt=timestamp;s.company.cash=Math.round((s.company.cash+amount)*100)/100;s.payments.push({id:uuid(),invoiceId:invoice.id,amount,reference,at:timestamp,actor:actor.name});audit('Payment recorded',invoice.id,amount+' received; reference '+reference+'; manually attested');
 }else if(c.type==='deal.convert'){
  manage();const deal=s.records.deals.find(x=>x.id===c.id);required(deal,'Deal not found');required(!['won','lost'].includes(deal.status),'This deal is already closed');required(!s.records.projects.some(x=>x.dealId===deal.id),'Deal already converted');const deposit=num(c.deposit,0,100),due=text(c.due,10);required(/^\d{4}-\d{2}-\d{2}$/.test(due)&&Number.isFinite(Date.parse(due)),'Valid delivery date required');
  const project={id:uuid(),dealId:deal.id,name:deal.name,customer:deal.customer,owner:deal.owner,budget:deal.amount,cost:0,progress:0,due,status:'active',notes:'Converted from won deal '+deal.name,updatedAt:timestamp};s.records.projects.push(project);
  if(deposit>0){const invoice={id:uuid(),dealId:deal.id,name:'INV-'+uuid().slice(0,8).toUpperCase(),customer:deal.customer,owner:deal.owner,amount:Math.round(deal.amount*deposit)/100,paid:0,due:dayAdd(date,14),status:'open',notes:'Deposit for '+deal.name,updatedAt:timestamp};s.records.invoices.push(invoice);result.invoiceId=invoice.id;}
  deal.status='won';deal.probability=100;deal.updatedAt=timestamp;result.projectId=project.id;audit('Deal won and handed to delivery',deal.id,project.name+'; deposit '+deposit+'%; no invoice sent externally');
 }else if(c.type==='record.archive'){
  manage();required(kinds[c.kind],'Unknown record type');const r=s.records[c.kind].find(x=>x.id===c.id);required(r,'Record not found');
  if(c.kind==='customers')required(!Object.values(s.records).flat().some(x=>x.customer===c.id),'Customer has linked records');
  required(!s.decisions.some(x=>x.sourceId===c.id&&!['verified','rejected','superseded'].includes(x.status)),'Resolve linked decisions before removing the record');
  s.records[c.kind]=s.records[c.kind].filter(x=>x.id!==c.id);audit('Record removed',r.id,r.name);
 }else if(c.type==='import'){
  required(kinds[c.kind]&&Array.isArray(c.rows)&&c.rows.length>0&&c.rows.length<=1000,'Import requires 1–1000 rows');
  const valid=c.rows.map(r=>validateRecord(c.kind,r,s));let count=0;
  for(const r of valid){const existing=s.records[c.kind].find(x=>x.name===r.name);if(existing){Object.assign(existing,r,{updatedAt:timestamp});}else{s.records[c.kind].push({...r,id:uuid(),updatedAt:timestamp});}count++;}
  s.imports.unshift({id:uuid(),kind:c.kind,count,at:timestamp,actor:actor.name});audit('Records imported',c.kind,count+' validated rows; matched by name');result={count};
 }else if(c.type==='cycle'){
  const detected=detect(s,date),ids=new Set(detected.map(x=>x.id));let added=0;
  for(const item of detected){const existing=s.decisions.find(x=>x.id===item.id);if(!existing){s.decisions.push({...item,status:'pending',createdAt:timestamp,revision:1});added++;}else if(existing.status==='pending'){Object.assign(existing,item);}else if(existing.status==='approved'&&existing.sourceUpdatedAt!==item.sourceUpdatedAt){Object.assign(existing,item,{status:'pending',revision:existing.revision+1});audit('Approval invalidated',existing.id,'Source record changed; fresh approval required');} }
  for(const d of s.decisions)if(['pending','approved'].includes(d.status)&&!ids.has(d.id)){d.status='superseded';audit('Signal resolved',d.id,'Underlying record no longer breaches the rule');}
  s.lastCycle=timestamp;s.cycles.unshift({id:uuid(),at:timestamp,date,signals:detected.length,created:added});audit('Operating cycle',date,added+' new decisions; '+detected.length+' current signals');result={added,signals:detected.length};
 }else if(['decision.approve','decision.reject','decision.modify'].includes(c.type)){
  manage();const d=findDecision();required(d.status==='pending','Decision is no longer pending');
  if(c.type==='decision.approve'){required(actor.role==='owner'||d.exposure<=s.company.approvalLimit,'This exposure requires owner approval');d.status='approved';d.approvedBy=actor.name;d.approvedAt=timestamp;d.approvedRevision=d.revision;}
  if(c.type==='decision.reject'){required(text(c.reason),'A rejection reason is required');d.status='rejected';d.reason=text(c.reason);}
  if(c.type==='decision.modify'){required(text(c.action),'Action is required');d.action=text(c.action);d.owner=text(c.owner)||d.owner;d.revision++;}
  audit(c.type,d.id,c.reason||d.action);
 }else if(c.type==='decision.reopen'){
  manage();const d=findDecision();required(['rejected','verified','superseded'].includes(d.status),'Only closed decisions can be reopened');const current=detect(s,date).find(x=>x.id===d.id);required(current,'The signal is no longer present');Object.assign(d,current,{status:'pending',revision:d.revision+1});audit('Decision reopened',d.id,'Fresh approval required');
 }else if(c.type==='decision.execute'){
  const d=findDecision();required(d.status==='approved','Approve this decision first');required(d.approvedRevision===d.revision,'Decision changed after approval');const current=detect(s,date).find(x=>x.id===d.id);required(current&&current.sourceUpdatedAt===d.sourceUpdatedAt,'Source changed after approval. Run a cycle and obtain fresh approval.');
  const existing=s.tasks.find(x=>x.decisionId===d.id&&x.revision===d.revision);if(existing){result={id:existing.id};}else{const task={id:uuid(),decisionId:d.id,revision:d.revision,name:d.action,owner:d.owner,due:d.due,status:'todo',priority:d.severity,notes:'',createdAt:timestamp};s.tasks.push(task);result={id:task.id};}
  d.status='executing';audit('Work assigned',d.id,'Internal task created. No external message or payment sent.');
 }else if(c.type==='task.save'){
  let t=s.tasks.find(x=>x.id===c.task.id);if(c.task.id)required(t,'Task not found');
  const data={name:text(c.task.name),owner:text(c.task.owner)||'Unassigned',due:text(c.task.due,10),status:c.task.status,priority:c.task.priority||'medium',notes:text(c.task.notes)};
  required(data.name&&/^\d{4}-\d{2}-\d{2}$/.test(data.due)&&Number.isFinite(Date.parse(data.due)),'Task name and valid due date required');required(['todo','in_progress','blocked','completed'].includes(data.status),'Invalid task status');required(['low','medium','high','critical'].includes(data.priority),'Invalid task priority');
  if(t)Object.assign(t,data);else {t={...data,id:uuid(),createdAt:timestamp};s.tasks.push(t);}
  if(t.decisionId&&t.status==='completed'){const d=s.decisions.find(x=>x.id===t.decisionId);if(d?.status==='executing')d.status='awaiting_verification';}
  audit('Task updated',t.id,t.status+': '+t.name);result={id:t.id};
 }else if(c.type==='decision.verify'){
  manage();const d=findDecision();required(d.status==='awaiting_verification','Complete the assigned task before verification');required(text(c.evidence).length>=10,'Add outcome evidence (at least 10 characters)');
  const category=c.category||'operational';required(['operational','cash_received','cost_saved','revenue_won'].includes(category),'Invalid outcome category');const amount=num(c.amount||0);required(category!=='operational'||amount===0,'Operational outcomes do not carry a financial amount');
  required(!s.outcomes.some(x=>x.decisionId===d.id&&x.revision===d.revision),'Outcome already recorded');
  s.outcomes.push({id:uuid(),decisionId:d.id,revision:d.revision,at:timestamp,category,amount,evidence:text(c.evidence),actor:actor.name,verification:'user_attested'});d.status='verified';d.verifiedAt=timestamp;audit('Outcome verified',d.id,category+': '+amount+' — '+text(c.evidence));
 }else if(c.type==='settings'){
  required(actor.role==='owner','Only the owner can change policy');required(text(c.company.name),'Company name required');required(/^[A-Z]{3}$/.test(c.company.currency),'Use a three-letter currency code');
  s.company={name:text(c.company.name,120),currency:c.company.currency,cash:num(c.company.cash),monthlyBurn:num(c.company.monthlyBurn),approvalLimit:num(c.company.approvalLimit),cycleMinutes:num(c.company.cycleMinutes,5,1440),automation:c.company.automation===true};audit('Company policy updated','company','Cash, approval authority, and operating cycle settings updated');
 }else throw Error('Unknown command');
 s.version++;return {state:s,result};
}
export function forecast(s,{collection=60,winRate=20,spendChange=0}={}){
 collection=num(collection,0,100);winRate=num(winRate,0,100);spendChange=num(spendChange,-50,100);const m=metrics(s),burn=s.company.monthlyBurn*(1+spendChange/100),cashIn=m.outstanding*collection/100,bookings=m.pipeline*winRate/100;
 return {opening:s.company.cash,cashIn,burn,closing:s.company.cash+cashIn-burn,bookings,assumptions:'30-day sensitivity model. Collections apply to open invoices; sales bookings are not treated as collected cash.'};
}
export function parseCSV(input){
 required(input.length<=2000000,'CSV exceeds 2 MB');const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<input.length;i++){const ch=input[i];if(ch==='"'){if(quoted&&input[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell);cell='';}else if(ch==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=ch;}
 required(!quoted,'Unclosed CSV quote');row.push(cell.replace(/\r$/,''));if(row.some(x=>x.trim()))rows.push(row);required(rows.length>1,'CSV needs a header and data rows');const headers=rows.shift().map(x=>x.trim().replace(/^\uFEFF/,''));required(new Set(headers).size===headers.length,'Duplicate CSV headers');
 return rows.map((values,i)=>{required(values.length===headers.length,'Column count mismatch on row '+(i+2));return Object.fromEntries(headers.map((k,j)=>[k,values[j]]));});
}
export function csv(rows,columns){const quote=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';return [columns.map(quote).join(','),...rows.map(r=>columns.map(k=>quote(r[k])).join(','))].join('\r\n');}
