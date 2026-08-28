const VERSION='tagx-sw-35.0';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())await caches.delete(k);await self.clients.claim()})()));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(e.request.mode==='navigate'&&u.pathname.includes('/ai/tagx/')){
  e.respondWith(fetch(e.request,{cache:'no-store'}).then(async r=>{
   const html=await r.text();let injected=html;
   const scripts=['enhance-v12.js','extended-v16.js','regular-open-v17.js','peak-memory-v18.js','postclose-v19.js','ah-v22.js','extended-heartbeat-v23.js','freshness-fallback-v24.js','live-rescue-v27.js','sharia-gate-v27.js','actionability-v29.js','outcome-calibration-v30.js','independence-gate-v31.js','market-watch-v32.js','lab-safety-v34.js','continuation-proof-v35.js'];
   for(const s of scripts)if(!injected.includes(s))injected=injected.replace('</body>','<script src="./'+s+'?v=35.0"></script></body>');
   injected=injected.replace('TAGX 1.2 · EARLY MARKET INTELLIGENCE','TAGX · EXPERIMENTAL V35');
   const h=new Headers(r.headers);h.set('content-type','text/html; charset=utf-8');h.set('cache-control','no-store, no-cache, must-revalidate');return new Response(injected,{status:r.status,statusText:r.statusText,headers:h});
  }).catch(()=>fetch(e.request,{cache:'no-store'})));
 }
});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const c of list){if('focus'in c)return c.focus()}return clients.openWindow('./')}))});