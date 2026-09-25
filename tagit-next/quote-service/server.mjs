import http from 'node:http';
import {createHandler} from './src/http.mjs';
import {createRuntime} from './src/runtime.mjs';
import {createSharia} from './src/sharia.mjs';
import {createElite} from '../elite/core/live.mjs';
import {eliteHttp} from '../elite/core/http.mjs';
const elite=createElite(),runtime=createRuntime({onEvidence:e=>elite.observe(e)}),handle=createHandler({runtime,sharia:createSharia()});
const server=http.createServer(async(req,res)=>{try{if(!await eliteHttp(req,res,elite))await handle(req,res);}catch{res.statusCode=503;res.end(JSON.stringify({status:'SERVICE_ERROR'}));}}).listen(Number(process.env.PORT||8787),process.env.HOST||'0.0.0.0',()=>runtime.start());
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void runtime.close().then(()=>elite.close());server.close();setTimeout(()=>process.exit(0),5000).unref();});
