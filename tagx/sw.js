const VERSION='tagx-sw-29.0';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())await caches.delete(k);await self.clients.claim()})()));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(e.request.mode==='navigate'&&u.pathname.includes('/ai/tagx/')){
  e.respondWith(fetch(e.request,{cache:'no-store'}).then(async r=>{
   const html=await r.text();let injected=html;
   if(!injected.includes('enhance-v12.js'))injected=injected.replace('</body>','<script src="./enhance-v12.js?v=29.0"></script></body>');
   if(!injected.includes('extended-v16.js'))injected=injected.replace('</body>','<script src="./extended-v16.js?v=29.0"></script><script>document.title="TAGX 1.6 — Extended Intelligence V29";const e=document.querySelector(".ey");if(e)e.textContent="TAGX 1.6 · EXTENDED INTELLIGENCE V29";</script></body>');
   if(!injected.includes('regular-open-v17.js'))injected=injected.replace('</body>','<script src="./regular-open-v17.js?v=29.0"></script></body>');
   if(!injected.includes('peak-memory-v18.js'))injected=injected.replace('</body>','<script src="./peak-memory-v18.js?v=29.0"></script></body>');
   if(!injected.includes('postclose-v19.js'))injected=injected.replace('</body>','<script src="./postclose-v19.js?v=29.0"></script></body>');
   if(!injected.includes('ah-v22.js'))injected=injected.replace('</body>','<script src="./ah-v22.js?v=29.0"></script></body>');
   if(!injected.includes('extended-heartbeat-v23.js'))injected=injected.replace('</body>','<script src="./extended-heartbeat-v23.js?v=29.0"></script></body>');
   if(!injected.includes('freshness-fallback-v24.js'))injected=injected.replace('</body>','<script src="./freshness-fallback-v24.js?v=29.0"></script></body>');
   if(!injected.includes('live-rescue-v27.js'))injected=injected.replace('</body>','<script src="./live-rescue-v27.js?v=29.0"></script></body>');
   if(!injected.includes('sharia-gate-v27.js'))injected=injected.replace('</body>','<script src="./sharia-gate-v27.js?v=29.0"></script></body>');
   if(!injected.includes('actionability-v29.js'))injected=injected.replace('</body>','<script src="./actionability-v29.js?v=29.0"></script></body>');
   const h=new Headers(r.headers);h.set('content-type','text/html; charset=utf-8');h.set('cache-control','no-store, no-cache, must-revalidate');return new Response(injected,{status:r.status,statusText:r.statusText,headers:h});
  }).catch(()=>fetch(e.request,{cache:'no-store'})));
 }
});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const c of list){if('focus'in c)return c.focus()}return clients.openWindow('./')}))});