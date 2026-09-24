import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {comparisonRows} from './phase2-view.mjs';
const evidence=()=>JSON.parse(readFileSync(new URL('./phase2-evidence.json',import.meta.url)));
test('development comparison displays negative means with every missing denominator',()=>{
 const rows=comparisonRows(evidence());assert.equal(rows.length,2);
 assert.equal(rows[0][1],'231 / 79 / 152');assert.equal(rows[0][3],'-1.32٪');
 assert.equal(rows[1][1],'119 / 63 / 56');assert.equal(rows[1][7],'199');
 assert.equal(rows[1][2],'-1.64٪');assert.equal(rows[1][3],'-1.45٪');
});
test('claim, missing denominator, fake significance and arithmetic inconsistencies fail closed',()=>{
 for(const mutate of [e=>e.profitability_claim_allowed=true,e=>e.holdout_opens=1,
  e=>e.comparisons[0].unknown_feature.signals++,e=>e.comparisons[0].selected.conditional_mean_pct=null,
  e=>e.comparisons[0].bootstrap.p_adjusted=.01,e=>e.comparisons[0].effect_percentage_points=10,
  e=>e.comparisons[0].selected.all_signal_expectancy_pct=0,
  e=>e.comparisons[0].bootstrap.effect_ci95_percentage_points=[1,-1]]){
  const e=evidence();mutate(e);assert.throws(()=>comparisonRows(e));
 }
});
