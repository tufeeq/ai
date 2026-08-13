(function(){
const stageAr={DISCOVERY:'اكتشاف مبكر',IGNITION:'اشتعال',LATE:'متأخر',EXHAUSTION:'إنهاك'};
const shariaAr={VERIFIED:'شرعي مؤكد',UNVERIFIED:'غير متحقق',EXCLUDED:'مستبعد'};
window.renderVisuals=function(a){
 const market=a.filter(x=>x.sharia!=='EXCLUDED').sort((a,b)=>b.score-a.score),top=market.slice(0,5),avg=k=>top.length?top.reduce((s,x)=>s+(+x[k]||0),0)/top.length:0;
 const gauge=(label,v,c='var(--green)')=>`<div class="gauge"><div class="gauge-ring" style="--v:${v.toFixed(0)};--c:${c}"><strong>${v.toFixed(0)}</strong></div><small>${label}</small></div>`;
 const r=document.querySelector('#radar');if(r)r.innerHTML=gauge('مبكر',avg('early'),'var(--blue)')+gauge('اشتعال',avg('ignition'),'var(--green)')+gauge('استمرار',avg('continuation'),'var(--cyan)')+gauge('إنهاك',avg('exhaustion'),'var(--red)');
 const counts=['DISCOVERY','IGNITION','LATE','EXHAUSTION'].map(k=>[k,a.filter(x=>x.stage===k).length]),mx=Math.max(1,...counts.map(x=>x[1])),sc=document.querySelector('#stageChart');if(sc)sc.innerHTML=counts.map(([k,v])=>`<div class="stage-row"><span>${stageAr[k]}</span><div class="stage-track"><div class="stage-fill f-${k.toLowerCase()}" style="width:${v/mx*100}%"></div></div><b>${v}</b></div>`).join('');
 const verified=market.filter(x=>x.sharia==='VERIFIED'),t=verified[0],research=market.find(x=>x.sharia==='UNVERIFIED'),box=document.querySelector('#topOpportunity');
 if(box)box.innerHTML=t?`<div class="result-top"><div class="top-ticker">${t.ticker}</div><div class="top-score">${t.score.toFixed(0)}</div></div><div class="top-meta"><span class="pill p-${t.stage.toLowerCase()}">${stageAr[t.stage]}</span><span class="pill p-verified">شرعي مؤكد</span><span class="${t.changePct>=0?'pos':'neg'}">${t.changePct>=0?'+':''}${t.changePct.toFixed(1)}%</span></div><div class="top-reasons">${(t.reasons||[]).slice(0,3).join(' · ')||'—'}<br>RVOL ${t.rvol.toFixed(1)}× · مخاطر ${Number(t.risk||0).toFixed(0)}/100</div>`:`<div class="top-reasons"><strong>لا توجد فرصة متحققة شرعيًا الآن.</strong>${research?`<br>أعلى مرشح بحثي: ${research.ticker} · TAG ${research.score.toFixed(0)} · غير متحقق شرعيًا`:''}</div>`;
};
setTimeout(()=>{try{if(typeof render==='function')render()}catch(e){}},50);
})();