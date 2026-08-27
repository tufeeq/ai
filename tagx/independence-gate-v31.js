'use strict';
(function(){
 const URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/live-quotes.json';
 const PERSIST='tagx-v29-persistence';
 let approved=new Set(), latest=null;
 const n=v=>Number.isFinite(Number(v))?Number(v):null;
 const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
 const ageMin=t=>{const x=t?(Date.now()-new Date(t).getTime())/60000:1e9;return Number.isFinite(x)?x:1e9};
 function sharia(t){try{const x=window.rowMap?.get?.(t);return window.TAGXShariaGateV27?.status?.(x)||'UNVERIFIED'}catch{return 'UNVERIFIED'}}
 function persistence(){try{return JSON.parse(localStorage.getItem(PERSIST)||'{}')}catch{return {}}}
 function assess(e,live,pstate){
   const t=String(e.ticker||'').toUpperCase(), ch=n(e.changePct), v5=n(e.priceVelocity5mPct)||0, v15=n(e.priceVelocity15mPct)||0;
   const va=n(e.volumeAcceleration5m), to=n(e.turnover5mPctFloat), ers=n(e.earlyRegimeShiftScore)||0, ign=n(e.ignitionScore)||0;
   const ps=pstate[t]||{}, seen=n(ps.seen)||0, pscore=n(ps.score)||0;
   const families=[];
   const regime=clamp((ers+ign)/2);
   if(ers>=75&&ign>=75)families.push({name:'regime',score:regime});
   const momentum=clamp(Math.max(0,v5)*18+Math.max(0,v15)*8);
   if(v5>=0.5&&v15>0)families.push({name:'momentum',score:momentum});
   const structure=clamp(Math.max(va!=null?va*20:0,to!=null?to*28:0));
   if((va||0)>=2||(to||0)>=0.15)families.push({name:'structure',score:structure});
   const persistScore=clamp((seen>=2?45:0)+Math.max(0,Math.min(40,pscore-50))+(v15>0?15:0));
   if(seen>=2&&pscore>=68)families.push({name:'persistence',score:persistScore});
   const displacement=ch!=null&&ch>=1&&ch<14?clamp(90-Math.max(0,ch-8)*8):0;
   if(displacement>0)families.push({name:'early-dislocation',score:displacement});
   const dataAge=ageMin(live.updatedAtUTC||live.updatedAtET), dataOk=dataAge<=8&&String(live.dataConfidence||'').toUpperCase()==='HIGH';
   const total=families.reduce((s,x)=>s+x.score,0), max=families.reduce((m,x)=>Math.max(m,x.score),0);
   const concentration=total>0?max/total:1;
   const independent=families.length>=4&&families.some(x=>x.name==='structure')&&families.some(x=>x.name==='persistence')&&concentration<=0.45;
   const early=ch!=null&&ch>=1&&ch<14&&v5>0;
   const verified=sharia(t)==='VERIFIED';
   const pass=dataOk&&early&&independent&&verified;
   const reasons=[];
   if(!dataOk)reasons.push('data not fresh/high-confidence');
   if(!early)reasons.push('not early or velocity non-positive');
   if(!families.some(x=>x.name==='structure'))reasons.push('no independent structure/float-volume confirmation');
   if(!families.some(x=>x.name==='persistence'))reasons.push('persistence not proven');
   if(families.length<4)reasons.push('fewer than 4 evidence families');
   if(concentration>0.45)reasons.push('decision concentrated in one evidence family');
   if(!verified)reasons.push('Sharia not VERIFIED');
   return {ticker:t,pass,watch:dataOk&&early&&!pass,families,concentration,seen,pscore,sharia:sharia(t),reasons};
 }
 function decorate(live){
   latest=live;const pstate=persistence(), raw=Array.isArray(live.emergingCandidates)?live.emergingCandidates:[];
   const rows=raw.map(e=>({e,a:assess(e,live,pstate)})); approved=new Set(rows.filter(x=>x.a.pass).map(x=>x.a.ticker));
   let sec=document.querySelector('[data-independence31]');
   if(!sec){sec=document.createElement('section');sec.dataset.independence31='1';sec.className='hero';const radar=document.querySelector('#radarView');const anchor=radar?.querySelector('[data-actionability29]');if(anchor?.nextSibling)radar.insertBefore(sec,anchor.nextSibling);else radar?.prepend(sec)}
   const age=ageMin(live.updatedAtUTC||live.updatedAtET), passes=rows.filter(x=>x.a.pass).length;
   sec.innerHTML='<h2>TAGX V31 · Independent Decision Gate</h2><p>لا تتحول الإشارة إلى LAB/BUY من score واحد أو عائلة مترابطة. يلزم تأكيد مستقل من ≥4 عائلات، ومنها market-structure + persistence، مع بيانات HIGH حديثة وSharia VERIFIED.</p>'+
   '<div class="status"><span class="chip '+(age<=8?'ok':'bad')+'">Live '+Math.round(age)+'د</span><span class="chip">'+rows.length+' candidates</span><span class="chip '+(passes?'ok':'warn')+'">'+passes+' independently confirmed</span></div>'+
   '<div class="opps">'+(rows.length?rows.slice(0,8).map(({e,a})=>'<article class="opp '+(a.pass?'best':'')+'" data-ticker="'+a.ticker+'"><div class="rank">'+(a.pass?'INDEPENDENT PASS':'BLOCKED / WATCH')+'</div><div class="ticker">'+a.ticker+'</div><div class="move">'+((n(e.changePct)||0)>=0?'+':'')+(n(e.changePct)||0).toFixed(1)+'%</div><div class="meta">Families '+a.families.map(x=>x.name).join(', ')+' · concentration '+Math.round(a.concentration*100)+'% · seen '+a.seen+' · '+a.sharia+'</div><div class="why">'+(a.pass?'Cross-validated and eligible for LAB safety gate':a.reasons.join(' · '))+'</div></article>').join(''):'<div class="empty">لا توجد emerging candidates حاليًا.</div>')+'</div>';
 }
 const baseProcess=window.processTrades;
 if(typeof baseProcess==='function')window.processTrades=function(){
   const old=window.eligible, allow=approved;
   try{window.eligible=function(x){const t=String(x?.Ticker||'').toUpperCase();return !!old?.(x)&&allow.has(t)};return baseProcess()}
   finally{window.eligible=old}
 };
 async function sync(){try{const r=await fetch(URL+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('live '+r.status);decorate(await r.json());if(typeof window.processTrades==='function')window.processTrades()}catch(e){approved=new Set();console.warn('TAGX independence v31 fail-closed',e)}}
 window.TAGXIndependenceV31={sync,assess,isApproved:t=>approved.has(String(t||'').toUpperCase()),latest:()=>latest};
 sync();setInterval(sync,30000);
})();