const VERSION='tagx-sw-15';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(e.request.mode==='navigate'&&u.pathname.includes('/ai/tagx/')){
  e.respondWith(fetch(e.request,{cache:'no-store'}).then(async r=>{
   const html=await r.text();let injected=html;
   if(!injected.includes('enhance-v12.js'))injected=injected.replace('</body>','<script src="./enhance-v12.js?v=15"></script></body>');
   if(!injected.includes('sharia-v13.js'))injected=injected.replace('</body>','<script src="./sharia-v13.js?v=15"></script></body>');
   if(!injected.includes('extended-v15.js'))injected=injected.replace('</body>','<script src="./extended-v15.js?v=15"></script><script>document.title="TAGX 1.5 — Session-Aware Early Intelligence";const e=document.querySelector(".ey");if(e)e.textContent="TAGX 1.5 · SESSION-AWARE EARLY INTELLIGENCE";</script></body>');
   const h=new Headers(r.headers);h.set('content-type','text/html; charset=utf-8');h.set('cache-control','no-store');return new Response(injected,{status:r.status,statusText:r.statusText,headers:h});
  }).catch(()=>fetch(e.request)));
 }
});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const c of list){if('focus'in c)return c.focus()}return clients.openWindow('./')}))});