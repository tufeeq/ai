'use strict';
(function(){
 const URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/sharia.json';
 let screen={rows:{},updatedAt:null,counts:{verified:0,unverified:0,excluded:0}};
 const VERIFIED=new Set(['VERIFIED']);
 const baseEligible=window.eligible;
 const baseSharia=window.sharia;
 function record(x){return screen.rows?.[String(x?.Ticker||'').toUpperCase()]||null}
 function status(x){return String(record(x)?.status||baseSharia?.(x)||'UNVERIFIED').toUpperCase()}
 function isVerified(x){return VERIFIED.has(status(x))}
 function shariaAgeMin(){const t=screen.updatedAt;const n=t?(Date.now()-new Date(t).getTime())/60000:1e9;return Number.isFinite(n)?n:1e9}
 window.sharia=function(x){return status(x)};
 window.eligible=function(x){return !!baseEligible?.(x)&&isVerified(x)};
 function decorate(){
   const st=document.querySelector('#status');
   if(st){let c=st.querySelector('[data-sharia26]');if(!c){c=document.createElement('span');c.dataset.sharia26='1';st.appendChild(c)}const a=shariaAgeMin(),ok=a<=720;const n=screen.counts||{};c.className='chip '+(ok?'ok':'bad');c.textContent='Sharia VERIFIED '+(n.verified||0)+' · UNVERIFIED '+(n.unverified||0)+' · EXCLUDED '+(n.excluded||0)+(ok?'':' · STALE')}
   document.querySelectorAll('#radarRows tr[data-ticker],#topOpps [data-ticker]').forEach(el=>{
     const x=window.rowMap?.get?.(el.dataset.ticker); if(!x)return; const s=status(x);
     if(s!=='VERIFIED')el.remove();
   });
   const host=document.querySelector('#topOpps');
   if(host&&!host.querySelector('[data-ticker]')){
     const research=(window.rows||[]).filter(x=>baseEligible?.(x)&&status(x)==='UNVERIFIED').map(x=>({x,s:window.trace?.(x)?.score||0})).sort((a,b)=>b.s-a.s).slice(0,6);
     host.innerHTML='<div class="empty"><b>لا توجد فرصة تنفيذية شرعية متحققة حاليًا.</b><br>تم حجب UNVERIFIED وEXCLUDED عن قائمة الفرص وصفقات LAB.</div>'+
       (research.length?research.map(z=>'<article class="opp" style="opacity:.62" data-sharia-watch="1"><div class="rank">RESEARCH WATCH · غير متحقق شرعيًا</div><div class="ticker">'+z.x.Ticker+'</div><div class="score">TAGX '+z.s+'/100</div><div class="meta">لا يتحول إلى صفقة حتى يصبح Sharia = VERIFIED</div></article>').join(''):'');
   }
   const rule=document.querySelector('#tradesView .trade-head .panel .sub');
   if(rule&&!rule.dataset.sharia26){rule.dataset.sharia26='1';rule.textContent+=' · بوابة إلزامية: Sharia VERIFIED فقط؛ UNVERIFIED/EXCLUDED لا تنشئ صفقة.'}
 }
 const baseRender=window.render;
 if(typeof baseRender==='function')window.render=function(){baseRender();decorate()};
 async function sync(){try{const r=await fetch(URL+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('sharia '+r.status);const j=await r.json();screen=j||screen;decorate();if(typeof window.render==='function')window.render()}catch(e){console.warn('TAGX Sharia Gate V26 fail-closed',e);screen={rows:{},updatedAt:null,counts:{verified:0,unverified:0,excluded:0}};decorate()}}
 window.TAGXShariaGateV26={sync,status,isVerified};
 sync();setInterval(sync,10*60*1000);
})();