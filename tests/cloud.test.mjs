import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCloudApp } from '../lib/cloud-app.mjs';

async function fixture(t,{cap=20000000,pending=false}={}) {
  let data={jobs:{},active:null,spent:0};let queue=Promise.resolve();const tasks=[];let url;let signs=0;
  const store={read:async()=>structuredClone(data),change:fn=>{
    const task=queue.then(()=>{const copy=structuredClone(data);const value=fn(copy);data=copy;return structuredClone(value);});queue=task.catch(()=>{});return task;
  }};
  const payments={readiness:async()=>({ready:true,balance:100000000}),requirements:j=>({scheme:'exact',network:'cardano:preprod',asset:'lovelace',amount:String(j.total),payTo:'test-only'}),sign:async(required)=>{signs++;return{payload:{accepted:required.accepts[0],payload:{transaction:'test-only'}},transaction:'b'.repeat(64),networkFee:170000};},verify:async()=>({isValid:true}),settle:async()=>({success:!pending,network:'cardano:preprod',transaction:'b'.repeat(64)})};
  const app=createCloudApp({store,payments,secret:'session-test-secret',accessCode:'test-access-code',background:p=>tasks.push(p),baseUrl:()=>url,stepDelay:0,cap});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));url=`http://127.0.0.1:${server.address().port}`;
  async function client(){const jar={};let token;
    async function request(path,body,headers={}){const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{cookie:Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; '),...(body===undefined?{}:{'Content-Type':'application/json','x-demo-token':token}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});for(const c of r.headers.getSetCookie()){const [name,value]=c.split(';')[0].split(/=(.*)/s);jar[name]=value;}const value=await r.json();return{status:r.status,body:value};}
    const first=await request('/api/state');token=first.body.token;return{request,token};
  }
  t.after(async()=>{await Promise.allSettled(tasks);await new Promise(r=>server.close(r));});
  return{client,store,tasks,signs:()=>signs};
}
test('Cloud checkout requires code and rejects cross-origin requests before signing',async t=>{
  const f=await fixture(t),c=await f.client();
  const body={requestId:randomUUID(),taskId:'launch',budget:'2.2'};
  assert.equal((await c.request('/api/purchases',body)).status,403);
  assert.equal((await c.request('/api/unlock',{code:'wrong'})).status,403);
  assert.equal((await c.request('/api/unlock',{code:'test-access-code'},{origin:'https://evil.example'})).status,403);
  assert.equal(f.signs(),0);
});
test('Cloud payment follows HTTP 402, retains receipt, and isolates visitors',async t=>{
  const f=await fixture(t),c=await f.client(),other=await f.client();
  await c.request('/api/unlock',{code:'test-access-code'});
  const id=randomUUID(),input={requestId:id,taskId:'launch',budget:'3.2',agentId:'atlas'};
  assert.equal((await c.request('/api/purchases',input)).status,202);await Promise.all(f.tasks);
  const result=await c.request('/api/jobs/'+id);assert.equal(result.body.status,'complete');assert.ok(result.body.receipt.success);assert.equal(result.body.paymentPayload,undefined);
  assert.equal(result.body.agentId,'atlas');assert.equal(result.body.total,3200000);
  assert.equal((await other.request('/api/jobs/'+id)).status,404);assert.equal((await other.request('/api/state')).body.jobs.length,0);
  await c.request('/api/purchases',input);assert.equal(f.signs(),1);
  await c.request('/api/reset',{});assert.equal((await c.request('/api/state')).body.jobs.length,1);
});
test('Atomic shared budget cap and pending lock survive separate visitors',async t=>{
  const f=await fixture(t,{cap:3200000,pending:true}),c=await f.client(),other=await f.client();
  await c.request('/api/unlock',{code:'test-access-code'});await other.request('/api/unlock',{code:'test-access-code'});
  const responses=await Promise.all([c,other].map(x=>x.request('/api/purchases',{requestId:randomUUID(),taskId:'launch',budget:'2.2'})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[202,409]);await Promise.all(f.tasks);assert.equal(f.signs(),1);
  assert.equal((await f.store.read()).spent,3200000);assert.ok((await f.store.read()).active);
  assert.ok(Object.values((await f.store.read()).jobs).every(j=>!j.result));
});
test('Simulated comparison is session-specific and never calls wallet',async t=>{
  const f=await fixture(t),c=await f.client(),other=await f.client();
  assert.equal((await c.request('/api/comparisons',{challengerId:'atlas'})).status,400);
  const r=await c.request('/api/comparisons',{challengerId:'finch'});assert.equal(r.status,202);
  assert.equal(r.body.total,4200000);assert.equal(r.body.winnerId,'finch');assert.equal(r.body.challengerId,'finch');
  assert.equal((await other.request('/api/jobs/'+r.body.id)).status,404);assert.equal(f.signs(),0);
});

test('Creator enrollment persists per visitor, rejects live services, and never signs',async t=>{
  const f=await fixture(t),c=await f.client(),other=await f.client();
  assert.equal((await c.request('/api/enrollments',{modelId:'real-service'})).status,400);
  const started=await c.request('/api/enrollments',{modelId:'new-agent'});assert.equal(started.status,202);
  assert.equal((await c.request('/api/enrollments',{modelId:'new-agent'})).body.id,started.body.id);
  assert.equal((await other.request('/api/jobs/'+started.body.id)).status,404);
  assert.equal((await c.request('/api/state')).body.agents.length,3);
  await new Promise(r=>setTimeout(r,6500));
  const state=(await c.request('/api/state')).body;
  assert.equal(state.enrolled,true);assert.equal(state.agents[0].id,'birch');assert.equal(state.agents.length,4);
  assert.equal((await other.request('/api/state')).body.agents.length,3);assert.equal(f.signs(),0);
  assert.equal((await c.request('/api/quote',{taskId:'launch',budget:'1.7',agentId:'birch'})).body.agentId,'birch');
  await c.request('/api/enrollments/reset',{});
  const reset=(await c.request('/api/state')).body;assert.equal(reset.agents.length,3);assert.equal(reset.enrollment,null);
  assert.equal((await c.request('/api/quote',{taskId:'launch',budget:'1.7',agentId:'birch'})).status,400);
  const replay=await c.request('/api/enrollments',{modelId:'new-agent'});assert.equal(replay.status,202);assert.notEqual(replay.body.id,started.body.id);
});
