import {createMarketService} from './market.mjs';
import {createScanner} from './scanner.mjs';
import {createLabService} from './lab.mjs';
import {createHaltWatcher} from './halts.mjs';
import {createConsolidated} from './consolidated.mjs';
import {applyClose} from './closes.mjs';

const OVERLAY_TOP=20;
/** Copy rows with current halt status and the cached consolidated quote (never mutates the scan). */
export async function decorate(result,{halts,consolidated,symbols,closes=null}){
 if(!Array.isArray(result?.rows))return result;
 const h=await halts.get();
 const overlay=consolidated.peek(symbols);
 const sip=closes?.peek(result.rows.map(r=>r.symbol))??new Map();
 return {...result,
  rows:result.rows.map(r=>({...applyClose(r,sip.get(r.symbol)),halt:h.halts.get(r.symbol)??null,halt_status:h.status,consolidated:overlay.get(r.symbol)??null})),
  complements:{halts:halts.status(),consolidated:consolidated.status(),closes:closes?.status()??null}};
}
const overlayFor=result=>result?.gainers?overlaySymbols(result.rows??[]):(result?.rows??[]).map(r=>r.symbol);
/** Scanner overlay targets: the strongest non-extended candidates plus any expansion. */
export function overlaySymbols(rows){
 const ranked=rows.filter(r=>!r.extended).sort((a,b)=>(b.score??0)-(a.score??0)).slice(0,OVERLAY_TOP).map(r=>r.symbol);
 return [...new Set([...ranked,...rows.filter(r=>r.signal?.expansion).map(r=>r.symbol)])];
}
export function createHandler({env=globalThis.process?.env??{},service=createMarketService({env}),runtime=null,sharia=null,halts=null,consolidated=null,closes=null}={}){
 // Halts and the consolidated overlay are enabled by the long-lived server; stateless workers pass payloads through.
 const complement=result=>halts&&consolidated?decorate(result,{halts,consolidated,closes,symbols:overlayFor(result)}):result;
 const scanner=runtime?.scanner??createScanner({env});
 const lab=createLabService({env});
 return async function handle(req,res){
  const origin=req.headers.origin,allowed=env.TAGIT_ALLOWED_ORIGIN||'https://tufeeq.github.io';
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
  if(origin&&origin!==allowed){res.statusCode=403;return res.end(JSON.stringify({status:'ORIGIN_NOT_ALLOWED'}));}
  if(origin){res.setHeader('Access-Control-Allow-Origin',allowed);res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');}
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end();}
  if(req.method!=='GET'){res.statusCode=405;return res.end(JSON.stringify({status:'METHOD_NOT_ALLOWED'}));}
  try{
   const url=new URL(req.url,'http://localhost');let result;
   if(url.pathname==='/api/health')result={...service.health(),runtime:runtime?.status()??null,complements:halts&&consolidated?{halts:halts.status(),consolidated:consolidated.status(),closes:closes?.status()??null}:null};
   else if(url.pathname==='/api/lab/connection')result=await lab.connection();
   else if(url.pathname==='/api/lab/provider')result=await lab.data(url.searchParams);
   else if(url.pathname==='/api/events'&&runtime)return runtime.events(req,res);
   else if(url.pathname==='/api/performance')result=runtime?.journal?{...runtime.journal.summary(),runtime:runtime.status(),recent:runtime.journal.recentSignals(100)}:{status:'SERVER_JOURNAL_NOT_CONFIGURED',profitability_claim_allowed:false};
   else if(url.pathname==='/api/sharia'&&sharia)result=await sharia.get(url.searchParams.get('symbol'));
   else if(url.pathname==='/api/quotes'){result=await complement(await service.quotes(url.searchParams.get('symbols')));}
   else if(url.pathname==='/api/scanner'){result=await complement(await scanner.get());}
   else if(url.pathname==='/api/universe')result=await service.universe();
   else {res.statusCode=404;return res.end(JSON.stringify({status:'NOT_FOUND'}));}
   res.statusCode=result.status==='INELIGIBLE_SYMBOLS'?422:200;res.end(JSON.stringify(result));
  }catch(e){
   const known=new Set(['INVALID_LAB_QUERY','INVALID_SYMBOLS','INVALID_FEED','CURRENT_UNIVERSE_REQUIRED','RUNTIME_CREDENTIALS_NOT_CONFIGURED','PROVIDER_AUTH_FAILED','FEED_NOT_ENTITLED','RATE_LIMITED','PROVIDER_UNAVAILABLE','INVALID_PROVIDER_RESPONSE']);
   const status=known.has(e.message)?e.message:'SERVICE_ERROR';
   res.statusCode=['INVALID_SYMBOLS','INVALID_LAB_QUERY'].includes(status)?400:status==='RATE_LIMITED'?429:503;
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
