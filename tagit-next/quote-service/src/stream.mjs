import {settings} from './market.mjs';
// One provider connection. Clients cannot widen the subscription or submit orders.
export function createStream({env=process.env,Socket=WebSocket,now=Date.now,onEvent=()=>{},onStatus=()=>{}}={}){
 const config=settings(env);const max=Number(env.TAGIT_STREAM_SYMBOL_LIMIT||30);
 if(!Number.isInteger(max)||max<1||max>10000)throw Error('INVALID_STREAM_LIMIT');
 let socket=null,timer=null,stopped=true,attempt=0,wanted=[],subscribed=[],state='DISABLED',lastMessage=null,authenticated=false;
 const emit=()=>onStatus(status());
 function status(){return {state,feed:config.feed,authenticated,subscribed:subscribed.length,subscribed_symbols:[...subscribed],requested:wanted.length,
  symbol_limit:max,partial:wanted.length>max,last_message_at:lastMessage,
  message_age_ms:lastMessage?now()-Date.parse(lastMessage):null,transport:'ALPACA_WEBSOCKET',approved_for_live:false};}
 function send(x){if(socket?.readyState===1)socket.send(JSON.stringify(x));}
 function subscribe(){if(!authenticated)return;const target=wanted.slice(0,max);
  const remove=subscribed.filter(s=>!target.includes(s));if(remove.length)send({action:'unsubscribe',quotes:remove,trades:remove,bars:remove,updatedBars:remove});
  const add=target.filter(s=>!subscribed.includes(s));if(add.length)send({action:'subscribe',quotes:add,trades:add,bars:add,updatedBars:add});
 }
 function connect(){
  if(stopped)return;if(!config.configured){state='MISSING_CREDENTIALS';emit();return;}
  if(config.feed==='delayed_sip'){state='DELAYED_NOT_LIVE';emit();return;}
  state='CONNECTING';authenticated=false;subscribed=[];emit();socket=new Socket('wss://stream.data.alpaca.markets/v2/'+config.feed);
  socket.addEventListener('message',e=>{if(stopped)return;let rows;try{rows=JSON.parse(e.data);}catch{state='INVALID_MESSAGE';emit();socket.close();return;}
   if(!Array.isArray(rows)){state='INVALID_MESSAGE';emit();socket.close();return;}
   lastMessage=new Date(now()).toISOString();
   for(const r of rows){
    if(r.T==='success'&&r.msg==='connected')send({action:'auth',key:config.key,secret:config.secret});
    else if(r.T==='success'&&r.msg==='authenticated'){authenticated=true;state='AUTHENTICATED';attempt=0;subscribe();emit();}
    else if(r.T==='subscription'){subscribed=r.quotes??[];state=subscribed.length?'SUBSCRIBED':'IDLE';emit();}
    else if(r.T==='error'){state='PROVIDER_ERROR_'+String(r.code);emit();socket.close();}
    else if(['q','t','b','u','c','x'].includes(r.T)&&wanted.includes(r.S))onEvent({...r,received_at:lastMessage,feed:config.feed});
   }
  });
  socket.addEventListener('error',()=>{state='CONNECTION_ERROR';emit();socket.close();});
  socket.addEventListener('close',()=>{authenticated=false;subscribed=[];if(stopped)return;state='DISCONNECTED';emit();timer=setTimeout(connect,Math.min(60000,1000*2**Math.min(attempt++,6)));timer.unref?.();});
 }
 return {status,start(){if(!stopped)return;stopped=false;connect();},
  setSymbols(symbols){wanted=[...new Set(symbols)].filter(s=>/^[A-Z][A-Z0-9.-]{0,9}$/.test(s));subscribe();emit();},
  stop(){stopped=true;clearTimeout(timer);socket?.close();authenticated=false;state='STOPPED';emit();}};
}
