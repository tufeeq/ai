import {createHandler} from './src/http.mjs';
import {createMarketService} from './src/market.mjs';

// Cloudflare supplies protected bindings through env. Never copy them to a
// process-global object. Cache state belongs to this binding set and isolate.
export function createWorker({serviceFactory=createMarketService}={}){
 const handlers=new WeakMap();
 return {async fetch(request,env){
  let handler=handlers.get(env);
  if(!handler){
   handler=createHandler({env,service:serviceFactory({env})});
   handlers.set(env,handler);
  }
  const headers=new Headers();let response;
  const res={statusCode:200,
   setHeader(name,value){headers.set(name,String(value));},
   end(body){response=new Response(this.statusCode===204?null:(body??null),{status:this.statusCode,headers});}
  };
  await handler({url:request.url,method:request.method,headers:{origin:request.headers.get('Origin')}},res);
  return response;
 }};
}
export default createWorker();
