import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const state=await(await fetch('http://127.0.0.1:4318/api/state')).json();
const completed=state.jobs.filter(job=>job.receipt?.success);
assert.ok(completed.some(j=>j.agentId==='cedar'));
assert.ok(completed.some(j=>j.agentId==='birch'));
const response=await fetch('https://preprod.koios.rest/api/v1/tx_info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({_tx_hashes:completed.map(j=>j.transaction)}),signal:AbortSignal.timeout(20000)});
assert.equal(response.status,200);
const rows=await response.json();
const receipts=completed.map(job=>{
  const chain=rows.find(row=>row.tx_hash===job.transaction);
  assert.ok(chain?.block_hash,'Transaction must be included in a block');
  return {agentId:job.agentId,serviceAmount:job.total,networkFee:job.networkFee,receipt:job.receipt,chain:{transaction:chain.tx_hash,blockHash:chain.block_hash,blockHeight:chain.block_height},events:job.events};
});
await writeFile(new URL('../evidence/real-payment-results.json',import.meta.url),JSON.stringify({verifiedAt:new Date().toISOString(),network:'cardano:preprod',verification:'Independent read-only Koios block-inclusion check after SDK settlement',receipts},null,2));
console.log(JSON.stringify({verified:receipts.length,transactions:receipts.map(r=>r.receipt.transaction)}));
