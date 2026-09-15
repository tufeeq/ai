import {createMarketService} from './market.mjs';
export function createHandler({env=globalThis.process?.env??{},service=createMarketService({env})}={}){
 return async function handle(req,res){
  const origin=req.headers.origin,allowed=env.TAGIT_ALLOWED_ORIGIN||'https://tufeeq.github.io';
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
  if(origin&&origin!==allowed){res.statusCode=403;return res.end(JSON.stringify({status:'ORIGIN_NOT_ALLOWED'}));}
  if(origin){res.setHeader('Access-Control-Allow-Origin',allowed);res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');}
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end();}
  if(req.method!=='GET'){res.statusCode=405;return res.end(JSON.stringify({status:'METHOD_NOT_ALLOWED'}));}
  try{
   const url=new URL(req.url,'http://localhost');let result;
   if(url.pathname==='/api/health')result=service.health();
   else if(url.pathname==='/api/quotes')result=await service.quotes(url.searchParams.get('symbols'));
   else if(url.pathname==='/api/universe')result=await service.universe();
   else {res.statusCode=404;return res.end(JSON.stringify({status:'NOT_FOUND'}));}
   res.statusCode=result.status==='INELIGIBLE_SYMBOLS'?422:200;res.end(JSON.stringify(result));
  }catch(e){
   const known=new Set(['INVALID_SYMBOLS','INVALID_FEED','CURRENT_UNIVERSE_REQUIRED','RUNTIME_CREDENTIALS_NOT_CONFIGURED','PROVIDER_AUTH_FAILED','FEED_NOT_ENTITLED','RATE_LIMITED','PROVIDER_UNAVAILABLE','INVALID_PROVIDER_RESPONSE']);
   const status=known.has(e.message)?e.message:'SERVICE_ERROR';
   res.statusCode=status==='INVALID_SYMBOLS'?400:status==='RATE_LIMITED'?429:503;
   if(status==='RATE_LIMITED')res.setHeader('Retry-After','30');
   res.end(JSON.stringify({schema_version:1,status,rows:[],approved_for_live:false}));
  }
 };
}
// Lazy initialization also permits importing the handler in Web API runtimes.
let defaultHandler;
export default function handle(req,res){
 defaultHandler??=createHandler();
 return defaultHandler(req,res);
}
