'use strict';
(function(){
 const REL='TAGX 1.4';
 function n(v){const x=parseFloat(String(v??'').replace(/[%,$,\s]/g,''));return Number.isFinite(x)?x:null}
 function ah(x){const e=enrichment?.rows?.[x.Ticker]||{},p=e.price||{},base=n(x.Price),last=n(p.last),prev=n(p.previousClose),ts=p.timestampUTC; if(last==null||base==null||!ts)return null; const d=new Date(ts), age=(Date.now()-d.getTime())/60000; if(age>45)return null; const etHour=+new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hour12:false}).format(d); if(etHour<16)return null; const vsClose=base?100*(last/base-1):null; const vsPrev=prev?100*(last/prev-1):n(p.changePct); return{last,vsClose,vsPrev,ts,age}; }
 function collapsed(x){const a=ah(x);return !!(a&&a.vsClose<=-12)}
 try{
  const oldEligible=eligible; eligible=function(x){return oldEligible(x)&&!collapsed(x)};
  const oldTrace=trace; trace=function(x){const t=oldTrace(x),a=ah(x);if(!a)return t;if(a.vsClose<=-30){t.score=Math.max(0,t.score-60);t.down.push('انهيار بعد الإغلاق ≤-30% -60')}else if(a.vsClose<=-20){t.score=Math.max(0,t.score-45);t.down.push('هبوط بعد الإغلاق ≤-20% -45')}else if(a.vsClose<=-12){t.score=Math.max(0,t.score-30);t.down.push('هبوط بعد الإغلاق ≤-12% -30')}return t};
  const oldStage=stage; stage=function(x){const a=ah(x);if(a&&a.vsClose<=-12)return'EXHAUSTION';return oldStage(x)};
  const oldRender=render; render=function(){oldRender();document.querySelectorAll('[data-ticker]').forEach(el=>{const x=rowMap.get(el.dataset.ticker),a=x&&ah(x);if(!a)return; if(el.classList.contains('opp')){let q=el.querySelector('.ah14');if(!q){q=document.createElement('div');q.className='ah14 riskline';q.style.marginTop='8px';el.appendChild(q)}q.innerHTML=`بعد الإغلاق: <b>$${a.last.toFixed(2)}</b> · من إغلاق RTH <b>${a.vsClose>=0?'+':''}${a.vsClose.toFixed(1)}%</b>`}})};
  const oldOpen=openStock; openStock=function(t){oldOpen(t);const x=rowMap.get(t),a=x&&ah(x);if(!a)return;const b=document.querySelector('#drawerBody');if(!b)return;const sec=document.createElement('div');sec.className='section';sec.innerHTML=`<h4>أداء الساعات الممتدة</h4><div class="riskline"><b>السعر بعد الإغلاق:</b> $${a.last.toFixed(2)} · <b>مقابل إغلاق الجلسة:</b> ${a.vsClose>=0?'+':''}${a.vsClose.toFixed(2)}%<br><b>مقابل الإغلاق السابق:</b> ${a.vsPrev==null?'—':(a.vsPrev>=0?'+':'')+a.vsPrev.toFixed(2)+'%'}<br><b>الحالة:</b> ${a.vsClose<=-12?'🔴 Exhaustion / removed from opportunities':'🟢 لا يوجد انهيار AH'}<br><span class="sub">هبوط AH بمقدار 12% أو أكثر يلغي أهلية الفرصة فورًا؛ 20% و30% يضيفان عقوبات أقوى. timestamp: ${a.ts}</span></div>`;b.insertBefore(sec,b.children[1]||null)};
  window.TAGXExtendedV14={release:REL,ah,collapsed};
 }catch(e){console.error('extended v14',e)}
})();