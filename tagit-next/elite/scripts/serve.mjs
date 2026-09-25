import http from 'node:http';
import {eliteHttp} from '../core/http.mjs';
const empty={status:()=>({mode:'REPLAY',storage:'LOCAL_PREVIEW',approvedForLive:false}),snapshot:()=>({mode:'SHADOW',opportunities:[],status:{lastError:'LOCAL_PREVIEW_NO_PROVIDER'}})};
http.createServer(async(req,res)=>{if(req.url==='/'){res.writeHead(302,{Location:'/elite/'});res.end();}else if(!await eliteHttp(req,res,empty)){res.writeHead(404);res.end();}}).listen(Number(process.env.PORT||8790),'0.0.0.0');
