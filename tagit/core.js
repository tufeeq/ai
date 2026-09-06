export const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,n));
const missing=v=>v===null||v===undefined||v==='';
const n=(v,d=0)=>missing(v)?d:(Number.isFinite(+v)?+v:d);
const maybe=v=>missing(v)?null:(Number.isFinite(+v)?+v:null);
const norm=(v,max)=>clamp((n(v)/max)*100);
const weighted=(parts=[])=>{const ok=parts.filter(([v])=>v!==null&&v!==undefined&&Number.isFinite(+v));if(!ok.length)return 0;const w=ok.reduce((a,x)=>a+x[1],0)||1;return ok.reduce((a,x)=>a+(+x[0])*x[1],0)/w;};

export function marketRegime(m={}){
  const spy=maybe(m.spyChangePct),qqq=maybe(m.qqqChangePct),iwm=maybe(m.iwmChangePct),vix=maybe(m.vixChangePct),breadth=maybe(m.breadthPct);
  const parts=[];
  if(spy!==null)parts.push([spy*7,7]);if(qqq!==null)parts.push([qqq*5,5]);if(iwm!==null)parts.push([iwm*8,8]);if(vix!==null)parts.push([-vix*1.8,1.8]);if(breadth!==null)parts.push([(breadth-50)*.35,.35]);
  const shift=parts.length?parts.reduce((a,[v])=>a+v,0):0,score=clamp(50+shift),label=score>=67?'RISK_ON':score<=35?'RISK_OFF':'NEUTRAL';
  return{score:Math.round(score),label,penalty:label==='RISK_OFF'?10:label==='NEUTRAL'?3:0,coverage:parts.length};
}

export function features(s){
  const floatM=maybe(s.floatM),volume=n(s.volume),explicitRotation=maybe(s.floatRotation),floatRotation=explicitRotation!==null?explicitRotation:(floatM&&floatM>0?volume/(floatM*1e6):null);
  const momentum=s.momentumPct||{};
  const m1=maybe(momentum['1']??s.m1),m2=maybe(momentum['2']??s.m2),m3=maybe(momentum['3']??s.m3),m5=maybe(momentum['5']??s.m5),m10=maybe(momentum['10']??s.m10),m15=maybe(momentum['15']??s.m15),m30=maybe(momentum['30']??s.m30),m60=maybe(momentum['60']??s.m60);
  const momentumConsistency=maybe(s.momentumConsistency),shortRate=maybe(s.shortMomentumRatePctPerMin),priceAcceleration=maybe(s.priceAcceleration??s.priceAccelerationPctPerMin),rvol=maybe(s.rvol),spread=maybe(s.spreadPct),breakout=maybe(s.breakoutQuality),catalyst=maybe(s.catalystStrength),catalystAge=maybe(s.catalystFreshnessMin),dilution=maybe(s.dilutionRisk),halt=maybe(s.haltRisk),change=n(s.changePct),vwap=maybe(s.vwapPosition),distance=maybe(s.distanceToBreakoutPct),dollarVolume=maybe(s.dollarVolume),avgDollarVolume=maybe(s.averageDollarVolume),trades=maybe(s.trades),atrPct=maybe(s.atrPct),gapPct=maybe(s.gapPct),shortFloatPct=maybe(s.shortFloatPct),sma20Pct=maybe(s.sma20Pct),sma50Pct=maybe(s.sma50Pct),perfWeekPct=maybe(s.perfWeekPct),lateExtensionRiskRaw=maybe(s.lateExtensionRiskRaw),persistenceSlope=maybe(s.persistenceSlope),persistencePoints=maybe(s.persistencePoints),price=maybe(s.price),recentDilutionFiling=Boolean(s.recentDilutionFiling);
  const critical=[rvol,m1,m5,m10,dollarVolume];
  const coverage=critical.filter(v=>v!==null).length/critical.length;
  let quality=maybe(s.dataQuality)??.55;quality=Math.min(quality,.42+coverage*.58);if(floatM===null)quality-=.03;if(spread===null)quality-=.03;if(catalyst===null)quality-=.02;quality=clamp(quality,0,1);
  return{floatM,volume,floatRotation,m1,m2,m3,m5,m10,m15,m30,m60,momentumConsistency,shortRate,priceAcceleration,rvol,spread,breakout,catalyst,catalystAge,quality,dilution,halt,change,vwap,distance,dollarVolume,avgDollarVolume,trades,atrPct,gapPct,shortFloatPct,sma20Pct,sma50Pct,perfWeekPct,lateExtensionRiskRaw,persistenceSlope,persistencePoints,price,recentDilutionFiling,coverage};
}

export function tradabilityQualification(s,f=features(s)){
  let score=100;const reasons=[];let hardReject=false;
  if(f.price!==null&&f.price<.10){score-=65;reasons.push('سعر أقل من 0.10$');hardReject=true;}
  else if(f.price!==null&&f.price<.25){score-=18;reasons.push('سعر شديد الانخفاض');}
  if(f.dollarVolume!==null&&f.dollarVolume<250000){score-=35;reasons.push('Dollar volume ضعيف');}
  else if(f.dollarVolume!==null&&f.dollarVolume<750000){score-=15;reasons.push('Dollar volume محدود');}
  if(f.trades!==null&&f.trades<500){score-=18;reasons.push('عدد الصفقات محدود');}
  if(f.spread!==null&&f.spread>5){score-=35;reasons.push('سبريد مرتفع');}
  else if(f.spread!==null&&f.spread>3){score-=15;reasons.push('سبريد يحتاج حذر');}
  if(f.atrPct!==null&&f.atrPct>25){score-=12;reasons.push('تذبذب يومي شديد');}
  return{score:Math.round(clamp(score)),hardReject,reasons};
}

export function derivePhase(s,f=features(s)){
  const shortPositive=(f.m1??0)>0&&(f.m5??0)>0;
  const persist=(f.momentumConsistency??0)>=.6||((f.persistencePoints??0)>=2&&(f.persistenceSlope??0)>0);
  if(s.invalidated||((f.m5??0)<-2&&(f.m10??0)<-3))return'FAILED';
  if(f.change>=55||((f.gapPct??0)>=45&&f.change>=35)||(f.floatRotation!==null&&f.floatRotation>=4))return'EXHAUSTION';
  if(f.change>=28&&((f.m30??0)>=8||(f.m60??0)>=12))return'EXPANSION';
  if(shortPositive&&persist&&((f.m5??0)>=1.2||(f.m10??0)>=2.2)&&((f.rvol??0)>=2))return'BREAKOUT';
  if(shortPositive&&((f.m1??0)>=.25||(f.shortRate??0)>=.15)&&((f.rvol??0)>=1.5))return'ACCELERATION';
  if(((f.rvol??0)>=1.5&&((f.m5??0)>0||(f.priceAcceleration??0)>.05))||((f.catalyst??0)>=.65&&(f.catalystAge??9999)<=120))return'IGNITION';
  return'ANOMALY';
}

function freshness(age){if(age===null)return 0;return age<=15?100:age<=45?90:age<=120?72:age<=360?45:15;}

export function continuationQualification(s,scored=null){
  const f=scored?.features||features(s);let support=0,possible=0,contra=0;const reasons=[];
  const add=(avail,w,good,bad,label)=>{if(!avail)return;possible+=w;if(good){support+=w;reasons.push(label);}if(bad)contra+=w;};
  add(f.rvol!==null,14,f.rvol>=1.8,f.rvol<.9,'RVOL مؤكد');
  add(f.m1!==null,12,f.m1>0.15,f.m1<-0.5,'زخم 1m موجب');
  add(f.m5!==null,15,f.m5>0.6,f.m5<-1.5,'زخم 5m موجب');
  add(f.m10!==null,12,f.m10>1.0,f.m10<-2.0,'زخم 10m موجب');
  add(f.momentumConsistency!==null,14,f.momentumConsistency>=.6,f.momentumConsistency<.4,'اتساق متعدد النوافذ');
  add(f.shortRate!==null,8,f.shortRate>.08,f.shortRate<-.08,'معدل حركة قصير موجب');
  add(f.floatRotation!==null,7,f.floatRotation>=.25,f.floatRotation>3.5,'دوران Float مفيد');
  add(f.dollarVolume!==null,8,f.dollarVolume>=1000000,f.dollarVolume<250000,'سيولة نقدية كافية');
  add(f.catalyst!==null,6,f.catalyst>=.55&&(f.catalystAge??9999)<=240,false,'محفز موثق');
  add(f.persistenceSlope!==null,4,f.persistenceSlope>0,f.persistenceSlope<-1,'استمرار عبر snapshots');
  let score=possible?support/possible*100:0;score-=possible?contra/possible*72:25;
  const extension=(f.lateExtensionRiskRaw??0)+Math.max(0,f.change-24)*.5+Math.max(0,(f.gapPct??0)-20)*.35+Math.max(0,(f.sma20Pct??0)-40)*.18;
  score-=Math.min(30,extension);
  if(f.recentDilutionFiling)score-=14;
  if(f.quality<.65)score-=8;
  const confidence=f.coverage>=.8?'HIGH':f.coverage>=.6?'MEDIUM':'LOW';
  return{score:Math.round(clamp(score)),confidence,supportWeight:support,possibleWeight:possible,contradictionWeight:contra,reasons:reasons.slice(0,5),extensionPenalty:+Math.min(30,extension).toFixed(1)};
}

export function scoreSymbol(s,market={}){
  const f=features(s),regime=marketRegime(market),phase=derivePhase(s,f),tradability=tradabilityQualification(s,f);
  const catalyst=f.catalyst===null?0:clamp(f.catalyst*100);
  const accel=weighted([[f.m1===null?null:norm(Math.max(0,f.m1),2.5),.25],[f.m5===null?null:norm(Math.max(0,f.m5),6),.25],[f.m10===null?null:norm(Math.max(0,f.m10),10),.15],[f.momentumConsistency===null?null:f.momentumConsistency*100,.20],[f.shortRate===null?null:norm(Math.max(0,f.shortRate),.8),.15]]);
  const rotation=f.floatRotation===null?null:norm(Math.min(f.floatRotation,2),1.2),participation=weighted([[f.rvol===null?null:norm(Math.min(f.rvol,25),12),.65],[rotation,.20],[f.dollarVolume===null?null:norm(f.dollarVolume,5000000),.15]]);
  const structure=weighted([[f.breakout===null?null:f.breakout*100,.35],[f.m30===null?null:clamp(50+f.m30*4),.20],[f.sma20Pct===null?null:clamp(70-Math.max(0,f.sma20Pct-30)),.15],[f.gapPct===null?null:clamp(75-Math.max(0,f.gapPct-15)*2),.15],[f.vwap===null?null:clamp((f.vwap+1)*50),.15]]);
  const liquidity=weighted([[tradability.score,.60],[f.dollarVolume===null?null:norm(f.dollarVolume,5000000),.25],[f.trades===null?null:norm(f.trades,20000),.15]]);
  const fresh=freshness(f.catalystAge),quality=clamp(f.quality*100);
  const risk=clamp((f.dilution??.30)*34+(f.halt??.08)*16+(100-tradability.score)*.28+(f.recentDilutionFiling?18:0)+Math.min(22,(f.lateExtensionRiskRaw??0))+(f.shortFloatPct!==null&&f.shortFloatPct>35?5:0));
  const bonus={ANOMALY:0,IGNITION:5,ACCELERATION:9,BREAKOUT:8,EXPANSION:-8,EXHAUSTION:-22,FAILED:-35}[phase]||0;
  const raw=catalyst*.08+accel*.29+participation*.20+structure*.17+liquidity*.14+fresh*.03+quality*.09;
  const baseScore=clamp(raw+bonus-risk*.16-regime.penalty);
  const prelim={score:Math.round(baseScore),phase,regime,tradability,components:{catalyst:Math.round(catalyst),acceleration:Math.round(accel),participation:Math.round(participation),structure:Math.round(structure),liquidity:Math.round(liquidity),freshness:Math.round(fresh),quality:Math.round(quality),risk:Math.round(risk)},features:f};
  const continuation=continuationQualification(s,prelim);
  const actionability=clamp(baseScore*.50+continuation.score*.38+tradability.score*.12-risk*.14-(phase==='EXPANSION'?8:0)-(phase==='EXHAUSTION'?24:0));
  return{...prelim,actionability:Math.round(actionability),continuation};
}

export function analogEstimate(s,x){
  if(s.analogs&&Number.isFinite(+s.analogs.count))return{...s.analogs,source:'HISTORICAL'};
  const a=x.actionability,c=x.continuation.score,r=x.components.risk,t=x.tradability.score,b={IGNITION:2,ACCELERATION:6,BREAKOUT:6,ANOMALY:-8,EXPANSION:-6,EXHAUSTION:-18,FAILED:-30}[x.phase]||0;
  return{count:null,p5_30m:Math.round(clamp(10+a*.24+c*.30+t*.08+b-r*.12,1,78)),p10_1h:Math.round(clamp(4+a*.18+c*.25+t*.05+b-r*.15,1,66)),p20_day:Math.round(clamp(1+a*.10+c*.16+b*.6-r*.15,1,46)),medianMFE:+clamp(1.5+a*.05+c*.05,1,20).toFixed(1),medianMAE:+clamp(2+r*.06+(x.phase==='EXHAUSTION'?5:0),1,18).toFixed(1),source:'MODELLED'};
}

export function riskGate(x){
  const r=x.components.risk,q=x.components.quality,c=x.continuation,t=x.tradability;
  if(x.phase==='FAILED')return{status:'REJECT',reason:'الإشارة فقدت بنيتها'};
  if(t.hardReject||t.score<45)return{status:'REJECT',reason:'قابلية التنفيذ غير كافية'};
  if(q<58||c.confidence==='LOW')return{status:'REJECT',reason:'تغطية/جودة البيانات غير كافية'};
  if(r>=72)return{status:'CAUTION',reason:'مخاطر التنفيذ/التخفيف مرتفعة'};
  if(x.phase==='EXHAUSTION'||x.phase==='EXPANSION')return{status:'CAUTION',reason:'الحركة متقدمة ومخاطر المطاردة مرتفعة'};
  if(c.contradictionWeight>=20)return{status:'OBSERVE',reason:'إشارات تناقض تمنع الدخول المبكر'};
  if(x.actionability>=67&&c.score>=70&&t.score>=65&&['IGNITION','ACCELERATION','BREAKOUT'].includes(x.phase))return{status:'WATCH',reason:'اكتشاف مبكر + استمرار + قابلية تنفيذ'};
  return{status:'OBSERVE',reason:c.score<58?'اكتشاف دون استمرار كافٍ':'تحتاج تأكيدًا إضافيًا'};
}

export function summarize(s,x){const f=x.features,w=[];if(x.continuation.score>=70)w.push(`استمرار ${x.continuation.score}/100`);if((f.momentumConsistency??0)>=.6)w.push('زخم متسق متعدد النوافذ');if(f.floatRotation!==null&&f.floatRotation>=.3)w.push(`Float ${f.floatRotation.toFixed(2)}x`);if((f.dollarVolume??0)>=1000000)w.push('سيولة نقدية جيدة');if((x.components.catalyst??0)>=55)w.push('محفز موثق');if(x.components.risk>=60)w.push('مخاطر مرتفعة');return w.slice(0,3).join(' • ')||'شذوذ يحتاج تأكيد استمرار';}

export function enrich(symbols=[],market={}){return symbols.map(s=>{const x=scoreSymbol(s,market);let gate=riskGate(x);if(s.gateOverride?.status)gate=s.gateOverride;return{...s,...x,analogs:analogEstimate(s,x),gate,summary:summarize(s,x)}}).sort((a,b)=>b.actionability-a.actionability);}
