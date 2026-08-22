(() => {
  const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:a));
  const n=v=>{const x=parseFloat(String(v??'').replace(/[%,$]/g,'').replace(/,/g,''));return Number.isFinite(x)?x:null};
  function score(row, ext={}){
    const rel=n(row['Rel Volume']??row.relativeVolume)??0;
    const change=n(row.Change??row.changePct)??0;
    const vol=n(row.Volume??row.volume)??0;
    const flt=n(row.Float??row.floatShares);
    const floatShares=flt==null?null:(flt<1000?flt*1e6:flt);
    const turnover=floatShares&&vol?vol/floatShares:null;
    const insider=clamp(n(ext.insiderScore)??0);
    const institutional=clamp(n(ext.institutionalScore)??0);
    const flow=clamp(n(ext.flowScore)??Math.min(100, rel*12 + Math.max(0,change)*1.5 + (turnover?turnover*35:0)));
    const catalyst=clamp(n(ext.catalystScore)??0);
    const quality=clamp(n(ext.dataConfidence)??50);
    const smart=clamp(flow*.40 + institutional*.22 + insider*.13 + catalyst*.10 + quality*.15);
    const ignition=clamp(smart*.55 + Math.min(100,rel*18)*.20 + Math.min(100,Math.max(0,change)*3)*.15 + (turnover?Math.min(100,turnover*60):0)*.10);
    let state='WATCH'; if(ignition>=75)state='HIGH_CONVICTION'; else if(ignition>=60)state='BUILDING'; else if(ignition<35)state='WEAK';
    return {smartMoneyScore:+smart.toFixed(1),ignitionProbability:+ignition.toFixed(1),state,components:{flow:+flow.toFixed(1),institutional:+institutional.toFixed(1),insider:+insider.toFixed(1),catalyst:+catalyst.toFixed(1),dataConfidence:+quality.toFixed(1)},turnover:turnover==null?null:+turnover.toFixed(4)};
  }
  window.TAGXSmartMoney={score};
})();
