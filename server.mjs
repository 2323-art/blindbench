import {challengeDetails} from './lib/comparison.mjs';
import express from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { agents, birch, tasks, FEE, NETWORK, quote } from './lib/catalog.mjs';
import { openStore } from './lib/store.mjs';
import { createPayments } from './lib/payments.mjs';
import { listMasumiAgents } from './lib/registry.mjs';
import { enrollment, benchmarkAgents } from './lib/enrollment.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function createApp({ payments, directory = new URL('./.local/', import.meta.url), stepDelay = 550 } = {}) {
  payments ??= await createPayments();
  const store = await openStore(directory);
  const { data } = store;
  const app = express();
  const token = randomBytes(32).toString('hex');
  const internalToken = randomBytes(32).toString('hex');
  const active = new Set();
  let buyerBusy = false;
  let localUrl;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname)) return res.status(403).json({ error: 'This test-wallet demo is local only.' });
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'");
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Cross-origin requests are disabled.' });
    if (req.method === 'POST' && req.get('x-demo-token') !== token) return res.status(403).json({ error: 'Reload the demo before continuing.' });
    next();
  });
  app.use(express.json({ limit: '24kb' }));
  const publicJob = job => {
    const { paymentPayload, ...safe } = job;
    return safe;
  };
  async function event(job, label, detail, simulated = false) {
    job.events.push({ label, detail, simulated, time: new Date().toISOString() });
    await store.save();
  }
  async function deliver(job) {
    if (job.status === 'complete') return;
    delete job.error;
    job.status = 'fulfilling';
    await store.save();
    const providerSteps = [
      ['Provider requests payment', 'Simulated HTTP 402 from the masked service provider.'],
      ['Provider payment signed', `Simulated authorisation for ${job.providerPrice / 1e6} test ADA. No outgoing funds move.`],
      ['Provider payment verified', 'Simulated verification accepts the demonstration payload.'],
      ['Provider payment settled', 'Simulated settlement only. No provider transaction exists.'],
    ];
    for (const [label, detail] of providerSteps) { await delay(stepDelay); await event(job, label, detail, true); }
    job.result = tasks.find(t => t.id === job.taskId).outputs[job.agentId];
    job.status = 'complete';
    await event(job, 'Summary delivered', 'Prepared model output for the selected preset text.', true);
  }
  async function observe(job) {
    job.status = 'running';
    await event(job, 'Checking existing transaction', 'Rechecking the original transaction only; no new payment is signed.');
    try {
      const response = await fetch('https://preprod.koios.rest/api/v1/tx_info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _tx_hashes: [job.transaction] }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Provider unavailable');
      const rows = await response.json();
      const found = rows.find(r => r.tx_hash === job.transaction && r.block_hash);
      if (!found) { job.status = 'pending'; await event(job, 'Confirmation still pending', 'Keep this purchase and check again. Do not start a replacement payment.'); return; }
      job.receipt = { success: true, network: NETWORK, transaction: job.transaction, extra: { status: 'confirmed', confirmations: 0, evidence: 'koios canonical block inclusion' } };
      await event(job, 'Buyer payment confirmed', 'The original signed transaction is included in a Cardano preprod block.');
      await deliver(job);
    } catch { job.status = 'pending'; await event(job, 'Confirmation unavailable', 'The network provider could not confirm the transaction. No replacement payment was made.'); }
  }
  async function runBuyer(job) {
    buyerBusy = true;
    active.add(job.id);
    try {
      if (job.receipt?.success) { await deliver(job); return; }
      if (job.paymentAttempted) { await observe(job); return; }
      job.status = 'running';
      await store.save();
      const url = `${localUrl}/api/resource/${job.id}`;
      const first = await fetch(url, { headers: { 'x-internal-token': internalToken } });
      if (first.status !== 402) throw new Error('The resource did not return HTTP 402.');
      const required = await first.json();
      await event(job, 'HTTP 402 · payment required', `${job.total / 1e6} test ADA requested by the service. Network: ${NETWORK}.`);
      const signed = await payments.sign(required, job);
      Object.assign(job, { paymentPayload: signed.payload, transaction: signed.transaction, networkFee: signed.networkFee });
      await event(job, 'Buyer wallet signed', `Signed automatically. Service ${job.total / 1e6} test ADA; network fee ${signed.networkFee / 1e6} test ADA. Not yet settled.`);
      const response = await fetch(url, { headers: { 'x-internal-token': internalToken, 'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(signed.payload)).toString('base64') }, signal: AbortSignal.timeout(240000) });
      if (response.status === 202) { job.status = 'pending'; await store.save(); return; }
      if (!response.ok) throw new Error((await response.json()).error || 'Payment verification failed.');
      const receiptHeader = response.headers.get('PAYMENT-RESPONSE');
      const receipt = receiptHeader ? JSON.parse(Buffer.from(receiptHeader, 'base64').toString()) : null;
      if (!receipt?.success || receipt.transaction !== job.transaction || receipt.network !== NETWORK) throw new Error('No matching settlement receipt received.');
      job.receipt = receipt;
      await store.save();
      await deliver(job);
    } catch (error) {
      job.status = job.paymentAttempted ? 'pending' : 'failed';
      job.error = job.paymentAttempted ? 'Payment outcome needs confirmation. Check the existing transaction; do not pay again.' : 'Payment could not proceed. Check wallet funding and network availability, then retry.';
      // SDK errors can contain provider requests or secrets; never return them to the browser.
      await event(job, job.paymentAttempted ? 'Awaiting confirmation' : 'Buyer payment stopped', job.error);
    } finally { buyerBusy = false; active.delete(job.id); await store.save(); }
  }
  app.get('/api/state', async (_req, res) => res.json({ token, agents:benchmarkAgents(enrollment(data.enrollment)?.status==='complete'), enrollment:enrollment(data.enrollment),enrolled:enrollment(data.enrollment)?.status==='complete', birch, tasks, fee: FEE, announced: data.announced, network: NETWORK, jobs: Object.values(data.jobs).map(publicJob), comparisons: Object.values(data.comparisons) }));
  app.get('/api/masumi-agents',async(_req,res)=>{try{res.json(await listMasumiAgents());}catch{res.status(503).json({error:'Masumi registry unavailable. New Agent is still available.'});}});
  app.post('/api/enrollments',async(req,res)=>{
    if(req.body.modelId!=='new-agent')return res.status(400).json({error:'Only New Agent supports demo enrollment.'});
    if(data.enrollment)return res.json(enrollment(data.enrollment));
    data.enrollment={id:randomUUID(),start:Date.now()};await store.save();res.status(202).json(enrollment(data.enrollment));
  });
  app.get('/api/jobs/:id',(req,res,next)=>{if(req.params.id===data.enrollment?.id)return res.json(enrollment(data.enrollment));next();});
  app.post('/api/enrollments/reset',async(_req,res)=>{delete data.enrollment;await store.save();res.json({ok:true});});
  app.get('/api/wallet', async (_req, res) => res.json(await payments.readiness()));
  app.post('/api/quote', (req, res) => {
    try { res.json(quote(req.body, Object.values(data.comparisons).some(c=>c.status==='complete'&&(c.winnerId??'birch')==='birch'),enrollment(data.enrollment)?.status==='complete')); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/purchases', async (req, res) => {
    const key = req.body.requestId;
    if (typeof key !== 'string' || !/^[a-f0-9-]{36}$/.test(key)) return res.status(400).json({ error: 'A valid request ID is required.' });
    const existing = data.jobs[key];
    if (existing) return res.json(publicJob(existing));
    if (buyerBusy || Object.values(data.jobs).some(j => ['running','pending','fulfilling','queued'].includes(j.status))) return res.status(409).json({ error: 'Finish or check the existing purchase before spending again.' });
    let selected;
    try { selected = quote(req.body, Object.values(data.comparisons).some(c=>c.status==='complete'&&(c.winnerId??'birch')==='birch'),enrollment(data.enrollment)?.status==='complete'); } catch (e) { return res.status(400).json({ error: e.message }); }
    // Reserve the single wallet before the asynchronous readiness check.
    buyerBusy = true;
    try {
      const wallet = await payments.readiness();
      if (!wallet.ready || wallet.balance < selected.total + 1000000) return res.status(409).json({ error: wallet.reason || 'Wallet needs the service price plus up to 1 test ADA reserved for network fees.' });
      const job = data.jobs[key] = { id: key, ...selected, events: [], status: 'queued', createdAt: new Date().toISOString() };
      await event(job, 'Agent selected', `${selected.agentId === 'birch' ? 'Direct discovery purchase' : 'Selected ranked agent'} · ${selected.total / 1e6} test ADA including fee.`);
      res.status(202).json(publicJob(job));
      void runBuyer(job);
    } finally { if (!active.has(key)) buyerBusy = false; }
  });
  app.get('/api/jobs/:id', (req, res) => {
    const job = data.jobs[req.params.id] ?? data.comparisons[req.params.id];
    if (!job) return res.status(404).json({ error: 'Run not found.' });
    res.json(publicJob(job));
  });
  app.post('/api/jobs/:id/resume', async (req,res) => {
    const job = data.jobs[req.params.id];
    if (!job || job.status !== 'pending') return res.status(400).json({ error: 'No pending payment to check.' });
    if (buyerBusy || active.has(job.id)) return res.status(409).json({ error: 'A payment check is already running.' });
    res.json(publicJob(job));
    void runBuyer(job);
  });
  app.get('/api/resource/:id', async (req,res) => {
    if (req.get('x-internal-token') !== internalToken) return res.status(403).json({ error: 'Only the dedicated demo buyer can call this resource.' });
    const job = data.jobs[req.params.id];
    if (!job) return res.sendStatus(404);
    const requirements = payments.requirements(job);
    const required = { x402Version: 2, resource: { url: `${localUrl}/api/resource/${job.id}`, description: 'Blindbench summarisation', mimeType: 'application/json' }, accepts: [requirements] };
    if (!req.get('PAYMENT-SIGNATURE')) return res.status(402).set('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(required)).toString('base64')).json(required);
    let payload;
    try { payload = JSON.parse(Buffer.from(req.get('PAYMENT-SIGNATURE'),'base64').toString()); } catch { return res.status(400).json({ error: 'Invalid payment header.' }); }
    if (JSON.stringify(payload) !== JSON.stringify(job.paymentPayload)) return res.status(403).json({ error: 'Payment payload does not belong to this purchase.' });
    if (job.receipt?.success) return res.set('PAYMENT-RESPONSE', Buffer.from(JSON.stringify(job.receipt)).toString('base64')).json({ paid: true });
    if (job.paymentAttempted) return res.status(202).json({ pending: true, transaction: job.transaction });
    const verified = await payments.verify(payload, requirements);
    if (!verified.isValid) return res.status(402).json({ error: 'The signed payment was rejected by the Cardano verifier.' });
    await event(job, 'Buyer payment verified', 'Cardano x402 verifier accepted the signed transaction.');
    job.paymentAttempted = true;
    await event(job, 'Waiting for Cardano settlement', 'Submitting the signed payment and waiting for block inclusion. This can take several minutes.');
    const receipt = await payments.settle(payload, requirements);
    if (!receipt.success) {
      job.status = 'pending';
      await event(job, 'Settlement pending', 'A successful settlement has not been confirmed. Use Check confirmation to observe the same transaction.');
      return res.status(202).json({ pending: true, transaction: job.transaction });
    }
    if (receipt.transaction !== job.transaction || receipt.network !== NETWORK) throw new Error('Settlement mismatch');
    job.receipt = receipt;
    await event(job, 'Buyer payment settled', 'Confirmed in a Cardano preprod block. Real testnet transaction; no mainnet funds.');
    res.set('PAYMENT-RESPONSE', Buffer.from(JSON.stringify(receipt)).toString('base64')).json({ paid: true });
  });
  app.post('/api/comparisons', async (req,res) => {
    let details;try{details=challengeDetails(req.body.challengerId??'birch');}catch(e){return res.status(400).json({error:e.message});}
    if (Object.values(data.comparisons).some(j => j.status === 'running')) return res.status(409).json({ error: 'A comparison is already running.' });
    const job = { id: randomUUID(), type: 'comparison', status: 'running', events: [], total: details.total, challengerId:details.challengerId,opponentId:details.opponentId,winnerId:details.winnerId, createdAt: new Date().toISOString() };
    data.comparisons[job.id] = job;
    await store.save();
    res.status(202).json(job);
    void (async () => {
      const steps = details.steps;
      for (const [label,detail] of steps) { await delay(stepDelay); await event(job,label,detail,true); }
      data.announced = true;
      job.status = 'complete';
      await store.save();
    })().catch(async () => { job.status = 'failed'; await store.save(); });
  });
  app.post('/api/reset', async (_req,res) => {
    if (buyerBusy || Object.values(data.comparisons).some(c => c.status === 'running')) return res.status(409).json({ error: 'Wait for the current run to finish before resetting.' });
    data.announced = false;
    delete data.enrollment;
    data.comparisons = {};
    await store.save();
    res.json({ ok: true, message: 'Demo presentation reset. Real payment history is retained.' });
  });
  app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url))));
  app.use((error,_req,res,_next) => res.status(500).json({ error: 'The operation could not finish. Check the existing purchase status before retrying.' }));
  for (const job of Object.values(data.jobs)) {
    if (['running','queued','fulfilling'].includes(job.status)) {
      job.status = job.paymentAttempted || job.receipt?.success ? 'pending' : 'failed';
      job.error = 'Server restarted. Check the existing payment before retrying.';
    }
  }
  for (const job of Object.values(data.comparisons)) if (job.status === 'running') job.status = 'failed';
  await store.save();
  return { app, setUrl(url) { localUrl = url; }, async drain() { while (active.size) await delay(10); await store.save(); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { app, setUrl } = await createApp();
  const port = Number(process.env.PORT || 4318);
  const server = app.listen(port, '127.0.0.1', () => { setUrl(`http://127.0.0.1:${server.address().port}`); console.log(`Blindbench: http://127.0.0.1:${server.address().port}`); });
}
