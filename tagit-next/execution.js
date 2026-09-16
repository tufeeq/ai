const el=id=>document.getElementById(id);
const labels={TIMEOUT_LAST_FRESH_QUOTE:'انتهاء المدة · آخر سعر حديث',STOP:'بلوغ الوقف',UNKNOWN_TIMEOUT_QUOTE:'سعر الخروج غير محسوم',NO_ELIGIBLE_QUOTE_OBSERVED:'لم يُرصد دخول مؤهل',TIMEOUT_DELAYED_QUOTE:'خروج مرصود بعد الموعد'};
const cell=text=>{const n=document.createElement('td');n.textContent=text;return n;};
try{
 const response=await fetch('execution-latency.json',{cache:'no-store'});
 if(!response.ok)throw new Error('Missing report');
 const data=await response.json();
 if(data.approved_for_live!==false||data.evidence_status!=='DEVELOPMENT_ONLY'||data.frozen_cases!==6||data.scenarios.length!==4||data.scenarios.some(s=>s.results.length!==6))throw new Error('Invalid report');
 const select=el('latency-scenario');
 for(const [index,s] of data.scenarios.entries()){
  const o=document.createElement('option');o.value=String(index);o.textContent=`تأخر الدخول ${s.entry_latency_seconds} ث · مهلة الخروج ${s.exit_allowance_seconds} ث`;select.append(o);
 }
 const render=()=>{
  const s=data.scenarios[Number(select.value)];
  const positives=s.results.filter(r=>Number.isFinite(r.net_pct)&&r.net_pct>0).length;
  const negatives=s.results.filter(r=>Number.isFinite(r.net_pct)&&r.net_pct<0).length;
  const unknown=s.results.filter(r=>r.outcome==='UNKNOWN_TIMEOUT_QUOTE').length;
  const noEntry=s.results.filter(r=>r.outcome==='NO_ELIGIBLE_QUOTE_OBSERVED').length;
  el('latency-status').textContent=`${negatives} نتائج سالبة · ${positives} موجبة · ${unknown} مخارج غير محسومة · ${noEntry} دون دخول مؤهل`;
  el('latency-rows').replaceChildren(...s.results.map(r=>{
   const tr=document.createElement('tr');
   const value=Number.isFinite(r.net_pct)?(r.net_pct>0?'+':'')+r.net_pct.toFixed(4)+'%':'غير محسوم';
   const delay=r.late_exit?r.exit_delay_seconds.toFixed(3)+' ث':r.outcome==='STOP'?'قبل انتهاء المدة':r.exit_delay_seconds===0?'عند الموعد':'غير متاح';
   const symbol=cell(r.symbol),net=cell(value);symbol.dir='ltr';net.dir='ltr';tr.append(symbol,cell(labels[r.outcome]??r.outcome),net,cell(delay));return tr;
  }));
 };
 select.disabled=false;select.addEventListener('change',render);render();
}catch{
 el('latency-status').textContent='تعذر تحميل نتائج تجربة التأخير؛ سجل الاختبارات السابق متاح أدناه.';
 el('latency-status').setAttribute('role','alert');
}
