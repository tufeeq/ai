'use strict';
(function(){
 const LIVE='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/live-quotes.json';
 const RESCUE='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/coverage-rescue.json';
 const n=v=>Number.isFinite(Number(v))?Number(v):null;
 const ageMin=t=>{const x=t?(Date.now()-new Date(t).getTime())/60000:1e9;return Number.isFinite(x)?x:1e9};
 function sharia(t){try{const x=window.rowMap?.get?.(String(t||'').toUpperCase());return window.TAGXShariaGateV27?.status?.(x)||'UNVERIFIED'}catch{return 'UNVERIFIED'}}
 function classify(e,src,isRescue){
   const t=String(e.ticker||'').toUpperCase(),ch=n(e.changePct),v5=n(e.priceVelocity5mPct),v15=n(e.priceVelocity15mPct),va=n(e.volumeAcceleration5m),to=n(e.turnover5mPctFloat);
   const dataFresh=ageMin(src.updatedAtUTC||src.updatedAtET)<=8&&(!src.dataConfidence||String(src.dataConfidence).toUpperCase()==='HIGH');
   const early=ch!=null&&ch>=1&&ch<14&&(v5||0)>0;
   const structure=(va!=null&&va>=2)||(to!=null&&to>=0.15);
   const s=sharia(t);
   const blockers=[];
   if(!dataFresh)blockers.push('بيانات السوق غير حديثة/موثوقة');
   if(!early)blockers.push('ليست في نافذة Early');
   if(!structure)blockers.push('لا يوجد تأكيد مستقل للحجم/الفلوّت');
   if(s!=='VERIFIED')blockers.push('الشرعية '+s);
   if(isRescue)blockers.push('Coverage Rescue للاكتشاف فقط؛ يحتاج تأكيدًا من المسار الأساسي');
   return {ticker:t,change:ch,price:n(e.price),v5,v15,ers:n(e.earlyRegimeShiftScore),ign:n(e.ignitionScore),structure,sharia:s,dataFresh,blockers,isRescue,sourceLane:e.universeLane||e.sourceLane||'',executable:!isRescue&&dataFresh&&early&&structure&&s==='VERIFIED'};
 }
 function mergedRows(live,rescue){
   const out=[],seen=new Set();
   for(const e of (Array.isArray(live.emergingCandidates)?live.emergingCandidates:[])){
     const t=String(e.ticker||'').toUpperCase();if(!t||seen.has(t))continue;seen.add(t);out.push({e,a:classify(e,live,false)});
   }
   for(const e of (Array.isArray(rescue?.earlyCandidates)?rescue.earlyCandidates:[])){
     const t=String(e.ticker||'').toUpperCase();if(!t||seen.has(t))continue;seen.add(t);out.push({e,a:classify(e,rescue,true)});
   }
   return out.sort((x,y)=>{if(x.a.isRescue!==y.a.isRescue)return x.a.isRescue?1:-1;return (y.a.ers||Math.abs(y.a.v5||0)*10)-(x.a.ers||Math.abs(x.a.v5||0)*10)});
 }
 function render(live,rescue){
   const rows=mergedRows(live,rescue);
   let sec=document.querySelector('[data-marketwatch32]');
   if(!sec){sec=document.createElement('section');sec.dataset.marketwatch32='1';sec.className='hero';const radar=document.querySelector('#radarView');const first=radar?.querySelector('.hero');if(first?.nextSibling)radar.insertBefore(sec,first.nextSibling);else radar?.prepend(sec)}
   const liveAge=Math.round(ageMin(live.updatedAtUTC||live.updatedAtET));
   const rescueAge=Math.round(ageMin(rescue?.updatedAtUTC||rescue?.updatedAtET));
   const exec=rows.filter(x=>x.a.executable).length;
   const rescued=rows.filter(x=>x.a.isRescue).length;
   sec.innerHTML='<h2>TAGX V33 · Early Watch + Coverage Rescue</h2><p>الرادار الأساسي يبقى صاحب قرار التنفيذ. مسار Coverage Rescue يبحث خارج الـUniverse الحالي عن movers فاتتنا، ويعرضها للمراجعة فقط حتى يؤكدها المسار الأساسي والشرعية والسيولة.</p>'+
   '<div class="status"><span class="chip '+(liveAge<=8?'ok':'bad')+'">Primary '+liveAge+'د</span><span class="chip '+(rescueAge<=8?'ok':'bad')+'">Rescue '+rescueAge+'د</span><span class="chip">'+rows.length+' Early</span><span class="chip">'+rescued+' rescued</span><span class="chip '+(exec?'ok':'warn')+'">'+exec+' executable</span></div>'+
   '<div class="opps">'+(rows.length?rows.slice(0,10).map(({a})=>'<article class="opp '+(a.executable?'best':'')+'" data-ticker="'+a.ticker+'"><div class="rank">'+(a.executable?'EXECUTION-ELIGIBLE':(a.isRescue?'COVERAGE RESCUE · NOT A BUY':'MARKET WATCH · NOT A BUY'))+'</div><div class="ticker">'+a.ticker+'</div><div class="move">'+((a.change||0)>=0?'+':'')+(a.change||0).toFixed(1)+'%</div><div class="meta">'+(a.ers!=null?'ERS '+a.ers+' · ':'')+(a.ign!=null?'Ign '+a.ign+' · ':'')+'V5 '+(a.v5==null?'—':a.v5.toFixed(1)+'%')+' · '+a.sharia+'</div><div class="why">'+(a.executable?'الأدلة الأساسية مكتملة؛ يخضع لبقية بوابات TAGX.':a.blockers.join(' · '))+'</div></article>').join(''):'<div class="empty">لا توجد Early candidates حديثة في المسارين.</div>')+'</div>';
 }
 async function get(url){const r=await fetch(url+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error(url+' '+r.status);return r.json()}
 async function sync(){try{const [live,rescue]=await Promise.all([get(LIVE),get(RESCUE).catch(()=>null)]);render(live,rescue)}catch(e){console.warn('TAGX V33 watchboard fail-closed',e)}}
 window.TAGXMarketWatchV33={sync,classify,mergedRows};sync();setInterval(sync,30000);
})();
