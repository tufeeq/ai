import {pct,mean} from './data.mjs';
export const FAMILIES=['FIRST_EXECUTABLE','WAIT_RECOVERY','FAILURE_REENTRY'];
export function simulate(opportunity,bars,timeline,session,config,{diagnostic=false}={}) {
 const c=config.execution,bs=bars.filter(b=>Date.parse(b.t)>=Date.parse(opportunity.first_at)).sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));
 const cost=(c.spreadBps/2+c.slippageBps)/10000;
 const decisions=timeline.filter(x=>x.to==='RECOVERY_CONFIRMED');
 const result={scope:diagnostic?'CONDITIONAL_EXECUTION_DIAGNOSTIC':'ELIGIBILITY_GATED',historicalEligibility:opportunity.first_eligibility.status,quoteModel:'ASSUMED_SPREAD_NEXT_BAR_OPEN',families:[]};
 function fill(decision,side){
   const at=Date.parse(decision),candidate=bs.find(b=>Date.parse(b.t)>=at+c.latencyMs);
   if(!candidate||Date.parse(candidate.t)-at>c.ttlMinutes*60000)return {status:'NO_FILL_WITHIN_TTL'};
   const between=bars.filter(b=>Date.parse(b.t)>=at&&Date.parse(b.t)<=Date.parse(candidate.t));
   const n=(Date.parse(candidate.t)-at)/60000+1;
   if(!Number.isInteger(n)||between.length!==n)return {status:'UNKNOWN_GAP_BEFORE_FILL'};
   const previous=bars.find(b=>Date.parse(b.t)===Date.parse(candidate.t)-60000);
   if(!previous||c.quantity>previous.v*c.maxParticipation)return {status:'PRIOR_VOLUME_CAPACITY_BLOCK'};
   return {status:'FILLED_ASSUMED',at:candidate.t,price:candidate.o*(side==='BUY'?1+cost:1-cost),quantity:c.quantity};
 }
 for(const family of FAMILIES){
   if(!diagnostic&&opportunity.first_eligibility.status!=='ELIGIBLE'){result.families.push({family,status:'NOT_EVALUABLE_ELIGIBILITY',trades:[],attempts:0});continue;}
   const trades=[],reasons=[];let attempts=0,after=-Infinity;
   const candidates=family==='FIRST_EXECUTABLE'||family==='FAILURE_REENTRY'?[{at:opportunity.first_at},...(family==='FAILURE_REENTRY'?decisions:[])]:decisions.slice(0,1);
   for(const d of candidates){
     if(attempts>= (family==='FAILURE_REENTRY'?c.maxAttempts:1)||Date.parse(d.at)<=after)continue;
     if(Date.parse(d.at)>=session.close-c.entryCutoffMinutes*60000){reasons.push('SESSION_CUTOFF');continue;}
     attempts++;const entry=fill(d.at,'BUY');if(entry.status!=='FILLED_ASSUMED'){reasons.push(entry.status);continue;}
     const started=Date.parse(entry.at),failure=timeline.find(x=>x.to==='FAILED'&&Date.parse(x.at)>started);
     const timeExit=Math.min(started+c.holdingMinutes*60000,session.close-2*60000);
     const exitAt=family==='FAILURE_REENTRY'&&failure?Math.min(timeExit,Date.parse(failure.at)):timeExit;
     const exit=fill(new Date(exitAt).toISOString(),'SELL');
     const held=bs.filter(b=>Date.parse(b.t)>=started&&Date.parse(b.t)<Date.parse(exit.at||new Date(exitAt).toISOString()));
     const expected=(Date.parse(exit.at||new Date(exitAt).toISOString())-started)/60000;
     if(exit.status!=='FILLED_ASSUMED'||held.length!==expected||held.some((b,i)=>Date.parse(b.t)!==started+i*60000)){
       trades.push({entry,exit,status:'UNKNOWN_EXECUTION_PATH',returnPct:null});after=Infinity;break;
     }
     const gross=pct(exit.price,entry.price),net=gross-2*c.feeBps/100;
     trades.push({status:'SCORABLE_ASSUMED',entry,exit,decision_at:d.at,exit_decision_at:new Date(exitAt).toISOString(),returnPct:net,
       holdMinutes:(Date.parse(exit.at)-started)/60000,observedMAEPct:held.length?pct(Math.min(...held.map(x=>x.l)),entry.price):null,
       estimatedRoundTripCostBps:c.spreadBps+2*c.slippageBps+2*c.feeBps,intrabarOrder:'NOT_USED_CLOSE_DECISIONS',quantity:c.quantity});
     after=Date.parse(exit.at);
   }
   result.families.push({family,status:trades.length?'DIAGNOSTIC_ONLY':decisions.length?'NO_FILL':'NO_QUALIFYING_DECISION',trades,attempts,reasons});
 }
 return result;
}
export function summarizeSimulation(results) {
 return Object.fromEntries(FAMILIES.map(f=>{const rows=results.flatMap(r=>r.families.filter(x=>x.family===f));const trades=rows.flatMap(x=>x.trades),known=trades.filter(x=>x.returnPct!==null);const returns=known.map(x=>x.returnPct).sort((a,b)=>a-b);
   return [f,{opportunities:rows.length,attempts:rows.reduce((a,r)=>a+r.attempts,0),scorableTrades:known.length,unknownTrades:trades.length-known.length,
     skippedOpportunities:rows.filter(r=>!r.trades.length).length,meanNetPct:mean(returns),medianNetPct:returns.length?(returns[Math.floor((returns.length-1)/2)]+returns[Math.floor(returns.length/2)])/2:null,
     meanWithoutBest:returns.length>1?mean(returns.slice(0,-1)):null,meanWithoutWorst:returns.length>1?mean(returns.slice(1)):null,
     meanMAEPct:mean(known.map(t=>t.observedMAEPct).filter(Number.isFinite)),meanHoldMinutes:mean(known.map(t=>t.holdMinutes)),notPortfolioReturn:true}];}));
}
