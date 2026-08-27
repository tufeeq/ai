'use strict';
(function(){
 const URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/sharia.json';
 let screen={rows:{},updatedAt:null,counts:{verified:0,unverified:0,excluded:0}};
 const baseEligible=window.eligible;
 const baseSharia=window.sharia;
 const baseProcessTrades=window.processTrades;
 function record(x){return screen.rows?.[String(x?.Ticker||'').toUpperCase()]||null}
 function status(x){return String(record(x)?.status||baseSharia?.(x)||'UNVERIFIED').toUpperCase()}
 function isVerified(x){return status(x)==='VERIFIED'}
 function isExcluded(x){return status(x)==='EXCLUDED'}
 function shariaAgeMin(){const t=screen.updatedAt;const n=t?(Date.now()-new Date(t).getTime())/60000:1e9;return Number.isFinite(n)?n:1e9}
 window.sharia=function(x){return status(x)};
 // Market eligibility must stay market-driven. Sharia controls execution, not visibility.
 if(typeof baseEligible==='function')window.eligible=baseEligible;
 if(typeof baseProcessTrades==='function'){
   window.processTrades=function(){
     const marketEligible=window.eligible;
     try{
       window.eligible=function(x){return !!marketEligible?.(x)&&isVerified(x)};
       return baseProcessTrades();
     }finally{window.eligible=marketEligible}
   };
 }
 function badge(el,s){
   let b=el.querySelector('[data-sharia27-badge]');
   if(!b){b=document.createElement('div');b.dataset.sharia27Badge='1';b.style.cssText='margin-top:7px;font-size:11px;font-weight:900;padding:5px 8px;border-radius:999px;display:inline-block';el.appendChild(b)}
   if(s==='VERIFIED'){b.textContent='Sharia VERIFIED · قابل للتنفيذ';b.style.background='#ecfdf5';b.style.color='#047857'}
   else if(s==='EXCLUDED'){b.textContent='Sharia EXCLUDED';b.style.background='#fef2f2';b.style.color='#b91c1c'}
   else {b.textContent='Sharia UNVERIFIED · رصد سوقي فقط';b.style.background='#fff7ed';b.style.color='#b45309'}
 }
 function decorate(){
   const st=document.querySelector('#status');
   if(st){let c=st.querySelector('[data-sharia27]');if(!c){c=document.createElement('span');c.dataset.sharia27='1';st.appendChild(c)}const a=shariaAgeMin(),ok=a<=720;const n=screen.counts||{};c.className='chip '+(ok?'warn':'bad');c.textContent='Sharia '+(n.verified||0)+' VERIFIED · '+(n.unverified||0)+' UNVERIFIED · '+(n.excluded||0)+' EXCLUDED'+(ok?'':' · STALE')}
   document.querySelectorAll('#topOpps [data-ticker],#radarRows tr[data-ticker]').forEach(el=>{
     const x=window.rowMap?.get?.(el.dataset.ticker); if(!x)return; const s=status(x);
     if(s==='EXCLUDED'){el.remove();return}
     if(el.matches('#topOpps [data-ticker]'))badge(el,s);
     if(s==='UNVERIFIED')el.style.opacity='.88';
   });
   const host=document.querySelector('#topOpps');
   if(host){
     const empty=host.querySelector('.empty');
     if(empty&&host.querySelector('[data-ticker]'))empty.remove();
     if(!host.querySelector('[data-ticker]')){
       const research=(window.rows||[]).filter(x=>baseEligible?.(x)&&!isExcluded(x)).map(x=>({x,s:window.trace?.(x)?.score||0})).sort((a,b)=>b.s-a.s).slice(0,8);
       host.innerHTML=research.length?research.map(z=>'<article class="opp" data-ticker="'+z.x.Ticker+'"><div class="rank">MARKET OPPORTUNITY · '+status(z.x)+'</div><div class="ticker">'+z.x.Ticker+'</div><div class="score">TAGX '+z.s+'/100</div><div class="meta">'+(status(z.x)==='VERIFIED'?'قابل للتنفيذ في LAB':'رصد سوقي فقط حتى اكتمال التحقق الشرعي')+'</div></article>').join(''):'<div class="empty"><b>لا توجد فرصة سوقية مؤهلة حاليًا.</b></div>';
     }
   }
   const rule=document.querySelector('#tradesView .trade-head .panel .sub');
   if(rule&&!rule.dataset.sharia27){rule.dataset.sharia27='1';rule.textContent+=' · الفرص السوقية قد تظهر كـUNVERIFIED، لكن LAB لا ينفذ إلا VERIFIED.'}
 }
 const baseRender=window.render;
 if(typeof baseRender==='function')window.render=function(){baseRender();decorate()};
 async function sync(){try{const r=await fetch(URL+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('sharia '+r.status);const j=await r.json();screen=j||screen;decorate();if(typeof window.render==='function')window.render()}catch(e){console.warn('TAGX Sharia Gate V27 fail-closed execution',e);screen={rows:{},updatedAt:null,counts:{verified:0,unverified:0,excluded:0}};decorate()}}
 window.TAGXShariaGateV27={sync,status,isVerified,isExcluded};
 sync();setInterval(sync,10*60*1000);
})();