import http from 'node:http';
import handle from './src/http.mjs';
http.createServer(handle).listen(Number(process.env.PORT||8787),'127.0.0.1');
