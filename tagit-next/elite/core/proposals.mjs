// Preregistered research definition. Never an order or a calibrated prediction.
export const PROPOSAL_RULES=Object.freeze({version:'reclaim-paper-1',ttlMs:120000,latencyMs:1000,maxQuoteAgeMs:10000,maxBarAgeMs:90000,maxSpreadPct:0.8,maxExtensionPct:1,entryATR:0.5,stopATR:0.25,minRiskPct:0.5,maxRiskPct:6,maxAttempts:2});
export function entryProposal(o,events,quote,at=Date.now()){
 const r=PROPOSAL_RULES,blocks=[];const confirmations=events.filter(e=>e.kind==='STATE'&&e.to==='RECOVERY_CONFIRMED'&&Date.parse(e.at)<=at),e=confirmations.at(-1);
 const base={version:r.version,mode:'SIMULATION',validated:false,orderEnabled:false,status:'WAITING',reasons:[],family:o.wave>1?'RENEWAL':'RECLAIM',referenceLevel:o.recoveryLevel??null};
 if(!e)return {...base,reasons:['RECOVERY_NOT_CONFIRMED',...(o.blocking||[])]};
 const decision=Date.parse(e.at),atr=e.features?.atr,level=e.level,low=e.features?.priorLow;
 if(![atr,level,low].every(x=>Number.isFinite(x)&&x>0))return {...base,status:'BLOCKED',reasons:['PLAN_INPUTS_MISSING']};
 const upper=level+Math.min(atr*r.entryATR,level*r.maxExtensionPct/100),stop=low-atr*r.stopATR,expiry=decision+r.ttlMs;
 blocks.push(...(o.blocking||[]).filter(x=>!['FRESH_EXECUTION_QUOTE_MISSING','WIDE_SPREAD'].includes(x)));
 if(!o.eligibility||o.eligibility.status!=='ELIGIBLE')blocks.push(...(o.eligibility?.reasons||['POINT_IN_TIME_METADATA_MISSING']));
 if(o.eligibility?.record&&at-Date.parse(o.eligibility.record.valid_from)>86400000)blocks.push('STALE_METADATA');
 if(at>=expiry)blocks.push('PROPOSAL_EXPIRED');if(at<decision+r.latencyMs)blocks.push('DECISION_LATENCY');
 if(confirmations.length>r.maxAttempts)blocks.push('MAX_ATTEMPTS');
 if(!['ACTIVE','RECOVERY_CONFIRMED'].includes(o.state))blocks.push('RECOVERY_NOT_CONFIRMED');
 if(!o.quality?.entryAllowed||at-(Date.parse(o.price_at)+60000)>r.maxBarAgeMs)blocks.push('DATA_QUALITY');
 const qa=at-Date.parse(quote?.at),received=Date.parse(quote?.received_at);
 const validQuote=quote&&quote.bid>0&&quote.ask>=quote.bid&&qa>=0&&qa<=r.maxQuoteAgeMs&&received<=at&&Date.parse(quote.at)>=decision+r.latencyMs;
 if(!validQuote)blocks.push('FRESH_EXECUTION_QUOTE_MISSING');
 const ask=validQuote?quote.ask:null,risk=ask?100*(ask-stop)/ask:null;
 if(validQuote){if(100*(quote.ask-quote.bid)/quote.bid>r.maxSpreadPct)blocks.push('WIDE_SPREAD');if(ask<level||ask>upper)blocks.push('OUTSIDE_ENTRY_ZONE');if(!(stop>0&&stop<ask)||risk<r.minRiskPct||risk>r.maxRiskPct)blocks.push('RISK_OUT_OF_RANGE');}
 if(o.feed==='delayed_sip')blocks.push('DELAYED_FEED');
 return {...base,status:blocks.includes('PROPOSAL_EXPIRED')?'EXPIRED':blocks.length?'BLOCKED':'PROPOSED',reasons:[...new Set(blocks)],decidedAt:e.at,expiresAt:new Date(expiry).toISOString(),entryZone:{min:level,max:upper},scenarioStop:stop,quotePrice:ask,quoteAt:validQuote?quote.at:null,riskPct:risk,attempt:confirmations.length,exitPolicy:'Stop breach, movement failure, 30 minutes holding or session close; next executable quote plus costs. No automatic execution.'};
}
