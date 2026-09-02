export const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,n));
const pct=(v,d=0)=>Number.isFinite(+v)?+v:d;
const norm=(v,max)=>clamp((pct(v)/max)*100);

export function scoreSymbol(s){
  const quality=clamp(pct(s.dataQuality,0.75)*100);
  const catalyst=clamp(pct(s.catalystStrength)*100);
  const liquidity=clamp(norm(s.rvol,10)*0.45+norm(s.volumeAcceleration,12)*0.55);
  const momentum=clamp(norm(Math.max(0,s.priceAcceleration||0),10)*0.45+clamp(pct(s.breakoutQuality)*100)*0.35+clamp((pct(s.vwapPosition)+1)*50)*0.2);
  const structure=clamp(100-(norm(s.floatM,40)*0.45+norm(s.spreadPct,8)*0.25+pct(s.dilutionRisk)*100*0.3));
  const risk=clamp(pct(s.dilutionRisk)*45+pct(s.haltRisk)*25+norm(s.spreadPct,10)*30);
  const freshnessMin=pct(s.catalystFreshnessMin,999);
  const freshness=freshnessMin<=30?100:freshnessMin<=90?80:freshnessMin<=240?55:freshnessMin<=720?30:10;
  const raw=catalyst*.22+liquidity*.23+momentum*.22+structure*.14+freshness*.09+quality*.10;
  const extensionPenalty=Math.max(0,(pct(s.changePct)-55)*0.25)+Math.max(0,(pct(s.rvol)-18)*0.35);
  const riskPenalty=risk*.12;
  const qualityPenalty=(100-quality)*.18;
  const score=clamp(raw-extensionPenalty-riskPenalty-qualityPenalty);
  const actionability=clamp(score-(Math.max(0,pct(s.changePct)-30)*.5)-risk*.18+(freshness>=80?6:0));
  return {score:Math.round(score),actionability:Math.round(actionability),components:{catalyst:Math.round(catalyst),liquidity:Math.round(liquidity),momentum:Math.round(momentum),structure:Math.round(structure),freshness:Math.round(freshness),quality:Math.round(quality),risk:Math.round(risk)}};
}

export function deriveStage(s, scored){
  const ch=pct(s.changePct), va=pct(s.volumeAcceleration), bq=pct(s.breakoutQuality), vw=pct(s.vwapPosition);
  if(s.invalidated||((ch<0)&&(vw<0)&&(va<1))) return 'FAILED';
  if(ch>=65||scored.actionability<45&&scored.score>=65) return 'EXTENDED';
  if(scored.score>=75&&bq>=.6&&vw>=0&&va>=2.5) return 'CONFIRMED';
  if(scored.score>=58&&va>=1.5) return 'EMERGING';
  return 'RADAR';
}

export function summarize(s,scored,stage){
  const c=scored.components;
  const wins=[];
  if(c.catalyst>=70) wins.push('محفز قوي');
  if(c.liquidity>=70) wins.push('تسارع سيولة');
  if(c.momentum>=65) wins.push('تأكيد سعري');
  if(c.structure>=70) wins.push('بنية سهم مناسبة');
  if(c.risk>=55) wins.push('مخاطر مرتفعة');
  if(stage==='EXTENDED') wins.unshift('الحركة متقدمة');
  return wins.slice(0,3).join(' • ')||'إشارة أولية تحتاج تأكيد';
}

export function enrich(symbols=[]){
  return symbols.map(s=>{const scored=scoreSymbol(s);const stage=deriveStage(s,scored);return {...s,...scored,stage,summary:summarize(s,scored,stage)}}).sort((a,b)=>b.actionability-a.actionability);
}
