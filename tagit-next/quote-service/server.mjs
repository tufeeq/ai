import http from 'node:http';
import {createHandler} from './src/http.mjs';
import {createRuntime} from './src/runtime.mjs';
import {createSharia} from './src/sharia.mjs';
const runtime=createRuntime(),handle=createHandler({runtime,sharia:createSharia()});
const server=http.createServer(handle).listen(Number(process.env.PORT||8787),process.env.HOST||'0.0.0.0',()=>runtime.start());
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void runtime.close();server.close();setTimeout(()=>process.exit(0),5000).unref();});
