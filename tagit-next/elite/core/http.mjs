import {readFile} from 'node:fs/promises';
const publicRoot=new URL('../web/',import.meta.url);
const files=new Set(['index.html','app.mjs','presentation.mjs','style.css','favicon.svg','data/summary.json',...['2026-08-24','2026-08-25','2026-08-26','2026-08-27','2026-08-28','2026-08-31','2026-09-01','2026-09-02','2026-09-03','2026-09-04'].map(d=>'data/'+d+'.json.gz')]);
export async function eliteHttp(req,res,elite) {
 const url=new URL(req.url,'http://localhost');
 if(!url.pathname.startsWith('/elite')&&!url.pathname.startsWith('/api/elite/'))return false;
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.statusCode=405;res.end('Method not allowed');return true;}
 if(url.pathname.startsWith('/api/elite/')){
   if(req.headers.origin&&req.headers.origin!=='https://tufeeq.github.io'){res.statusCode=403;res.end('Origin not allowed');return true;}
   res.setHeader('Access-Control-Allow-Origin','https://tufeeq.github.io');res.setHeader('Vary','Origin');res.setHeader('Content-Type','application/json; charset=utf-8');
   if(url.pathname==='/api/elite/status')res.end(JSON.stringify(elite.status()));
   else if(url.pathname==='/api/elite/opportunities')res.end(JSON.stringify(elite.snapshot()));
   else if(url.pathname==='/api/elite/timeline'&&/^[a-f0-9]{24}$/.test(url.searchParams.get('id')||''))res.end(JSON.stringify(elite.timeline(url.searchParams.get('id'))));
   else{res.statusCode=404;res.end(JSON.stringify({status:'NOT_FOUND'}));}return true;
 }
 if(url.pathname==='/elite'){res.statusCode=302;res.setHeader('Location','/elite/');res.end();return true;}
 const path=url.pathname.slice('/elite/'.length)||'index.html';
 if(!files.has(path)){res.statusCode=404;res.end('Not found');return true;}
 try{const data=await readFile(new URL(path,publicRoot));res.setHeader('Content-Type',path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css':path.endsWith('.mjs')?'text/javascript':path.endsWith('.svg')?'image/svg+xml':'application/json');res.end(data);}catch{res.statusCode=404;res.end('Not found');}return true;
}
