import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHalts,nyToIso,createHaltWatcher} from '../src/halts.mjs';
import {parseQuote,nasdaqMinute,createConsolidated} from '../src/consolidated.mjs';
import {decorate,overlaySymbols,createHandler} from '../src/http.mjs';

const RSS=`<?xml version="1.0"?><rss xmlns:ndaq="http://www.nasdaqtrader.com/"><channel>
<item><ndaq:HaltDate>09/25/2026</ndaq:HaltDate><ndaq:HaltTime>10:01:02</ndaq:HaltTime><ndaq:IssueSymbol>AAA</ndaq:IssueSymbol><ndaq:ReasonCode>LUDP</ndaq:ReasonCode><ndaq:ResumptionTradeTime></ndaq:ResumptionTradeTime></item>
<item><ndaq:IssueSymbol>BBB</ndaq:IssueSymbol><ndaq:ReasonCode>T1</ndaq:ReasonCode><ndaq:ResumptionTradeTime>11:00:00</ndaq:ResumptionTradeTime></item>
</channel></rss>`;

test('halts: only unresumed halts are current, with New York times converted to UTC',()=>{
 const halts=parseHalts(RSS);
 assert.deepEqual([...halts.keys()],['AAA']);
 assert.equal(halts.get('AAA').halted_at,'2026-09-25T14:01:02.000Z');
 assert.equal(nyToIso('01/15/2026','09:30:00'),'2026-01-15T14:30:00.000Z'); // EST
 assert.equal(nyToIso('bad','09:30:00'),null);
});

test('halts: a failed feed reports UNKNOWN, never "not halted"',async()=>{
 const watcher=createHaltWatcher({fetcher:async()=>({ok:false,status:503})});
 const r=await watcher.get({wait:true});
 assert.equal(r.status,'UNKNOWN');assert.equal(r.halts.size,0);
 const good=createHaltWatcher({fetcher:async()=>({ok:true,text:async()=>RSS})});
 assert.equal((await good.get({wait:true})).halts.get('AAA').reason_code,'LUDP');
});

const QUOTE={data:{symbol:'SENS',primaryData:{lastSalePrice:'$10.185',lastTradeTimestamp:'Sep 25, 2026 2:40 PM ET',isRealTime:true,bidPrice:'$10.17',askPrice:'$10.20',volume:'344,650'}}};

test('consolidated: parses the real Nasdaq.com shape and rejects mismatched symbols or crossed quotes',()=>{
 const q=parseQuote('SENS',QUOTE,Date.parse('2026-09-25T18:40:30Z'));
 assert.equal(q.price,10.185);assert.equal(q.trade_minute_at,'2026-09-25T18:40:00.000Z');
 assert.equal(q.bid,10.17);assert.equal(q.volume,344650);assert.equal(q.real_time,true);
 assert.equal(parseQuote('OTHER',QUOTE,0),null);
 const crossed=structuredClone(QUOTE);crossed.data.primaryData.bidPrice='$11';
 assert.equal(parseQuote('SENS',crossed,0).bid,null);
 assert.equal(nasdaqMinute('Jan 5, 2026 9:31 AM ET'),'2026-01-05T14:31:00.000Z');
 assert.equal(nasdaqMinute('garbage'),null);
});

test('consolidated: refreshes in the background and backs off after a block',async()=>{
 let calls=0,clock=Date.parse('2026-09-25T18:40:30Z');
 const fetcher=async url=>{calls++;return url.includes('BLOCK')?{status:403,ok:false}:{status:200,ok:true,json:async()=>QUOTE};};
 const c=createConsolidated({fetcher,now:()=>clock});
 assert.equal(c.peek(['SENS']).size,0);             // first call only queues
 await new Promise(r=>setTimeout(r,10));
 assert.equal(c.peek(['SENS']).get('SENS').price,10.185);
 c.peek(['BLOCK']);await new Promise(r=>setTimeout(r,10));
 assert.equal(c.status().status,'BACKING_OFF');
 const before=calls;clock+=60000;c.peek(['SENS','NEW']);await new Promise(r=>setTimeout(r,10));
 assert.equal(calls,before);                         // nothing fetched while backing off
});

test('decorate copies rows with halt and overlay and leaves the cached scan untouched',async()=>{
 const scan={gainers:[],rows:[{symbol:'AAA',score:9},{symbol:'SENS',score:5}]};
 const halts={get:async()=>({halts:new Map([['AAA',{reason_code:'LUDP'}]]),status:'OK'}),status:()=>({status:'OK'})};
 const consolidated={peek:()=>new Map([['SENS',{price:10}]]),status:()=>({status:'OK'})};
 const out=await decorate(scan,{halts,consolidated,symbols:overlaySymbols(scan.rows)});
 assert.equal(out.rows[0].halt.reason_code,'LUDP');assert.equal(out.rows[1].consolidated.price,10);
 assert.equal(scan.rows[0].halt,undefined);
 assert.deepEqual(overlaySymbols([{symbol:'X',extended:true,score:99},{symbol:'Y',score:1}]),['Y']);
});

test('the handler serves complements only when the long-lived server provides them',async()=>{
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(b){this.body=b;}};
 await createHandler({service:{health:()=>({status:'OK'})}})({headers:{},method:'GET',url:'/api/health'},res);
 assert.equal(JSON.parse(res.body).complements,null);
});

import {createSipCloses,applyClose} from '../src/closes.mjs';
test('SIP closes: prior-session close replaces the scanner close and day change follows the live price',async()=>{
 const clock=Date.parse('2026-09-25T15:00:00Z');
 const fetcher=async url=>{assert.match(url,/feed=sip/);return {ok:true,json:async()=>({bars:{AAA:[{t:'2026-09-23T04:00:00Z',c:1.8},{t:'2026-09-24T04:00:00Z',c:2},{t:'2026-09-25T04:00:00Z',c:9}]}})};};
 const closes=createSipCloses({env:{ALPACA_API_KEY_ID:'k',ALPACA_API_SECRET_KEY:'s'},fetcher,now:()=>clock});
 assert.equal(closes.peek(['AAA']).size,0);await closes.settle();
 const c=closes.peek(['AAA']).get('AAA');
 assert.deepEqual(c,{close:2,session:'2026-09-24'}); // today's partial bar is ignored
 const row=applyClose({symbol:'AAA',price:2.5,previous_close:2.2,day_change:13.6},c);
 assert.equal(row.previous_close,2);assert.equal(row.day_change,25);assert.equal(row.change_basis,'SIP_PREVIOUS_CLOSE');
 assert.equal(applyClose({price:1},undefined).price,1);
});
test('SIP closes: missing credentials or provider failure leave the scanner close untouched',async()=>{
 const none=createSipCloses({env:{},fetcher:async()=>{throw Error('unused');}});
 assert.equal(none.peek(['AAA']).size,0);assert.equal(none.status().status,'NOT_CONFIGURED');
 const failing=createSipCloses({env:{ALPACA_API_KEY_ID:'k',ALPACA_API_SECRET_KEY:'s'},fetcher:async()=>({ok:false,status:403})});
 failing.peek(['AAA']);await failing.settle();assert.equal(failing.status().status,'UNAVAILABLE');
});
