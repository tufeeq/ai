(function(){
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(+v)?+v:0));
const num=v=>Number.isFinite(+v)?+v:0;
const sig=x=>1/(1+Math.exp(-x));
function normEvidence(x){
 const price=Math.max(.0001,num(x.price)), vol=num(x.volume), avg=num(x.avgVolume), flt=num(x.float), spread=Math.max(0,num(x.spreadPct));
 const rvol=avg>0?vol/avg:0, turnover=flt>0?vol/flt:0, dollarVol=price*vol;
 const fresh=num(x.catalystAgeHours)<=6?1:num(x.catalystAgeHours)<=24?.85:num(x.catalystAgeHours)<=72?.55:num(x.catalystAgeHours)<=168?.25:0;
 const ofi=Number.isFinite(+x.orderFlowImbalance)?clamp((num(x.orderFlowImbalance)+1)/2):null;
 const depth=Number.isFinite(+x.bookDepthImbalance)?clamp((num(x.bookDepthImbalance)+1)/2):null;
 const micro=ofi!==null||depth!==null?((ofi??.5)*.6+(depth??.5)*.4):null;
 const volAccel=clamp(Math.log2(1+rvol)/5), floatVelocity=clamp(turnover/3), spreadQ=clamp(1-spread/5), liquidity=clamp((Math.log10(1+dollarVol)-5)/3);
 const persistence=Number.isFinite(+x.persistenceSlope)?clamp((num(x.persistenceSlope)+1)/2):clamp(.5+num(x.ahChange)/100);
 const retention=Number.isFinite(+x.gainRetention)?clamp(num(x.gainRetention)):clamp(.75-Math.max(0,-num(x.ahChange))/50);
 const sector=Number.isFinite(+x.sympathyScore)?clamp(num(x.sympathyScore)/100):.5;
 const dilution=clamp(num(x.dilutionRisk)/100), halt=clamp(num(x.haltHazard)/100), exhaustion=clamp(num(x.exhaustionMemory||x.formerRunnerMemory)/100);
 const executionRisk=clamp((spread/5)*.45+(dollarVol<5e5?.35:dollarVol<2e6?.18:0)+(flt>0&&flt<1e6?.15:0));
 const data=[price>0,vol>0,avg>0,flt>0,Number.isFinite(+x.catalystAgeHours),micro!==null,Number.isFinite(+x.dilutionRisk),Number.isFinite(+x.haltHazard)];
 const quality=data.filter(Boolean).length/data.length;
 return {price,vol,avg,flt,spread,rvol,turnover,dollarVol,fresh,ofi,depth,micro,volAccel,floatVelocity,spreadQ,liquidity,persistence,retention,sector,dilution,halt,exhaustion,executionRisk,quality};
}
function stateMachine(x,e){
 const ch=num(x.changePct), ah=num(x.ahChange), m=e.micro??.5;
 const pressure=e.volAccel*.24+e.floatVelocity*.16+m*.22+e.persistence*.15+e.fresh*.13+e.sector*.10;
 if(e.exhaustion>.72||ch>95||(ah<-20&&ch>40))return 'FAILURE_RISK';
 if(ch>45||e.halt>.65)return 'EXPANSION';
 if(ch>12&&pressure>.55)return 'IGNITION';
 if(pressure>.62&&ch<15)return 'PRESSURE';
 if(e.volAccel>.38&&e.floatVelocity>.18&&Math.abs(ch)<12)return 'ACCUMULATION';
 return 'DORMANT';
}
function paths(x,e,state){
 const m=e.micro??.5;
 const positive=e.volAccel*.18+e.floatVelocity*.12+m*.19+e.persistence*.15+e.retention*.10+e.fresh*.10+e.sector*.08+e.spreadQ*.08;
 const negative=e.dilution*.22+e.halt*.17+e.executionRisk*.18+e.exhaustion*.20+(1-e.quality)*.23;
 const stateBoost={DORMANT:-.35,ACCUMULATION:-.05,PRESSURE:.28,IGNITION:.42,EXPANSION:.05,FAILURE_RISK:-.65}[state]||0;
 const base=positive-negative+stateBoost;
 const p10=sig((base-.22)*4.2), p20=sig((base-.43)*4.4), p40=sig((base-.72)*4.8);
 const fail=sig((negative-positive*.55+(state==='FAILURE_RISK'?.45:0))*4.1);
 const haltP=clamp(e.halt*.65+Math.max(0,num(x.changePct)-35)/140);
 return {pUp10:p10,pUp20:p20,pUp40:p40,pFail:fail,pHalt:haltP};
}
function targetSet(x,e,p){
 const v=Math.max(.5,(e.volAccel*.9+(e.micro??.5)*.8+e.persistence*.65+e.retention*.55-e.executionRisk*.6-e.exhaustion*.55));
 const ups=[8+18*p.pUp10,15+35*p.pUp20,25+75*p.pUp40];
 const probs=[p.pUp10,p.pUp20,p.pUp40];
 return ups.map((u,i)=>({name:`T${i+1}`,price:e.price*(1+u/100),upsidePct:u,probability:probs[i],etaHours:u/(v*8)}));
}
function analyze(x){
 const e=normEvidence(x), state=stateMachine(x,e), probabilities=paths(x,e,state), targets=targetSet(x,e,probabilities);
 const tradeability=clamp(1-(e.executionRisk*.45+e.dilution*.22+e.halt*.18+e.exhaustion*.15));
 const evidenceStrength=clamp(e.volAccel*.18+e.floatVelocity*.12+(e.micro??.5)*.18+e.persistence*.13+e.fresh*.12+e.sector*.08+e.spreadQ*.08+e.liquidity*.05+e.quality*.06);
 let decision='WATCH';
 if(e.quality<.5)decision='ABSTAIN_DATA';
 else if(state==='FAILURE_RISK'||probabilities.pFail>.58)decision='AVOID';
 else if(['PRESSURE','IGNITION'].includes(state)&&probabilities.pUp10>.62&&tradeability>.55)decision='NOW';
 else if(['ACCUMULATION','PRESSURE'].includes(state)&&probabilities.pUp10>.50)decision='FORMING';
 const invalidation=e.price*(1-Math.min(.14,.045+e.executionRisk*.05+e.exhaustion*.03));
 return {...x,evidence:e,state,probabilities,targets,tradeability,evidenceStrength,decision,invalidation};
}
const api={analyze};
if(typeof window!=='undefined')window.TAG10=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();