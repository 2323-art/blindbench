import {comparison,challengeDetails} from './comparison.mjs';
import express from 'express';
import { createHmac, createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { agents, birch, tasks, FEE, NETWORK, quote } from './catalog.mjs';
import { createPayments } from './payments.mjs';
import { blobStore } from './cloud-store.mjs';
import { listMasumiAgents } from './registry.mjs';
import { enrollment, benchmarkAgents } from './enrollment.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const publicJob=({paymentPayload,sessionId,reservation,...job})=>job;
const digest=s=>createHash('sha256').update(String(s)).digest();
const equal=(a,b)=>timingSafeEqual(digest(a),digest(b));
export function createCloudApp({store=blobStore(),payments:providedPayments,secret=process.env.DEMO_SESSION_SECRET,accessCode=process.env.DEMO_ACCESS_CODE,background=waitUntil,baseUrl=process.env.PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined),stepDelay=400,cap=Number(process.env.DEMO_SPEND_CAP_LOVELACE||20000000)}={}) {
  const app=express();let paymentsPromise;const payments=()=>paymentsPromise??=providedPayments?Promise.resolve(providedPayments):createPayments();
  const hmac=s=>createHmac('sha256',secret).update(s).digest('base64url');
  const encode=value=>{const payload=Buffer.from(JSON.stringify(value)).toString('base64url');return `${payload}.${hmac(payload)}`;};
  function decode(cookie) {try{const [payload,sig]=cookie.split('.');if(!equal(sig,hmac(payload)))return null;return JSON.parse(Buffer.from(payload,'base64url'));}catch{return null;}}
  function cookie(res,name,value,maxAge=86400000){res.cookie(name,value,{httpOnly:true,secure:!!process.env.VERCEL,sameSite:'strict',path:'/',maxAge});}
  app.disable('x-powered-by');app.set('trust proxy',1);app.use(express.json({limit:'24kb'}));
  app.use((req,res,next)=>{
    res.set('Cache-Control','private, no-store');
    if(!secret||!accessCode)return res.status(503).json({error:'Hosted demo configuration is incomplete.'});
    const origin=req.get('origin');
    if(origin && origin!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'Cross-origin requests are disabled.'});
    const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split(/=(.*)/s)).filter(x=>x[0]).map(([k,v])=>[k,v]));
    const existing=decode(cookies.bb_session||'');
    req.sessionId=existing?.id&&existing.exp>Date.now()?existing.id:randomUUID();
    if(req.sessionId!==existing?.id)cookie(res,'bb_session',encode({id:req.sessionId,exp:Date.now()+86400000}));
    req.demoToken=hmac(`csrf:${req.sessionId}`);
    const auth=decode(cookies.bb_access||'');req.authorized=auth?.id===req.sessionId&&auth.exp>Date.now();
    const challenge=decode(cookies.bb_challenge||'');req.challenge=challenge?.sessionId===req.sessionId?comparison(challenge):null;
    const entry=decode(cookies.bb_enrollment||'');req.enrollment=entry?.sessionId===req.sessionId?enrollment(entry):null;
    if(req.method==='POST'&&!equal(req.get('x-demo-token')||'',req.demoToken))return res.status(403).json({error:'Reload the demo before continuing.'});
    next();
  });
  async function readJob(id){return (await store.read()).jobs[id];}
  async function update(id,fn){return store.change(d=>{const j=d.jobs[id];if(!j)throw new Error('Purchase not found');fn(j,d);return structuredClone(j);});}
  const event=(id,label,detail,simulated=false)=>update(id,j=>j.events.push({label,detail,simulated,time:new Date().toISOString()}));
  async function deliver(id){
    let job=await readJob(id);if(job.status==='complete')return;
    await update(id,j=>{j.status='fulfilling';delete j.error;});
    const steps=[['Provider requests payment','Simulated HTTP 402 from the masked provider.'],['Provider payment signed',`Simulated authorisation for ${job.providerPrice/1e6} tADA. No outgoing funds move.`],['Provider payment verified','Simulated x402 verification.'],['Provider payment settled','Simulated settlement only. No provider transaction exists.'],['Summary delivered','Prepared output for the selected preset text.']];
    for(const [label,detail]of steps){if(!job.events.some(e=>e.label===label)){await sleep(stepDelay);await event(id,label,detail,true);}}
    await update(id,(j,d)=>{j.result=tasks.find(t=>t.id===j.taskId).outputs[j.agentId];j.status='complete';j.processingUntil=0;d.active=null;d.spent-=Math.max(0,j.reservation-j.total-j.networkFee);j.reservation=j.total+j.networkFee;});
  }
  async function observe(id){
    const job=await readJob(id);
    if(job.receipt?.success){await deliver(id);return;}
    const response=await fetch('https://preprod.koios.rest/api/v1/tx_info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({_tx_hashes:[job.transaction]}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Confirmation provider unavailable');
    const rows=await response.json();
    if(rows.some(r=>r.tx_hash===job.transaction&&r.block_hash)){
      await update(id,j=>{j.receipt={success:true,transaction:j.transaction,network:NETWORK,extra:{status:'confirmed',confirmations:0}};});
      await event(id,'Buyer payment confirmed','The original signed transaction is included in a preprod block.');await deliver(id);
    }else{await update(id,j=>{j.status='pending';j.processingUntil=0;});await event(id,'Confirmation pending','No replacement payment has been signed. Check again shortly.');}
  }
  async function run(id){
    try{
      let job=await readJob(id);if(job.paymentAttempted||job.receipt?.success){await observe(id);return;}
      const root=typeof baseUrl==='function'?baseUrl():baseUrl;
      if(!root)throw new Error('Public URL missing');
      const url=`${root}/api/resource/${id}`,headers={'x-internal-token':hmac(`resource:${id}`)};
      const unpaid=await fetch(url,{headers,signal:AbortSignal.timeout(20000)});
      if(unpaid.status!==402)throw new Error('Expected HTTP 402');
      const required=await unpaid.json();await event(id,'HTTP 402 · payment required',`${job.total/1e6} tADA requested on Cardano preprod.`);
      const signed=job.paymentPayload ? {payload:job.paymentPayload,transaction:job.transaction,networkFee:job.networkFee} : await(await payments()).sign(required,job);
      await update(id,j=>Object.assign(j,{paymentPayload:signed.payload,transaction:signed.transaction,networkFee:signed.networkFee}));
      await event(id,'Buyer wallet signed',`Automatic signature. Service ${job.total/1e6} tADA; network fee ${signed.networkFee/1e6} tADA.`);
      const response=await fetch(url,{headers:{...headers,'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(signed.payload)).toString('base64')},signal:AbortSignal.timeout(180000)});
      if(response.status===202)return;
      if(!response.ok)throw new Error('Payment not confirmed');
      const receipt=JSON.parse(Buffer.from(response.headers.get('PAYMENT-RESPONSE')||'','base64').toString());
      if(!receipt.success||receipt.transaction!==signed.transaction||receipt.network!==NETWORK)throw new Error('Receipt mismatch');
      await deliver(id);
    }catch(error){
      console.error('Payment worker failed:',error.name);
      await update(id,(j,d)=>{j.processingUntil=0;j.status=j.paymentAttempted?'pending':'failed';j.error=j.paymentAttempted?'Check the existing transaction; no replacement payment will be signed.':'Payment stopped before submission. Check wallet funding and network availability.';if(!j.paymentAttempted){d.active=null;d.spent-=j.reservation;j.reservation=0;}});
    }
  }
  app.get('/api/state',async(req,res)=>{
    const data=await store.read();
    const enrolled=req.enrollment?.status==='complete';
    res.json({token:req.demoToken,hosted:true,authorized:req.authorized,agents:benchmarkAgents(enrolled),birch,tasks,fee:FEE,network:NETWORK,enrolled,enrollment:req.enrollment,announced:req.challenge?.status==='complete',jobs:Object.values(data.jobs).filter(j=>j.sessionId===req.sessionId).map(publicJob),comparisons:req.challenge?[req.challenge]:[]});
  });
  let walletCache;
  app.get('/api/wallet',async(_req,res)=>{if(!walletCache||Date.now()-walletCache.at>20000)walletCache={at:Date.now(),value:await(await payments()).readiness()};res.json(walletCache.value);});
  app.post('/api/unlock',(req,res)=>{
    if(typeof req.body.code!=='string'||!equal(req.body.code,accessCode))return res.status(403).json({error:'Incorrect demo access code.'});
    cookie(res,'bb_access',encode({id:req.sessionId,exp:Date.now()+7200000}),7200000);res.json({authorized:true});
  });
  app.get('/api/masumi-agents',async(_req,res)=>{try{res.json(await listMasumiAgents());}catch{res.status(503).json({error:'Masumi registry is temporarily unavailable. New Agent is still available for the demo.'});}});
  app.post('/api/enrollments',(req,res)=>{
    if(req.body.modelId!=='new-agent')return res.status(400).json({error:'Only New Agent supports demo enrollment. Live agent execution is not enabled.'});
    if(req.enrollment)return res.status(200).json(req.enrollment);
    const data={id:randomUUID(),sessionId:req.sessionId,start:Date.now()};cookie(res,'bb_enrollment',encode(data));res.status(202).json(enrollment(data));
  });
  app.post('/api/enrollments/reset',(_req,res)=>{
    cookie(res,'bb_enrollment','',0);res.json({ok:true});
  });
  app.post('/api/quote',(req,res)=>{try{res.json(quote(req.body,req.challenge?.status==='complete'&&req.challenge.winnerId==='birch',req.enrollment?.status==='complete'));}catch(e){res.status(400).json({error:e.message});}});
  app.post('/api/purchases',async(req,res)=>{
    if(!req.authorized)return res.status(403).json({error:'Enter the demo access code in Test wallet (analytics) to enable real payments.'});
    const id=req.body.requestId;if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))return res.status(400).json({error:'Valid request ID required.'});
    let selection;try{selection=quote(req.body,req.challenge?.status==='complete'&&req.challenge.winnerId==='birch',req.enrollment?.status==='complete');}catch(e){return res.status(400).json({error:e.message});}
    const wallet=await(await payments()).readiness();if(!wallet.ready||wallet.balance<selection.total+1000000)return res.status(409).json({error:wallet.reason||'Not enough test funds, including the network-fee reserve.'});
    let created=false,job;
    try{job=await store.change(d=>{
      created=false;
      if(d.jobs[id]){if(d.jobs[id].sessionId!==req.sessionId)throw new Error('Request ID unavailable.');return d.jobs[id];}
      if(d.active)throw new Error('Another test payment is awaiting confirmation. Try again after it finishes.');
      const reserve=selection.total+1000000;if(d.spent+reserve>cap)throw new Error('Hosted demo spending limit reached. No payment was made.');
      if(Object.keys(d.jobs).length>=100)throw new Error('Demo purchase limit reached.');
      const j={id,sessionId:req.sessionId,...selection,reservation:reserve,status:'running',processingUntil:Date.now()+300000,createdAt:new Date().toISOString(),events:[{label:'Agent selected',detail:`${selection.agentId==='birch'?'Direct discovery purchase':'Selected ranked agent'} · ${selection.total/1e6} tADA including fee.`,simulated:false,time:new Date().toISOString()}]};
      d.jobs[id]=j;d.active=id;d.spent+=reserve;created=true;return j;
    });}catch(e){return res.status(409).json({error:e.message});}
    if(created)background(run(id));res.status(created?202:200).json(publicJob(job));
  });
  app.get('/api/jobs/:id',async(req,res)=>{
    if(req.enrollment?.id===req.params.id)return res.json(req.enrollment);
    if(req.challenge?.id===req.params.id)return res.json(req.challenge);
    const j=await readJob(req.params.id);if(!j||j.sessionId!==req.sessionId)return res.status(404).json({error:'Run not found.'});
    const safe=publicJob(j);if(['running','fulfilling'].includes(j.status)&&j.processingUntil<Date.now()){safe.status='pending';safe.error='The worker stopped. Check this purchase to resume safely.';}
    res.json(safe);
  });
  app.post('/api/jobs/:id/resume',async(req,res)=>{
    if(!req.authorized)return res.status(403).json({error:'Unlock real payments first.'});
    try{const job=await update(req.params.id,j=>{if(j.sessionId!==req.sessionId||j.status==='complete'||j.status==='failed')throw new Error('No pending purchase.');if(j.processingUntil>Date.now())throw new Error('This purchase is still being processed.');j.status='running';j.processingUntil=Date.now()+300000;});background(run(job.id));res.json(publicJob(job));}catch(e){res.status(409).json({error:e.message});}
  });
  app.get('/api/resource/:id',async(req,res)=>{
    const id=req.params.id;if(!equal(req.get('x-internal-token')||'',hmac(`resource:${id}`)))return res.status(403).json({error:'Dedicated buyer only.'});
    const job=await readJob(id);if(!job)return res.sendStatus(404);
    const pay=await payments(),requirements=pay.requirements(job);
    const root=typeof baseUrl==='function'?baseUrl():baseUrl;
    const required={x402Version:2,resource:{url:`${root}/api/resource/${id}`,description:'Blindbench summarisation',mimeType:'application/json'},accepts:[requirements]};
    const header=req.get('PAYMENT-SIGNATURE');if(!header)return res.status(402).set('PAYMENT-REQUIRED',Buffer.from(JSON.stringify(required)).toString('base64')).json(required);
    let payload;try{payload=JSON.parse(Buffer.from(header,'base64').toString());}catch{return res.sendStatus(400);}
    if(JSON.stringify(payload)!==JSON.stringify(job.paymentPayload))return res.sendStatus(403);
    if(job.receipt?.success)return res.set('PAYMENT-RESPONSE',Buffer.from(JSON.stringify(job.receipt)).toString('base64')).json({paid:true});
    if(job.paymentAttempted)return res.status(202).json({pending:true});
    const verified=await pay.verify(payload,requirements);if(!verified.isValid)return res.status(402).json({error:'Cardano verifier rejected the payment.'});
    let claimed=false;await update(id,j=>{claimed=false;if(!j.paymentAttempted){j.paymentAttempted=true;claimed=true;}});if(!claimed)return res.status(202).json({pending:true});
    await event(id,'Buyer payment verified','The Cardano x402 verifier accepted the signed payment.');
    await event(id,'Waiting for Cardano settlement','Waiting for canonical block inclusion. This can take several minutes.');
    const receipt=await pay.settle(payload,requirements);
    if(!receipt.success){await update(id,j=>{j.status='pending';j.processingUntil=0;});return res.status(202).json({pending:true});}
    if(receipt.transaction!==job.transaction||receipt.network!==NETWORK)throw new Error('Receipt mismatch');
    await update(id,j=>{j.receipt=receipt;});await event(id,'Buyer payment settled','Confirmed in a Cardano preprod block. Real testnet transaction.');
    res.set('PAYMENT-RESPONSE',Buffer.from(JSON.stringify(receipt)).toString('base64')).json({paid:true});
  });
  app.post('/api/comparisons',(req,res)=>{
    if(req.challenge?.status==='running')return res.status(409).json({error:'A comparison is already running.'});
    let details;try{details=challengeDetails(req.body.challengerId??'birch');}catch(e){return res.status(400).json({error:e.message});}
    const data={id:randomUUID(),sessionId:req.sessionId,start:Date.now(),challengerId:details.challengerId};cookie(res,'bb_challenge',encode(data));res.status(202).json(comparison(data));
  });
  app.post('/api/reset',(_req,res)=>{cookie(res,'bb_challenge','',0);cookie(res,'bb_enrollment','',0);res.json({ok:true,message:'Presentation reset. Real receipts are retained.'});});
  app.use((error,_req,res,_next)=>{console.error('Cloud request failed:',error.name);res.status(503).json({error:'The hosted service is temporarily unavailable. Existing payments remain recorded; do not start a replacement payment.'});});
  return app;
}
