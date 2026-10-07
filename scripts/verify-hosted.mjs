import { readFile,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const base='https://blindbench-red.vercel.app';
const secrets=JSON.parse(await readFile(new URL('../.local/hosting-secrets.json',import.meta.url),'utf8'));
const jar={};let token;
async function request(path,body){
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Cookie:Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; '),...(body===undefined?{}:{'Content-Type':'application/json','x-demo-token':token})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  for(const cookie of r.headers.getSetCookie()){const [name,value]=cookie.split(';')[0].split(/=(.*)/s);jar[name]=value;}
  return{status:r.status,body:await r.json()};
}
let context;
const contextFile=new URL('../.local/hosted-test-session.json',import.meta.url);
try{context=JSON.parse(await readFile(contextFile,'utf8'));Object.assign(jar,context.jar);token=context.token;}catch(e){if(e.code!=='ENOENT')throw e;}
const state=await request('/api/state');assert.equal(state.status,200);token=state.body.token;
if(!context){
  assert.equal((await request('/api/purchases',{requestId:randomUUID(),taskId:'launch',budget:'1.2'})).status,403);
  assert.equal((await request('/api/unlock',{code:'incorrect'})).status,403);
  assert.equal((await request('/api/unlock',{code:secrets.accessCode})).status,200);
  assert.equal((await request('/api/purchases',{requestId:randomUUID(),taskId:'launch',budget:'1.0'})).status,400);
  const id=randomUUID();context={id,jar,token};await writeFile(contextFile,JSON.stringify(context),{mode:0o600});
  const started=await request('/api/purchases',{requestId:id,taskId:'launch',budget:'1.2'});
  assert.equal(started.status,202,JSON.stringify(started.body));console.log('Protected hosted purchase started:',id);
}
if(process.env.RESUME_HOSTED==='1'){
  assert.equal((await request('/api/unlock',{code:secrets.accessCode})).status,200);
  const resumed=await request('/api/jobs/'+context.id+'/resume',{});
  assert.equal(resumed.status,200,JSON.stringify(resumed.body));
  console.log('Resumed existing purchase.');
}
for(let i=0;i<80;i++){
  const result=await request('/api/jobs/'+context.id);assert.equal(result.status,200);
  const job=result.body;
  if(i%4===0)console.log('Status:',job.status,'Last step:',job.events.at(-1)?.label);
  if(['complete','failed','pending'].includes(job.status)){
    await writeFile(new URL('../evidence/hosted-payment-results.json',import.meta.url),JSON.stringify({url:base,checkedAt:new Date().toISOString(),unauthorizedPaymentBlocked:true,wrongCodeRejected:true,underBudgetRejected:true,job},null,2));
    console.log(JSON.stringify({status:job.status,transaction:job.transaction,lastStep:job.events.at(-1),error:job.error}));
    if(job.status!=='complete')process.exitCode=1;
    break;
  }
  await new Promise(r=>setTimeout(r,2500));
}
