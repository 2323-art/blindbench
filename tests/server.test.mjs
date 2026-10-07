import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server.mjs';

async function fixture(t, { reject = false, pending = false } = {}) {
  const directory=await mkdtemp(join(tmpdir(),'blindbench-test-'));
  const calls={sign:0,verify:0,settle:0};
  const tx='a'.repeat(64);
  const payments={
    readiness:async()=>({ready:true,balance:100000000}),
    requirements:j=>({scheme:'exact',network:'cardano:preprod',asset:'lovelace',amount:String(j.total),payTo:'test-only',maxTimeoutSeconds:600}),
    sign:async(required)=>{calls.sign++;assert.equal(required.x402Version,2);return{payload:{x402Version:2,payload:{transaction:'test-only'},accepted:required.accepts[0]},transaction:tx,networkFee:180000};},
    verify:async()=>{calls.verify++;return{isValid:!reject};},
    settle:async()=>{calls.settle++;return{success:!pending,transaction:tx,network:'cardano:preprod',...(pending?{errorReason:'settlement_pending'}:{})};},
  };
  const {app,setUrl,drain}=await createApp({payments,directory:pathToFileURL(directory+'/'),stepDelay:0});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}`;setUrl(url);
  const state=await(await fetch(url+'/api/state')).json();
  const post=(path,data,headers={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','x-demo-token':state.token,...headers},body:JSON.stringify(data)});
  const get=async path=>(await fetch(url+path)).json();
  t.after(async()=>{await new Promise(r=>server.close(r));await drain();await rm(directory,{recursive:true,force:true});});
  return{get,post,calls,url};
}
async function finish(f,id) {
  for(let i=0;i<100;i++){const j=await f.get('/api/jobs/'+id);if(['complete','failed','pending'].includes(j.status))return j;await new Promise(r=>setTimeout(r,20));}
  throw new Error('Job did not finish');
}
test('HTTP 402 exchange, settlement gate, persistent receipt and duplicate request safety',async t=>{
  const f=await fixture(t);const input={requestId:randomUUID(),taskId:'launch',budget:'2.2'};
  const response=await f.post('/api/purchases',input);assert.equal(response.status,202);
  const job=await finish(f,input.requestId);assert.equal(job.status,'complete');assert.ok(job.result);assert.ok(job.receipt.success);
  assert.equal(job.events.find(e=>e.label.startsWith('HTTP 402')).simulated,false);
  assert.equal(job.events.filter(e=>e.label.startsWith('Provider')).length,4);
  assert.ok(job.events.filter(e=>e.label.startsWith('Provider')).every(e=>e.simulated));
  assert.equal('paymentPayload' in job,false);
  await f.post('/api/purchases',input);assert.deepEqual(f.calls,{sign:1,verify:1,settle:1});
  await f.post('/api/reset',{});assert.equal((await f.get('/api/state')).jobs[0].receipt.success,true);
});
test('Rejected verification never settles or delivers',async t=>{
  const f=await fixture(t,{reject:true});const id=randomUUID();await f.post('/api/purchases',{requestId:id,taskId:'launch',budget:'2.2'});
  const job=await finish(f,id);assert.equal(job.status,'failed');assert.equal(job.result,undefined);assert.equal(f.calls.settle,0);
});
test('Pending chain outcome never delivers and blocks a second payment',async t=>{
  const f=await fixture(t,{pending:true});const id=randomUUID();await f.post('/api/purchases',{requestId:id,taskId:'launch',budget:'2.2'});
  const job=await finish(f,id);assert.equal(job.status,'pending');assert.equal(job.result,undefined);
  assert.equal((await f.post('/api/purchases',{requestId:randomUUID(),taskId:'launch',budget:'2.2'})).status,409);
  assert.equal(f.calls.sign,1);
});
test('No-budget and cross-origin requests cannot spend the wallet',async t=>{
  const f=await fixture(t);assert.equal((await f.post('/api/purchases',{requestId:randomUUID(),taskId:'launch',budget:'1'})).status,400);
  assert.equal((await f.post('/api/purchases',{requestId:randomUUID(),taskId:'launch',budget:'2.2'},{origin:'https://malicious.example'})).status,403);
  assert.equal((await fetch(f.url+'/api/resource/whatever')).status,403);assert.equal(f.calls.sign,0);
});
test('Provider challenge changes only announcement and enables Birch',async t=>{
  const f=await fixture(t);const before=(await f.get('/api/state')).agents;
  const j=await(await f.post('/api/comparisons',{})).json();const result=await finish(f,j.id);
  assert.equal(result.status,'complete');assert.ok(result.events.every(e=>e.simulated));assert.equal(f.calls.sign,0);
  const state=await f.get('/api/state');assert.equal(state.announced,true);assert.deepEqual(state.agents,before);
  assert.equal((await f.post('/api/quote',{taskId:'launch',budget:'1.7',directAgent:'birch'})).status,200);
});
