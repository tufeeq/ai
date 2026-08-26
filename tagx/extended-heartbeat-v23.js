'use strict';
(function(){
 const URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/extended-hot.json';
 function age(t){const x=t?new Date(t).getTime():NaN;return Number.isFinite(x)?(Date.now()-x)/60000:1e9}
 async function sync(){
  try{
   const api=window.TAGXExtendedHoursV16;if(!api||!api.ext)return;
   const r=await fetch(URL+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)return;
   const h=await r.json();if(!h||h.session!=='after-hours'||age(h.updatedAtUTC)>12)return;
   const e=api.ext;const mainAge=age(e.updatedAtUTC);const hotAge=age(h.updatedAtUTC);
   if(hotAge>=mainAge)return;
   e.rows={...(e.rows||{}),...(h.rows||{})};e.updatedAtUTC=h.updatedAtUTC;e.session=h.session;e.dataConfidence=h.dataConfidence||e.dataConfidence;e.scanPolicy='HEARTBEAT_FAILOVER+'+(e.scanPolicy||'MAIN');
   if(typeof api.mergeNativeCandidates==='function')api.mergeNativeCandidates();
   if(typeof window.render==='function')window.render();
   const s=document.querySelector('#status');if(s){let c=s.querySelector('[data-heartbeat23]');if(!c){c=document.createElement('span');c.dataset.heartbeat23='1';s.appendChild(c)}c.className='chip ok';c.textContent='Heartbeat '+Math.round(hotAge)+'د · '+(h.count||0)+' سهم'}
  }catch(err){console.warn('TAGX heartbeat failover',err)}
 }
 window.TAGXExtendedHeartbeatV23={sync};sync();setInterval(sync,30000);
})();
