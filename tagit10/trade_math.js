(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TradeMath=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function plan(p){
  const {cash,equity,entry,stop,target,riskPct,fee,slippagePct,fractional}=p;
  if(![cash,equity,entry,stop,target,riskPct,fee,slippagePct].every(Number.isFinite)||cash<0||equity<=0||entry<=0||stop<=0||target<=entry||stop>=entry||riskPct<=0||riskPct>100||fee<0||slippagePct<0||slippagePct>=100)return {ok:false,error:'Enter a positive entry, stop below entry, target above entry and valid costs.'};
  const slip=slippagePct/100,entryFill=entry*(1+slip),stopFill=stop*(1-slip),targetFill=target*(1-slip),budget=equity*riskPct/100;
  const raw=Math.max(0,Math.min((budget-2*fee)/(entryFill-stopFill),(cash-fee)/entryFill));
  const qty=Math.floor(raw*(fractional?1000:1))/(fractional?1000:1);
  if(qty<=0)return {ok:false,error:'Available cash or risk budget cannot fund this position after costs.'};
  const risk=qty*(entryFill-stopFill)+2*fee,reward=qty*(targetFill-entryFill)-2*fee;
  return {ok:reward>0,error:reward>0?null:'Costs exceed the planned target gain.',qty,entryFill,stopFill,targetFill,cost:qty*entryFill+fee,risk,reward,rr:reward/risk,breakevenWinPct:100*risk/(risk+reward),budget};
 }
 function closedNet(t,exit){return t.qty*(exit*(1-t.slippagePct/100)-t.entryFill)-2*t.fee;}
 return {plan,closedNet};
});
