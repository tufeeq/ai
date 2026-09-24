import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {analyzeBars,RULES} from '../src/scanner.mjs';
const dir=new URL('../../data/study/',import.meta.url),signals=[];let barsCount=0,largeSessions=0,earlyDetected=0;
for(const name of readdirSync(dir).filter(n=>/^2026.*json.gz$/.test(n)).sort()){
 const raw=JSON.parse(gunzipSync(readFileSync(new URL(name,dir))));
 for(const [symbol,input]of Object.entries(raw.bars??{})){
  const bars=input.map(b=>({t:b.timestamp,o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume,n:b.trade_count,vw:b.vwap})).filter(b=>{const t=new Date(b.t),m=t.getUTCHours()*60+t.getUTCMinutes();return m>=810&&m<1200;}).sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));
  barsCount+=bars.length;let last=-Infinity;const sessionSignals=[];
  for(let i=0;i<bars.length;i++){
   const now=Date.parse(bars[i].t)+60000;const s=analyzeBars(bars.slice(Math.max(0,i-89),i+1),now);
   if(!s?.expansion||now-last<RULES.cooldown)continue;last=now;
   const future=bars.slice(i+1).filter(b=>Date.parse(b.t)<now+1800000);
   const continuous=future.length===30&&future.every((b,j)=>Date.parse(b.t)===now+j*60000);
   const entry=future[0]&&Date.parse(future[0].t)===now?future[0].o:null;
   const result={date:name.slice(0,10),symbol,detected_at:new Date(now).toISOString(),signal_price:bars[i].c,entry,scorable:continuous&&entry>0};
   if(result.scorable){result.max_up_pct=(Math.max(...future.map(b=>b.h))/entry-1)*100;result.max_down_pct=(Math.min(...future.map(b=>b.l))/entry-1)*100;result.end_return_after_assumed_cost_pct=(future.at(-1).c/entry-1)*100-0.5;}
   signals.push(result);sessionSignals.push(result);
  }
  if(bars.length&&Math.max(...bars.map(b=>b.h))/bars[0].o>=1.2){largeSessions++;const reached=bars.find(b=>b.h>=bars[0].o*1.2);if(sessionSignals.some(s=>Date.parse(s.detected_at)<Date.parse(reached.t)&&s.signal_price<bars[0].o*1.1))earlyDetected++;}
 }
}
const scored=signals.filter(s=>s.scorable),mean=key=>scored.length?scored.reduce((a,s)=>a+s[key],0)/scored.length:null;
const report={rules:RULES,scope:'96 previously selected symbols over 10 known sessions; SIP bars, not live IEX. Development audit, not untouched holdout or profit validation.',limitations:['Current metadata introduces survivorship bias','No historical spreads, quotes or news used','Does not reproduce live shortlist','Missing future minutes excluded and counted','Max-up is an excursion, not an executable profit','0.5 percentage point round-trip assumed cost, not measured slippage'],bars:barsCount,signals:signals.length,scorable:scored.length,unscorable:signals.length-scored.length,reached_5pct:scored.filter(s=>s.max_up_pct>=5).length,reached_10pct:scored.filter(s=>s.max_up_pct>=10).length,reached_20pct:scored.filter(s=>s.max_up_pct>=20).length,mean_30m_return_after_assumed_cost_pct:mean('end_return_after_assumed_cost_pct'),mean_max_drawdown_pct:mean('max_down_pct'),sessions_with_20pct_excursion:largeSessions,detected_below_10pct_before_20pct:earlyDetected,events:signals};
// A separate output allows audits to reproduce the baseline without overwriting evidence.
const outputIndex=process.argv.indexOf('--output');
if(outputIndex>=0&&!process.argv[outputIndex+1])throw Error('--output requires a path');
writeFileSync(outputIndex>=0?process.argv[outputIndex+1]:new URL('../../data/discovery-audit.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,events:undefined},null,2));
