'use strict';
(function(){
 const URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/live-quotes.json';
 function age(t){const n=t?(Date.now()-new Date(t).getTime())/60000:1e9;return Number.isFinite(n)?n:1e9}
 function tickerOf(q,k){return String(q?.ticker||k||'').toUpperCase()}
 function inject(live){
   const baseAge=age(window.latestMeta?.snapshotTimestampUTC||window.latestMeta?.updatedAt||window.latestMeta?.snapshotTimestampET);
   const liveAge=age(live.updatedAtUTC||live.updatedAtET);
   if(liveAge>20||live.marketClockSession!=='regular')return;
   const qmap=live.quotes||{};
   const em=Array.isArray(live.emergingCandidates)?live.emergingCandidates:[];
   const focus=new Set(em.map(x=>String(x.ticker||'').toUpperCase()));
   const changed=[];
   for(const [k,q] of Object.entries(qmap)){
     const t=tickerOf(q,k); if(!t)continue;
     let x=window.rowMap?.get?.(t);
     if(!x){
       if(!focus.has(t))continue;
       x={Ticker:t,Company:'Live emergence rescue',Price:q.price,Change:q.changePct,Volume:q.volume||0,'Rel Volume':0,Float:null,_sources:['live-rescue-v27'],_liveSynthetic:true,_firstObservedChange:q.changePct,_firstObservedTimestampUTC:q.timestampUTC};
       window.rows.push(x);window.rowMap.set(t,x);changed.push(t);
     }else{
       x.Price=q.price??x.Price;x.Change=q.changePct??x.Change;x.Volume=q.volume??x.Volume;x._sources=[...new Set([...(x._sources||[]),'live-rescue-v27'])];changed.push(t);
     }
   }
   for(const e of em){
     const t=String(e.ticker||'').toUpperCase(),x=window.rowMap?.get?.(t);if(!x)continue;
     x._earlyRegimeShiftScore=e.earlyRegimeShiftScore;x._ignitionScore=e.ignitionScore;x._priceVelocity5mPct=e.priceVelocity5mPct;x._priceVelocity15mPct=e.priceVelocity15mPct;x._volumeAcceleration5m=e.volumeAcceleration5m;x._turnover5mPctFloat=e.turnover5mPctFloat;
   }
   if(baseAge>20){
     window.latestMeta={...(window.latestMeta||{}),snapshotTimestampUTC:live.updatedAtUTC,updatedAt:live.updatedAtUTC,session:'regular',source:'live-quotes rescue v27',dataConfidence:live.dataConfidence||'HIGH'};
   }
   if(changed.length&&typeof window.render==='function')window.render();
   const st=document.querySelector('#status');if(st){let c=st.querySelector('[data-live27]');if(!c){c=document.createElement('span');c.dataset.live27='1';st.appendChild(c)}c.className='chip '+(liveAge<=10?'ok':'warn');c.textContent='Live '+Math.round(liveAge)+'د · '+(live.freshCount||0)+' fresh · '+em.length+' emerging'}
 }
 async function sync(){try{const r=await fetch(URL+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)return;inject(await r.json())}catch(e){console.warn('TAGX live rescue v27',e)}}
 window.TAGXLiveRescueV27={sync};sync();setInterval(sync,30000);
})();