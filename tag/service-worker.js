const CACHE='tag8-shell-v4';
const SHELL=['./','./index.html','./styles.css','./tag8.css','./webapp.css','./concise.css','./app.js','./tag8-ui.js','./webapp.js','./manual-analyzer.js','./model/tag8-engine.js','./model/tag6-runtime-guard.js','./model/tag6-behavioral-learning.js','./model/tag6-early-discovery-upgrade.js','./manifest.webmanifest','./tag-icon.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(e.request.method!=='GET')return;
 if(u.pathname.includes('/tag/data/')||u.pathname.endsWith('.json')){e.respondWith(fetch(e.request,{cache:'no-store'}));return;}
 if(u.origin===location.origin){e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request)));}
});