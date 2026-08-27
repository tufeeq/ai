'use strict';
(function(){
 const BASE='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/';
 function age(t){const x=t?new Date(t).getTime():NaN;return Number.isFinite(x)?(Date.now()-x)/60000:1e9}
 function marketSession(){const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false,weekday:'short'}).formatToParts(new Date());const g=k=>p.find(x=>x.type===k)?.value;const m=(+g('hour'))*60+(+g('minute'));if(['Sat','Sun'].includes(g('weekday')))return'CLOSED';if(m>=240&&m<570)return'pre-market';if(m>=960&&m<1200)return'after-hours';return'CLOSED'}
 async function sync(){
  try{
   const api=window.TAGXExtendedHoursV16;if(!api||!api.ext)return;
   const sess=marketSession();if(sess==='CLOSED')return;
   const file=sess==='pre-market'?'premarket-hot.json':'extended-hot.json';
   const r=await fetch(BASE+file+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)return;
   const h=await r.json();if(!h||h.session!==sess||age(h.updatedAtUTC)>12)return;
   const e=api.ext;const mainAge=age(e.updatedAtUTC);const hotAge=age(h.updatedAtUTC);
   if(e.session===sess&&hotAge>=mainAge)return;
   e.rows={...(e.rows||{}),...(h.rows||{})};e.updatedAtUTC=h.updatedAtUTC;e.session=h.session;e.dataConfidence=h.dataConfidence||e.dataConfidence;e.scanPolicy=(sess==='pre-market'?'PREMARKET_':'AH_')+'HEARTBEAT_FAILOVER+'+(e.scanPolicy||'MAIN');
   if(typeof api.mergeNativeCandidates==='function')api.mergeNativeCandidates();
   if(typeof window.render==='function')window.render();
   const s=document.querySelector('#status');if(s){let c=s.querySelector('[data-heartbeat23]');if(!c){c=document.createElement('span');c.dataset.heartbeat23='1';s.appendChild(c)}c.className='chip ok';c.textContent=(sess==='pre-market'?'Premarket':'Heartbeat')+' '+Math.round(hotAge)+'د · '+(h.count||0)+' سهم'}
  }catch(err){console.warn('TAGX heartbeat failover',err)}
 }
 window.TAGXExtendedHeartbeatV23={sync};sync();setInterval(sync,30000);
})();
