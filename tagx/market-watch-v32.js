'use strict';
(function(){
 const LIVE='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/live-quotes.json';
 const n=v=>Number.isFinite(Number(v))?Number(v):null;
 const ageMin=t=>{const x=t?(Date.now()-new Date(t).getTime())/60000:1e9;return Number.isFinite(x)?x:1e9};
 function sharia(t){try{const x=window.rowMap?.get?.(String(t||'').toUpperCase());return window.TAGXShariaGateV27?.status?.(x)||'UNVERIFIED'}catch{return 'UNVERIFIED'}}
 function classify(e,live){
   const t=String(e.ticker||'').toUpperCase(),ch=n(e.changePct),v5=n(e.priceVelocity5mPct),v15=n(e.priceVelocity15mPct),va=n(e.volumeAcceleration5m),to=n(e.turnover5mPctFloat);
   const dataFresh=ageMin(live.updatedAtUTC||live.updatedAtET)<=8&&String(live.dataConfidence||'').toUpperCase()==='HIGH';
   const early=ch!=null&&ch>=1&&ch<14&&(v5||0)>0;
   const structure=(va!=null&&va>=2)||(to!=null&&to>=0.15);
   const s=sharia(t);
   const blockers=[];
   if(!dataFresh)blockers.push('بيانات السوق غير حديثة/موثوقة');
   if(!early)blockers.push('ليست في نافذة Early');
   if(!structure)blockers.push('لا يوجد تأكيد مستقل للحجم/الفلوّت');
   if(s!=='VERIFIED')blockers.push('الشرعية '+s);
   return {ticker:t,change:ch,price:n(e.price),v5,v15,ers:n(e.earlyRegimeShiftScore),ign:n(e.ignitionScore),structure,sharia:s,dataFresh,blockers,executable:dataFresh&&early&&structure&&s==='VERIFIED'};
 }
 function render(live){
   const raw=Array.isArray(live.emergingCandidates)?live.emergingCandidates:[];
   const rows=raw.map(e=>({e,a:classify(e,live)})).sort((a,b)=>(b.a.ers||0)-(a.a.ers||0));
   let sec=document.querySelector('[data-marketwatch32]');
   if(!sec){sec=document.createElement('section');sec.dataset.marketwatch32='1';sec.className='hero';const radar=document.querySelector('#radarView');const first=radar?.querySelector('.hero');if(first?.nextSibling)radar.insertBefore(sec,first.nextSibling);else radar?.prepend(sec)}
   const age=Math.round(ageMin(live.updatedAtUTC||live.updatedAtET));
   const exec=rows.filter(x=>x.a.executable).length;
   sec.innerHTML='<h2>TAGX V32 · Live Early Watch</h2><p>يفصل الرصد المبكر عن قرار التنفيذ: تظهر التحركات الحالية حتى لو كانت محجوبة بالسيولة أو الشرعية، ولا تنتقل إلى LAB إلا بعد اكتمال الأدلة.</p>'+
   '<div class="status"><span class="chip '+(age<=8?'ok':'bad')+'">Feed '+age+'د</span><span class="chip">'+rows.length+' Early candidates</span><span class="chip '+(exec?'ok':'warn')+'">'+exec+' executable</span></div>'+
   '<div class="opps">'+(rows.length?rows.slice(0,8).map(({a})=>'<article class="opp '+(a.executable?'best':'')+'" data-ticker="'+a.ticker+'"><div class="rank">'+(a.executable?'EXECUTION-ELIGIBLE':'MARKET WATCH · NOT A BUY')+'</div><div class="ticker">'+a.ticker+'</div><div class="move">'+((a.change||0)>=0?'+':'')+(a.change||0).toFixed(1)+'%</div><div class="meta">ERS '+(a.ers??'—')+' · Ign '+(a.ign??'—')+' · V5 '+(a.v5==null?'—':a.v5.toFixed(1)+'%')+' · '+a.sharia+'</div><div class="why">'+(a.executable?'الأدلة الأساسية مكتملة؛ يخضع لبقية بوابات TAGX.':a.blockers.join(' · '))+'</div></article>').join(''):'<div class="empty">لا توجد emerging candidates في أحدث لقطة.</div>')+'</div>';
 }
 async function sync(){try{const r=await fetch(LIVE+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('live '+r.status);render(await r.json())}catch(e){console.warn('TAGX V32 watchboard fail-closed',e)}}
 window.TAGXMarketWatchV32={sync,classify};sync();setInterval(sync,30000);
})();
