import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBudget, selectAgent, quote, agents } from '../lib/catalog.mjs';

test('Budget includes provider and service fee, with exact boundary behavior', () => {
  assert.equal(selectAgent(parseBudget('1.199999')), null);
  assert.equal(selectAgent(parseBudget('1.2')).id, 'finch');
  assert.equal(selectAgent(parseBudget('2.199999')).id, 'finch');
  assert.equal(selectAgent(parseBudget('2.2')).id, 'cedar');
  assert.equal(selectAgent(parseBudget('10')).id, 'cedar');
});
test('Malformed, negative, infinite and oversized budgets cannot trigger payment', () => {
  for (const input of ['-1','NaN','Infinity','1e3','10.1','1.0000001','',null,2.2]) assert.throws(() => parseBudget(input));
});
test('Announcement allows direct Birch purchase without changing seeded rankings', () => {
  const before = JSON.stringify(agents);
  assert.throws(() => quote({ taskId:'launch', budget:'2', directAgent:'birch' }, false));
  assert.equal(quote({ taskId:'launch', budget:'1.7', directAgent:'birch' }, true).total,1700000);
  assert.throws(() => quote({ taskId:'launch', budget:'1.699999', directAgent:'birch' }, true));
  assert.equal(quote({ taskId:'launch', budget:'2.2' }, true).agentId, 'cedar');
  assert.equal(JSON.stringify(agents), before);
});
test('Unknown task and arbitrary provider IDs are rejected', () => {
  assert.throws(() => quote({ taskId:'arbitrary', budget:'2.2' }, false));
  assert.throws(() => quote({ taskId:'launch', budget:'2.2', directAgent:'evil' }, true));
});

test('Explicit ranked selection honors the chosen agent and enforces its price', () => {
  assert.equal(quote({taskId:'launch',budget:'3.2',agentId:'atlas'},false).agentId,'atlas');
  assert.equal(quote({taskId:'launch',budget:'3.2',agentId:'finch'},false).total,1200000);
  assert.throws(()=>quote({taskId:'launch',budget:'2.2',agentId:'atlas'},false));
  assert.throws(()=>quote({taskId:'launch',budget:'3.2',agentId:'birch'},true));
  assert.throws(()=>quote({taskId:'launch',budget:'3.2',agentId:'evil'},false));
  assert.throws(()=>quote({taskType:'research',taskId:'launch',budget:'3.2',agentId:'cedar'},false));
});
