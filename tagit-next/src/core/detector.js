// Byte-exact copy of the discovery-1 detector (RULES and analyzeBars) from
// tagit-next/quote-service/src/scanner.mjs on branch tagit-next-independent-20260914
// at commit f2df039ea0182d28bf0d11fa4700faf7e0304d69. Copied so research runs detect exactly what the live scanner detects.
// SHA-256 of the copied section: 1cf609a06fbdb324dbc2635c4aae98e2001b789b4ec0ce07dab5e1bc843f8a82
export const RULES=Object.freeze({version:'discovery-1',minimumBars:13,volumeRatio:2,return3m:0.7,minDollars3m:25000,minTrades3m:30,maxSingleMinuteShare:0.7,maxSpread:0.8,maxEarlyDayGain:25,maxEarly3mGain:8,cooldown:1800000});
const dateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const sessionDate=t=>Number.isFinite(new Date(t).getTime())?dateFormatter.format(new Date(t)):null;
const positive=x=>Number.isFinite(x)&&x>0;
const pct=(a,b)=>positive(a)&&positive(b)?(a/b-1)*100:null;
export function analyzeBars(input,now){
 const bars=[...new Map(input.filter(b=>Date.parse(b.t)+60000<=now&&positive(b.c)&&positive(b.h)&&positive(b.l)&&b.v>=0).map(b=>[b.t,b])).values()].sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));
 const last=bars.at(-1);if(!last)return null;
 const recent=bars.slice(-3),baseline=bars.slice(-23,-3);
 const contiguous=recent.length===3&&Date.parse(recent[2].t)-Date.parse(recent[0].t)===120000;
 const current=now-Date.parse(last.t)<=150000;
 const average=baseline.reduce((s,b)=>s+b.v,0)/baseline.length;
 const ratio=average>0?recent.reduce((s,b)=>s+b.v,0)/3/average:null;
 const dollars=recent.reduce((s,b)=>s+b.c*b.v,0),move=pct(last.c,recent[0]?.o);
 const priorHigh=Math.max(...bars.slice(-6,-1).map(b=>b.h));
 const stop=Math.min(...bars.slice(-5).map(b=>b.l))*0.999;
 const trigger=priorHigh*1.001;
 const risk=pct(trigger,stop);
 const ready=baseline.length>=10&&contiguous&&current;
 const trades=recent.reduce((s,b)=>s+(b.n??0),0);
 const totalVolume=bars.reduce((s,b)=>s+b.v,0);
 const vwap=totalVolume>0?bars.reduce((s,b)=>s+(b.vw??b.c)*b.v,0)/totalVolume:null;
 const concentration=Math.max(...recent.map(b=>b.v))/recent.reduce((s,b)=>s+b.v,0);
 const quality=trades>=RULES.minTrades3m&&concentration<=RULES.maxSingleMinuteShare&&last.c>=vwap;
 const expansion=ready&&quality&&ratio>=RULES.volumeRatio&&move>=RULES.return3m&&dollars>=RULES.minDollars3m;
 return {bars:bars.length,ready,trades_3m:trades,vwap_window:vwap,volume_concentration:concentration,quality,volume_ratio:ratio,return_3m:move,dollars_3m:dollars,breakout:last.c>priorHigh,expansion,bar_at:last.t,trigger,stop,plan_valid:risk>=0.5&&risk<=6,targets:[trigger+(trigger-stop),trigger+2*(trigger-stop)]};
}
