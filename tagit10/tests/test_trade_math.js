const assert=require('node:assert/strict');const {plan,closedNet}=require('../trade_math');
const p={cash:200,equity:200,entry:10,stop:9.5,target:11,riskPct:1,fee:0,slippagePct:0,fractional:false};
let r=plan(p);assert.equal(r.qty,4);assert.equal(r.risk,2);assert.equal(r.reward,4);assert.equal(r.rr,2);
r=plan({...p,cash:15});assert.equal(r.qty,1);assert.ok(r.cost<=15);
r=plan({...p,fee:1});assert.equal(r.ok,false);
r=plan({...p,slippagePct:.2,fractional:true});assert.ok(r.ok);assert.ok(r.risk<=2);assert.ok(r.cost<=200);
assert.ok(Math.abs(closedNet({...r,fee:0,slippagePct:.2},9.5)+r.risk)<1e-9);
assert.ok(Math.abs(closedNet({...r,fee:0,slippagePct:.2},11)-r.reward)<1e-9);
assert.equal(plan({...p,stop:10}).ok,false);assert.equal(plan({...p,cash:NaN}).ok,false);
for(const cash of [1,20,200])for(const fee of [0,.1,.5])for(const slippagePct of [0,.2,1]){r=plan({...p,cash,fee,slippagePct,fractional:true});if(r.ok){assert.ok(r.cost<=cash+1e-9);assert.ok(r.risk<=2+1e-9);assert.ok(r.qty>0);}}
console.log('Position sizing, fees, slippage, cash limits and exit accounting passed.');
