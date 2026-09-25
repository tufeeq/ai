// Read-only deployment probe. Configure the UI only after real HTTP evidence.
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {serviceOrigin,validPayload} from '../../web/price-state.mjs';
import {parseSymbols} from '../src/market.mjs';
export async function verifyConnection(endpoint,symbolList,{fetcher=fetch}={}){
 const origin=serviceOrigin(endpoint),symbols=parseSymbols(symbolList);
 async function get(path){
  let response;try{response=await fetcher(origin+path,{headers:{Origin:'https://tufeeq.github.io'},cache:'no-store',signal:AbortSignal.timeout(12000),redirect:'error'});}catch{throw new Error('DEPLOYMENT_UNREACHABLE');}
  if(response.headers.get('access-control-allow-origin')!=='https://tufeeq.github.io')throw new Error('CORS_NOT_CONFIGURED');
  let value;try{value=await response.json();}catch{throw new Error('INVALID_SERVICE_RESPONSE');}
  const known=['RUNTIME_CREDENTIALS_NOT_CONFIGURED','FEED_NOT_ENTITLED','PROVIDER_AUTH_FAILED','CURRENT_UNIVERSE_REQUIRED','INELIGIBLE_SYMBOLS','RATE_LIMITED'];
  if(!response.ok)throw new Error(known.includes(value.status)?value.status:'SERVICE_REQUEST_FAILED');
  return value;
 }
 const health=await get('/api/health');
 if(health.credentials_configured!==true)throw new Error('RUNTIME_CREDENTIALS_NOT_CONFIGURED');
 const quotes=await get('/api/quotes?symbols='+encodeURIComponent(symbols.join(',')));
 if(!validPayload(quotes,symbols))throw new Error('INVALID_PRICE_PAYLOAD');
 if(!quotes.rows.some(r=>r.quote||r.trade))throw new Error('NO_OBSERVED_PRICES');
 return {endpoint:origin,checked_at:new Date().toISOString(),transport_verified:true,feed:quotes.feed,
  symbols:quotes.rows.map(r=>r.symbol),rejected:quotes.rejected??[],
  recent_quotes:quotes.rows.filter(r=>['RECENT_IEX','RECENT_SIP'].includes(r.status)).length,
  statuses:Object.fromEntries(quotes.rows.map(r=>[r.symbol,r.status])),approved_for_live:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [endpoint,symbols='SENS,NUAI,BTCT',flag]=process.argv.slice(2);
  const result=await verifyConnection(endpoint,symbols);
  if(flag==='--write-config'){
   const file=new URL('../../web/live-config.json',import.meta.url),config=JSON.parse(await readFile(file,'utf8'));
   config.endpoint=result.endpoint;config.deployment_status='HTTP_VERIFIED';config.default_symbols=result.symbols;config.verified_at=result.checked_at;
   await writeFile(file,JSON.stringify(config,null,2)+'\n');
  }
  console.log(JSON.stringify(result,null,2));
 }catch(error){
  const known=new Set(['DEPLOYMENT_UNREACHABLE','CORS_NOT_CONFIGURED','INVALID_SERVICE_RESPONSE','RUNTIME_CREDENTIALS_NOT_CONFIGURED','FEED_NOT_ENTITLED','PROVIDER_AUTH_FAILED','CURRENT_UNIVERSE_REQUIRED','INELIGIBLE_SYMBOLS','RATE_LIMITED','SERVICE_REQUEST_FAILED','INVALID_PRICE_PAYLOAD','NO_OBSERVED_PRICES','INVALID_SERVICE_ORIGIN','INVALID_SYMBOLS']);
  console.error(JSON.stringify({transport_verified:false,status:known.has(error.message)?error.message:'VERIFICATION_FAILED',approved_for_live:false}));process.exitCode=1;
 }
}
