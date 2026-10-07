import test from 'node:test';
import assert from 'node:assert/strict';
import {challengeDetails,comparison} from '../lib/comparison.mjs';
test('Each challenger uses its own price and winner; invalid and self challenges fail',()=>{
  for(const [id,total,winner] of [['birch',4700000,'birch'],['cedar',5200000,'cedar'],['finch',4200000,'finch']]){
    const details=challengeDetails(id);assert.equal(details.total,total);assert.equal(details.winnerId,winner);
    const done=comparison({id:'test',start:0,challengerId:id},4400);assert.equal(done.status,'complete');assert.equal(done.challengerId,id);assert.equal(done.winnerId,winner);assert.equal(done.events.length,8);
  }
  assert.throws(()=>challengeDetails('atlas'));assert.throws(()=>challengeDetails('unknown'));
});

test('Masumi opponent is retained and every demo challenger wins with scripted scores',()=>{
  const opponent={id:'registry-agent',name:'Registry agent'};
  for(const challengerId of ['birch','cedar','finch']){
    const result=comparison({id:'demo',start:0,challengerId,opponent},4400);
    assert.equal(result.opponentId,opponent.id);
    assert.equal(result.opponent.name,opponent.name);
    assert.equal(result.winnerId,challengerId);
    assert.equal(result.challengerScore,94);
    assert.equal(result.opponentScore,70);
    assert.match(result.events[0].detail,/Registry agent/);
  }
});
