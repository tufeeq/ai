// Reuses the frozen production bar detector. Does not claim live shortlist fidelity.
import {analyzeBars,RULES} from '../quote-service/src/scanner.mjs';
export function replayDiscovery(events,{start,end,interval=30000}){
 const first=Date.parse(start),last=Date.parse(end);
 if(!Number.isFinite(first)||!Number.isFinite(last)||last<first||interval!==30000)throw Error('30-second bounded clock required');
 const sequences=new Set();
 const input=events.map(e=>{
  const available=Date.parse(e.available_at),stamp=Date.parse(e.bar.t);
  if(!Number.isFinite(available)||!Number.isFinite(stamp)||available<stamp+60000||!Number.isInteger(e.sequence)||sequences.has(e.sequence))throw Error('Invalid completed-bar availability or sequence');
  sequences.add(e.sequence);return {...e,available};
 }).sort((a,b)=>a.available-b.available||a.sequence-b.sequence);
 const histories=new Map(),cooldowns=new Map(),signals=[];let cursor=0,scans=0;
 for(let tick=first;tick<=last;tick+=interval){
  while(cursor<input.length&&input[cursor].available<=tick){
   const e=input[cursor++];if(!histories.has(e.symbol))histories.set(e.symbol,new Map());
   histories.get(e.symbol).set(e.bar.t,e.bar);
  }
  scans++;
  for(const [symbol,byTime]of histories){
   const bars=[...byTime.values()].filter(b=>Date.parse(b.t)>=tick-90*60000&&Date.parse(b.t)+60000<=tick).sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));
   const signal=analyzeBars(bars,tick);
   if(!signal?.expansion||tick-(cooldowns.get(symbol)??-Infinity)<RULES.cooldown)continue;
   cooldowns.set(symbol,tick);signals.push({symbol,at:new Date(tick).toISOString(),signal});
  }
 }
 return {scans,signals,scope:'BAR_DETECTOR_ONLY',live_shortlist_reproduced:false};
}
