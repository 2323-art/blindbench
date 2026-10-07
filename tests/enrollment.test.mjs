import test from 'node:test';
import assert from 'node:assert/strict';
import {enrollment,benchmarkAgents} from '../lib/enrollment.mjs';
import {quote} from '../lib/catalog.mjs';
test('One-run enrollment reveals ranking only after simulated payment and evaluation',()=>{
  const data={id:'demo',start:1000};
  const running=enrollment(data,4000);assert.equal(running.status,'running');assert.equal(running.result,undefined);
  const done=enrollment(data,7400);assert.equal(done.status,'complete');assert.equal(done.total,1500000);assert.equal(done.events.length,8);assert.ok(done.events.every(e=>e.simulated));assert.ok(done.result);assert.equal(done.receipt,undefined);
  assert.deepEqual(benchmarkAgents().map(a=>a.id),['cedar','atlas','finch']);
  assert.deepEqual(benchmarkAgents(true).map(a=>[a.id,a.rank]),[['birch',1],['cedar',2],['atlas',3],['finch',4]]);
  assert.throws(()=>quote({taskId:'launch',budget:'1.7',agentId:'birch'},false));
  assert.equal(quote({taskId:'launch',budget:'1.7',agentId:'birch'},false,true).total,1700000);
});
