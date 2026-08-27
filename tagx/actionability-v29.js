'use strict';
(function(){
 const URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/live-quotes.json';
 const STORE='tagx-v29-persistence';
 const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
 const n=v=>Number.isFinite(Number(v))?Number(v):null;
 const ageMin=t=>{const x=t?(Date.now()-new Date(t).getTime())/60000:1e9;return Number.isFinite(x)?x:1e9};
 function load(){try{return JSON.parse(localStorage.getItem(STORE)||'{}')}catch{return {}}}
 function save(x){try{localStorage.setItem(STORE,JSON.stringify(x))}catch{}}
 function sharia(t){try{const x=window.rowMap?.get?.(t);return window.TAGXShariaGateV27?.status?.(x)||'UNVERIFIED'}catch{return 'UNVERIFIED'}}
 function classify(e,session,prev){
   const ch=n(e.changePct),ers=n(e.earlyRegimeShiftScore)||0,ign=n(e.ignitionScore)||0;
   const v5=n(e.priceVelocity5mPct)||0,v15=n(e.priceVelocity15mPct)||0;
   const va=n(e.volumeAcceleration5m),to=n(e.turnover5mPctFloat);
   const structural=(v15>0.35)||((va||0)>=2)||((to||0)>=1);
   const lateCap=session==='after-hours'?20:22;
   if(ch==null||ch<-4||ch>=lateCap)return {critic:'REJECT',score:0,risk:96,why:'Late/invalid displacement',persistence:0};
   const vel5=clamp(v5/3*100),vel15=clamp(v15/5*100),part=clamp(Math.max(va!=null?va*18:0,to!=null?to*22:0));
   let score=.30*ers+.24*ign+.18*vel5+.10*vel15+.18*part;
   if(ch>=15)score-=20;else if(ch>=10)score-=8;
   if(v5<=0)score-=20;
   const priorScore=n(prev?.score),priorErs=n(prev?.ers),priorTs=prev?.ts?new Date(prev.ts).getTime():null;
   const elapsed=priorTs?Math.max(0,(Date.now()-priorTs)/60000):null;
   const scoreSlope=priorScore!=null&&elapsed&&elapsed>0?(score-priorScore)/elapsed:null;
   const ersSlope=priorErs!=null&&elapsed&&elapsed>0?(ers-priorErs)/elapsed:null;
   const seen=(prev?.seen||0)+1;
   let persistence=0;
   if(seen>=2)persistence+=25;
   if(scoreSlope!=null&&scoreSlope>=-1)persistence+=20;
   if(ersSlope!=null&&ersSlope>=-1)persistence+=15;
   if(v15>0)persistence+=20;
   if(structural)persistence+=20;
   persistence=clamp(persistence);
   if(session==='after-hours'){
     score-=6; // thinner liquidity / wider spreads
     if((to||0)<0.05&&(va||0)<2.5)score-=8;
     if(v15<0)score-=10;
   }
   const minScore=session==='after-hours'?76:72;
   const persistenceGate=session==='after-hours'?45:35;
   const pass=ers>=75&&ign>=75&&v5>=0.5&&structural&&ch<18&&score>=minScore&&persistence>=persistenceGate;
   const watch=!pass&&ers>=70&&ign>=70&&v5>0&&score>=64&&ch<20;
   const risk=clamp(30+(session==='after-hours'?15:0)+(ch>=15?28:ch>=10?15:0)+(v15<0?15:0)+(!structural?18:0)+(persistence<40?12:0)-Math.min(12,(to||0)*3));
   const slopeTxt=scoreSlope==null?'1st obs':`P-slope ${scoreSlope>=0?'+':''}${scoreSlope.toFixed(1)}/m`;
   const why=[`ERS ${Math.round(ers)}`,`Ign ${Math.round(ign)}`,`5m ${v5.toFixed(1)}%`,`15m ${v15.toFixed(1)}%`,va!=null?`VolAcc ${va.toFixed(1)}x`:null,to!=null?`Float5m ${to.toFixed(1)}%`:null,`Persist ${Math.round(persistence)}`,slopeTxt].filter(Boolean).join(' · ');
   return {critic:pass?'PASS':watch?'WATCH':'REJECT',score:Math.round(clamp(score)),risk:Math.round(risk),why,persistence,seen};
 }
 function updateState(cands,session){
   const state=load(),now=new Date().toISOString(),out=[];
   for(const e of cands){const t=String(e.ticker||'').toUpperCase();if(!t)continue;const prev=state[t];const c=classify(e,session,prev);state[t]={score:c.score,ers:n(e.earlyRegimeShiftScore)||0,ts:now,seen:c.seen,session};out.push({e,...c})}
   for(const [t,v] of Object.entries(state)){if(v.ts&&Date.now()-new Date(v.ts).getTime()>6*3600000)delete state[t]}
   save(state);return out;
 }
 function render(live){
   const a=ageMin(live.updatedAtUTC||live.updatedAtET),session=String(live.marketClockSession||'unknown');
   let sec=document.querySelector('[data-actionability29]')||document.querySelector('[data-actionability28]');
   if(!sec){sec=document.createElement('section');const radar=document.querySelector('#radarView');const first=radar?.querySelector('.hero');if(first)radar.insertBefore(sec,first);else radar?.prepend(sec)}
   sec.dataset.actionability29='1';sec.removeAttribute('data-actionability28');sec.className='hero';
   if(a>12){sec.innerHTML='<h2>TAGX Live Actionability V29</h2><div class="empty"><b>تعذر إصدار فرص حية:</b> أحدث feed أقدم من 12 دقيقة. النظام Fail-Closed ولا يستخدم stale data.</div>';return}
   if(!['regular','after-hours','pre-market','premarket'].includes(session)){sec.innerHTML='<h2>TAGX Live Actionability V29</h2><div class="empty">خارج نافذة التداول المدعومة حاليًا.</div>';return}
   const raw=Array.isArray(live.emergingCandidates)?live.emergingCandidates:[];
   const rows=updateState(raw,session).filter(x=>x.critic!=='REJECT').sort((a,b)=>b.score-a.score||b.persistence-a.persistence||a.risk-b.risk).slice(0,8);
   const pass=rows.filter(x=>x.critic==='PASS').length,ah=session==='after-hours';
   sec.innerHTML='<h2>فرص TAGX '+(ah?'بعد الإغلاق':'الحية المبكرة')+' <span style="font-size:12px;color:#64748b">V29 · PERSISTENCE CRITIC</span></h2><p>'+(ah?'After-hours له مخاطر سيولة أعلى؛ PASS يتطلب استمرار الإشارة عبر الملاحظات وليس spike واحدًا.':'PASS يتطلب استمرار regime وليس لقطة واحدة. Late/Exhaustion مستبعد تلقائيًا.')+'</p>'+
     '<div class="status" style="margin-top:12px"><span class="chip ok">Live '+Math.round(a)+'د</span><span class="chip">'+session+'</span><span class="chip">'+(live.freshCount||0)+' fresh</span><span class="chip">'+pass+' PASS</span><span class="chip warn">'+(rows.length-pass)+' WATCH</span></div>'+
     '<div class="opps">'+(rows.length?rows.map(({e,critic,score,risk,why,persistence})=>{const t=String(e.ticker||'').toUpperCase(),s=sharia(t),exec=s==='VERIFIED'&&critic==='PASS';return '<article class="opp '+(critic==='PASS'?'best':'')+'" data-ticker="'+t+'"><div class="rank">'+critic+' · '+(ah?'AH EARLY':'LIVE EARLY')+'</div><div class="ticker">'+t+'</div><div class="move">'+((n(e.changePct)||0)>=0?'+':'')+(n(e.changePct)||0).toFixed(1)+'%</div><div class="score">A '+score+'/100</div><div class="meta">Persistence '+Math.round(persistence)+'/100 · Risk '+risk+'/100 · '+s+(exec?' · LAB eligible':' · market watch only')+'</div><div class="why">'+why+'</div></article>'}).join(''):'<div class="empty">لا توجد PASS/WATCH مستمرة حاليًا؛ لم يتم ملء القائمة بأسهم متأخرة أو spike مفرد.</div>')+'</div>';
 }
 async function sync(){try{const r=await fetch(URL+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('live '+r.status);render(await r.json())}catch(e){console.warn('TAGX actionability v29',e)}}
 window.TAGXActionabilityV29={sync,classify};sync();setInterval(sync,30000);
})();