import test from 'node:test';
import assert from 'node:assert/strict';
import {challengeDetails,comparison} from '../lib/comparison.mjs';
test('Each challenger uses its own price and winner; invalid and self challenges fail',()=>{
  for(const [id,total,winner] of [['birch',4700000,'birch'],['cedar',5200000,'cedar'],['finch',4200000,'atlas']]){
    const details=challengeDetails(id);assert.equal(details.total,total);assert.equal(details.winnerId,winner);
    const done=comparison({id:'test',start:0,challengerId:id},4400);assert.equal(done.status,'complete');assert.equal(done.challengerId,id);assert.equal(done.winnerId,winner);assert.equal(done.events.length,8);
  }
  assert.throws(()=>challengeDetails('atlas'));assert.throws(()=>challengeDetails('unknown'));
});
