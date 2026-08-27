'use strict';
(function(){
 const URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/live-quotes.json';
 const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
 const n=v=>Number.isFinite(Number(v))?Number(v):null;
 const ageMin=t=>{const x=t?(Date.now()-new Date(t).getTime())/60000:1e9;return Number.isFinite(x)?x:1e9};
 function classify(e){
   const ch=n(e.changePct), ers=n(e.earlyRegimeShiftScore)||0, ign=n(e.ignitionScore)||0;
   const v5=n(e.priceVelocity5mPct)||0, v15=n(e.priceVelocity15mPct)||0;
   const va=n(e.volumeAcceleration5m), to=n(e.turnover5mPctFloat);
   if(ch==null||ch<-4||ch>=22)return {critic:'REJECT',score:0,risk:95,why:'Late/invalid displacement'};
   const vel5=clamp(v5/3*100), vel15=clamp(v15/5*100);
   const part=clamp(Math.max(va!=null?va*18:0,to!=null?to*22:0));
   let score=.32*ers+.25*ign+.18*vel5+.10*vel15+.15*part;
   if(ch>=15)score-=18; else if(ch>=10)score-=8;
   if(v5<=0)score-=18;
   const structural=(v15>0.35)||((va||0)>=2)||((to||0)>=1);
   const pass=ers>=75&&ign>=75&&v5>=0.5&&structural&&ch<18&&score>=72;
   const watch=!pass&&ers>=70&&ign>=70&&v5>0&&score>=64&&ch<20;
   const risk=clamp(30+(ch>=15?28:ch>=10?15:0)+(v15<0?15:0)+(!structural?18:0)-Math.min(12,(to||0)*3));
   const why=[`ERS ${Math.round(ers)}`,`Ign ${Math.round(ign)}`,`5m ${v5.toFixed(1)}%`,v15?`15m ${v15.toFixed(1)}%`:null,va!=null?`VolAcc ${va.toFixed(1)}x`:null,to!=null?`Float5m ${to.toFixed(1)}%`:null].filter(Boolean).join(' · ');
   return {critic:pass?'PASS':watch?'WATCH':'REJECT',score:Math.round(clamp(score)),risk:Math.round(risk),why};
 }
 function sharia(t){
   try{const x=window.rowMap?.get?.(t);return window.TAGXShariaGateV27?.status?.(x)||'UNVERIFIED'}catch{return 'UNVERIFIED'}
 }
 function render(live){
   const a=ageMin(live.updatedAtUTC||live.updatedAtET);
   let sec=document.querySelector('[data-actionability28]');
   if(!sec){sec=document.createElement('section');sec.dataset.actionability28='1';sec.className='hero';const radar=document.querySelector('#radarView');const first=radar?.querySelector('.hero');if(first)radar.insertBefore(sec,first);else radar?.prepend(sec)}
   if(a>12||live.marketClockSession!=='regular'){
     sec.innerHTML='<h2>TAGX Live Early Challenger</h2><div class="empty"><b>تعذر إصدار فرص حية:</b> أحدث live feed أقدم من 12 دقيقة. لا نستخدم بيانات stale كفرص.</div>';return;
   }
   const rows=(Array.isArray(live.emergingCandidates)?live.emergingCandidates:[]).map(e=>({e,...classify(e)})).filter(x=>x.critic!=='REJECT').sort((a,b)=>b.score-a.score||a.risk-b.risk).slice(0,6);
   const pass=rows.filter(x=>x.critic==='PASS').length;
   sec.innerHTML='<h2>فرص TAGX الحية المبكرة <span style="font-size:12px;color:#64748b">CHALLENGER</span></h2><p>من أحدث 1m-bars فقط؛ PASS أولوية، WATCH للمراقبة. Late/Exhaustion مستبعد تلقائيًا. الشرعية منفصلة عن الاكتشاف.</p>'+
     '<div class="status" style="margin-top:12px"><span class="chip ok">Live '+Math.round(a)+'د</span><span class="chip">'+(live.freshCount||0)+' fresh</span><span class="chip">'+pass+' PASS</span><span class="chip warn">'+(rows.length-pass)+' WATCH</span></div>'+
     '<div class="opps">'+(rows.length?rows.map(({e,critic,score,risk,why})=>{const t=String(e.ticker||'').toUpperCase(),s=sharia(t),exec=s==='VERIFIED';return '<article class="opp '+(critic==='PASS'?'best':'')+'" data-ticker="'+t+'"><div class="rank">'+critic+' · LIVE EARLY</div><div class="ticker">'+t+'</div><div class="move">'+((n(e.changePct)||0)>=0?'+':'')+(n(e.changePct)||0).toFixed(1)+'%</div><div class="score">A '+score+'/100</div><div class="meta">Risk '+risk+'/100 · '+s+(exec?' · LAB eligible':' · market watch only')+'</div><div class="why">'+why+'</div></article>'}).join(''):'<div class="empty">لا توجد إشارة PASS/WATCH مبكرة في اللقطة الحالية؛ لم يتم ملء القائمة بأسهم Late لمجرد وجود حركة.</div>')+'</div>';
 }
 async function sync(){try{const r=await fetch(URL+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('live '+r.status);render(await r.json())}catch(e){console.warn('TAGX actionability v28',e)}}
 window.TAGXActionabilityV28={sync,classify};sync();setInterval(sync,30000);
})();