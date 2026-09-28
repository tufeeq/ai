import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWatchlist,pickPrice,nasdaqDateTime,createLiveBoard,extendedHours,parseBoardSymbols,watchlistUrl,nasdaqMinute} from '../src/live.mjs';
import {createHandler} from '../src/http.mjs';

const T=Date.parse('2026-09-25T18:41:30Z'); // 14:41:30 New York, Friday
const env={ALPACA_API_KEY_ID:'k',ALPACA_API_SECRET_KEY:'s'};
const REF=(at='2026-09-25T12:00:00Z')=>({schemaVersion:1,updatedAt:at,rows:['AAA','BBB','CCC'].map(t=>({Ticker:t,Industry:'Biotechnology','Market Cap':'50'}))});
const item=(symbol,price,time,change='+0.10')=>({symbol,lastSalePrice:'$'+price,netChange:change,percentageChange:'+1.00%',lastTradeTimestamp:time});

test('live: watchlist rows need a price and a minute time that is not in the future',()=>{
 const m=parseWatchlist({data:[item('AAA','2.00','Sep 25, 2026 2:41 PM ET'),item('BBB','1.00','Sep 25, 2026'),item('CCC','3.00','Sep 25, 2026 2:59 PM ET'),{symbol:'DDD',lastSalePrice:'N/A'}]},T);
 assert.deepEqual([...m.keys()],['AAA']);
 assert.equal(m.get('AAA').trade_minute_at,'2026-09-25T18:41:00.000Z');
 assert.equal(m.get('AAA').previous_close,1.9);
 assert.equal(watchlistUrl(['AAA','B.C']),'https://api.nasdaq.com/api/quote/watchlist?symbol=aaa%7Cstocks&symbol=b.c%7Cstocks');
 assert.equal(nasdaqMinute('Jan 5, 2026 9:31 AM ET'),'2026-01-05T14:31:00.000Z');
});

test('live: the newest trade wins; exact IEX beats a consolidated minute it falls inside; delayed bars only when newer',()=>{
 const nasdaq={price:2,trade_minute_at:'2026-09-25T18:40:00Z',fetched_at:'2026-09-25T18:41:25Z'};
 assert.equal(pickPrice({nasdaq,iex:{price:2.01,at:'2026-09-25T18:40:40Z'}}).price_source,'IEX');
 const later=pickPrice({nasdaq,iex:{price:2.01,at:'2026-09-25T18:39:59Z'}});
 assert.equal(later.price_source,'CONSOLIDATED');assert.equal(later.verified_at,nasdaq.fetched_at);
 assert.equal(pickPrice({nasdaq,sip:{price:1.5,at:'2026-09-25T18:20:00Z'}}).price_source,'CONSOLIDATED');
 assert.equal(pickPrice({iex:{price:2,at:'2026-09-25T17:00:00Z'},sip:{price:1.5,at:'2026-09-25T18:20:00Z'}}).price_source,'SIP_DELAYED');
 assert.equal(pickPrice({}),null);
});

function fakeProvider(calls,refAt){
 return async(url)=>{
  calls.push(url);
  const json=b=>({ok:true,status:200,json:async()=>b});
  if(url.includes('universe-broad'))return json(REF(refAt));
  if(url.includes('/v2/assets'))return json(['AAA','BBB','CCC'].map(symbol=>({symbol,exchange:'NASDAQ',status:'active'})));
  if(url.includes('nasdaq.com'))return json({data:[item('AAA','2.00','Sep 25, 2026 2:41 PM ET')]});
  if(url.includes('snapshots'))return json({BBB:{latestTrade:{p:1.1,t:'2026-09-25T18:41:20Z'},latestQuote:{bp:1.09,ap:1.11,t:'2026-09-25T18:41:21Z'}},AAA:{latestTrade:{p:1.95,t:'2026-09-25T18:10:00Z'}}});
  if(url.includes('timeframe=1Min'))return json({bars:{CCC:[{t:'2026-09-25T18:20:00Z',c:3.3}],AAA:[{t:'2026-09-25T18:24:00Z',c:1.97}]}});
  throw Error('unexpected '+url);
 };
}
const noTimers={setTimeout:()=>null,clearTimeout:()=>{}};

test('live: one tick fills every source; rows carry source, time, verification and a SIP day change',async()=>{
 const calls=[];
 const closes={peek:()=>new Map([['AAA',{close:1.6,session:'2026-09-24'}],['BBB',{close:1,session:'2026-09-24'}]]),status:()=>({status:'OK'})};
 const board=createLiveBoard({env,fetcher:fakeProvider(calls),now:()=>T,closes,timers:noTimers});
 await board.get();await board.tick();
 const out=await board.get();
 const by=Object.fromEntries(out.rows.map(r=>[r.symbol,r]));
 assert.equal(by.AAA.price_source,'CONSOLIDATED');assert.equal(by.AAA.price,2);assert.equal(by.AAA.price_time_resolution,'MINUTE_START');
 assert.equal(by.AAA.verified_at,new Date(T).toISOString());
 assert.equal(by.AAA.change_pct,25);assert.equal(by.AAA.change_basis,'SIP_SPLIT_ADJUSTED');assert.equal(by.AAA.previous_close_session,'2026-09-24');
 assert.equal(by.BBB.price_source,'IEX');assert.equal(by.BBB.bid,1.09);
 assert.equal(by.CCC.price_source,'SIP_DELAYED');assert.equal(by.CCC.change_basis,'UNAVAILABLE');
 assert.equal(by.AAA.sip_delayed.price,1.97);
 assert.equal(out.coverage.universe,3);assert.equal(out.coverage.consolidated_confirmed_60s,1);assert.equal(out.coverage.delayed_only,1);
 assert.ok(calls.some(u=>u.includes('feed=sip')&&u.includes('timeframe=1Min')));
 // SIP bars requested end at least 16 minutes before now.
 const end=decodeURIComponent(calls.find(u=>u.includes('timeframe=1Min')).match(/end=([^&]+)/)[1]);
 assert.ok(T-Date.parse(end)>=16*60000);
});

test('live: a price from an earlier session gets no day change from today\'s reference close',async()=>{
 const sunday=Date.parse('2026-09-27T15:00:00Z');
 const closes={peek:()=>new Map([['BBB',{close:1,session:'2026-09-25'}]]),status:()=>({})};
 const board=createLiveBoard({env,fetcher:fakeProvider([],'2026-09-25T20:00:00Z'),now:()=>sunday,closes,timers:noTimers});
 await board.get();await board.tick();
 const bbb=(await board.get(['BBB'])).rows[0];
 assert.equal(bbb.price,1.1);assert.equal(bbb.change_pct,null);assert.equal(bbb.change_basis,'UNAVAILABLE');
});

test('live: viewed symbols are refreshed first and a block backs off',async()=>{
 const calls=[];let clock=T;
 const base=fakeProvider(calls);
 let block=false;
 const fetcher=async url=>url.includes('nasdaq.com')&&block?{ok:false,status:403}:base(url);
 const board=createLiveBoard({env,fetcher,now:()=>clock,options:{nasdaqBatch:1},timers:noTimers});
 await board.get();await board.tick();
 await board.get(['CCC']);calls.length=0;await board.tick();clock+=1000;await board.tick();
 assert.ok(calls.filter(u=>u.includes('nasdaq.com')).some(u=>/symbol=ccc%7Cstocks/.test(u)));
 block=true;clock+=3000;await board.tick();
 assert.equal(board.status().consolidated.status,'BACKING_OFF');
 calls.length=0;clock+=3000;await board.tick();
 assert.equal(calls.filter(u=>u.includes('nasdaq.com')).length,0);
});

test('live: polling stops when nobody has asked for the board',async()=>{
 let clock=T;const board=createLiveBoard({env,fetcher:fakeProvider([]),now:()=>clock,timers:noTimers});
 await board.get();await board.tick();clock+=6*60000;await board.tick();
 assert.equal(board.status().running,false);
});

test('live: extended hours and symbol parsing',()=>{
 assert.equal(extendedHours(Date.parse('2026-09-25T08:30:00Z')),true);  // 04:30 NY
 assert.equal(extendedHours(Date.parse('2026-09-26T15:00:00Z')),false); // Saturday
 assert.equal(parseBoardSymbols(null),null);
 assert.deepEqual(parseBoardSymbols('aaa,BBB,aaa'),['AAA','BBB']);
 assert.throws(()=>parseBoardSymbols('bad symbol'),/INVALID_SYMBOLS/);
});

test('live: the handler serves /api/live only when the server provides a board',async()=>{
 const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(b){this.body=b;}});
 const r1=res();await createHandler({service:{health:()=>({})}})({headers:{},method:'GET',url:'/api/live'},r1);
 assert.equal(r1.statusCode,404);
 const live={get:async s=>({schema_version:1,status:'OK',rows:(s??['X']).map(symbol=>({symbol}))}),status:()=>({})};
 const r2=res();await createHandler({service:{health:()=>({})},live})({headers:{},method:'GET',url:'/api/live?symbols=AAA'},r2);
 assert.equal(r2.statusCode,200);assert.equal(JSON.parse(r2.body).rows[0].symbol,'AAA');
 const r3=res();await createHandler({service:{health:()=>({})},live})({headers:{},method:'GET',url:'/api/live?symbols=a%20b'},r3);
 assert.equal(r3.statusCode,400);
});

test('live: watchlist datetime field is New York wall time; weekend date-only stamps are not trade times',()=>{
 const m=parseWatchlist({data:[{symbol:'AAA',lastSalePrice:'$0.86',netChange:'+0.0344',lastTradeTimestamp:'Sep 24, 2026',lastTradeTimestampDateTime:'2026-09-24T00:00:00',previousClosePrice:0.8256},{symbol:'BBB',lastSalePrice:'$1.36',lastTradeTimestamp:'Sep 25, 2026',lastTradeTimestampDateTime:'2026-09-25T14:40:00',previousClosePrice:1.31}]},T);
 assert.deepEqual([...m.keys()],['BBB']);
 assert.equal(m.get('BBB').trade_minute_at,'2026-09-25T18:40:00.000Z');assert.equal(m.get('BBB').previous_close,1.31);
});
