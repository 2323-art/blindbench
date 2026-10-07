const app = document.querySelector('#app');
let taskType = 'summary', statusError = false, challengerId='birch', opponentId='';
let registry, registryError='', registryLoading=false, creatorModel='new-agent';
let state, wallet, view = 'buyer', taskId = 'launch', budget = '2.2', direct = false, current = null, polling, busy = false;
const money = n => `${(n / 1e6).toFixed(1)} tADA`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const pill = (text, cls = '') => `<span class="pill ${cls}">${escape(text)}</span>`;
function toast(text) { document.querySelector('#toast').textContent = text; setTimeout(() => document.querySelector('#toast').textContent = '', 6000); }
async function api(path, data) {
  const r = await fetch(path, data === undefined ? {signal:AbortSignal.timeout(20000)} : { signal:AbortSignal.timeout(20000), method: 'POST', headers: { 'Content-Type': 'application/json', 'x-demo-token': state.token }, body: JSON.stringify(data) });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || 'Request failed.');
  return body;
}
function selected() {
  const pool = direct && state.announced ? [state.birch] : state.agents;
  const amount = Number(budget) * 1e6;
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e7) return null;
  return pool.find(a => a.price + state.fee <= Math.round(amount));
}
function shell() {
  app.innerHTML = `<aside class="sidebar"><a class="brand" href="/" aria-label="AgentOnboard home"><span class="logo">a<span>·</span>o</span><span>AgentOnboard<small>AGENT EVALUATION LAB</small></span></a>
    <div class="workspace-label">WORKSPACE </div><nav aria-label="Main navigation">
      <button data-view="buyer" class="${view==='buyer'?'active':''}"><span>◈</span> Hire an agent</button>
      <button data-view="compare" class="${view==='compare'?'active':''}"><span>⇄</span> Add/Compare agent</button>
      <button data-view="activity" class="${view==='activity'?'active':''}"><span>≡</span> Payment activity</button>
      <button data-view="wallet" class="${view==='wallet'?'active':''}"><span>▣</span> Test wallet (analytics)</button>
    </nav><div class="rail-note"><span class="live-dot"></span> Cardano preprod<p>Real buyer payments.<br>Simulated agents & judging.</p><button class="text-button" id="reset">Reset demo ↺</button></div></aside>
    <main><header class="topbar"><span>WORKBENCH / <strong>${({buyer:'DISCOVERY',compare:'COMPARISON',activity:'ACTIVITY',wallet:'WALLET'})[view]}</strong></span><button class="wallet-button" data-view="wallet"><span class="live-dot ${wallet?.ready?'':'muted-dot'}"></span>${wallet?.ready ? `${money(wallet.balance)} · Test wallet` : 'Test wallet setup'}</button></header>
    <div class="page"><div class="page-heading"><div><div class="eyebrow">${view==='compare'?'GIVE NEW MODELS A CHANCE':'PERFORMANCE BEFORE REPUTATION'}</div><h1>${({buyer:'Let the work speak.',compare:'A fair shot at discovery.',activity:'Follow the payment.',wallet:'Your agent’s test wallet.'})[view]}</h1><p>${({buyer:'Compare agents by quality and price. Every identity stays masked.',compare:'One benchmark. Two anonymous agents. Evidence you can inspect.',activity:'Real receipts stay here, even after you reset the demo.',wallet:'Automatic payments on Cardano preprod. Test funds only.'})[view]}</p></div></div><div id="content"></div></div><footer>AgentOnboard <span>Masked identities. Visible evidence.</span><span>x402 / CARDANO PREPROD</span></footer></main>`;
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { view = b.dataset.view; shell(); });
  document.querySelector('#reset').onclick = async () => {
    try { await api('/api/reset', {}); state = await api('/api/state'); direct = false; current = null; clearInterval(polling); shell(); toast('Demo reset. Real payment records are preserved.'); } catch (e) { toast(e.message); }
  };
  ({ buyer: renderBuyer, compare: renderCompare, activity: renderActivity, wallet: renderWallet })[view]();
}
function renderBuyer() {
  const available = taskType === 'summary';
  document.querySelector('#content').innerHTML = `${state.announced ? announcement() : ''}
    <div class="workspace-grid"><section class="panel task-panel"><div class="panel-heading"><h2>Your task</h2>${pill(available?'Available':'Coming soon',available?'success':'outline')}</div>
      <label for="task-type">Task</label><select id="task-type"><option value="summary" ${available?'selected':''}>Summary</option><option value="research" ${taskType==='research'?'selected':''}>Research · Coming soon</option><option value="transactions" ${taskType==='transactions'?'selected':''}>Transaction categorising · Coming soon</option></select>
      ${available?`<div class="sample-picker"><label for="task">Choose a sample text</label><select id="task">${state.tasks.map(t => `<option value="${t.id}" ${t.id===taskId?'selected':''}>${t.title}</option>`).join('')}</select></div>
      <div class="source-text" id="source"></div><div class="budget-row"><label for="budget">Your service budget<small>Provider price + 0.2 tADA fee</small></label><div class="budget-input"><input id="budget" type="number" min="0" max="10" step="0.1" value="${escape(budget)}"><span>tADA</span></div></div>
      
      `:'<div class="empty"><strong>This task is coming soon.</strong><p>Only Summary is available in this demo. Choose Summary to compare agents and make a testnet purchase.</p></div>'}
    </section><section class="panel ranking-panel"><div class="panel-heading"><h2>${available?'Summary agents':taskType==='research'?'Research agents':'Transaction categorising agents'}</h2>${pill(available?'Highest score first':'Coming soon','outline')}</div><p class="section-note">${available?'Seeded mock rankings. Compare every agent, then choose who to hire.':'Rankings and purchases for this task are not available yet.'}</p><div id="rankings"></div>${available?'<div class="rank-legend"><span>Score / 100</span><span>Prices include 0.2 tADA service fee</span></div>':''}</section></div>
    <div id="run"></div><div id="evidence"></div>`;
  document.querySelector('#task-type').onchange = e => { taskType=e.target.value; direct=false; renderBuyer(); };
  if(available){
    document.querySelector('#task').onchange = e => { taskId = e.target.value; updateSelection(); };
    document.querySelector('#budget').oninput = e => { budget = e.target.value; updateSelection(); };
    document.querySelectorAll('[data-budget]').forEach(b => b.onclick = () => { budget = b.dataset.budget; document.querySelector('#budget').value = budget; updateSelection(); });
  }
  bindTry(); updateSelection(); renderRun();
  if(state.enrolled){document.querySelector('.ranking-panel').insertAdjacentHTML('beforeend','<button class="text-button" id="reset-ranked-benchmark">Reset benchmark · Remove New Agent</button>');document.querySelector('#reset-ranked-benchmark').onclick=resetBenchmark;}
}
function updateSelection() {
  if(taskType!=='summary') {
    document.querySelector('#rankings').innerHTML='<div class="empty"><strong>No agents available yet</strong><p>This category will have its own task-specific rankings.</p></div>';
    document.querySelector('#evidence').innerHTML='';return;
  }
  const task = state.tasks.find(t => t.id === taskId), amount=Number(budget)*1e6;
  const validBudget=/^\d{1,3}(\.\d{1,6})?$/.test(budget)&&amount<=1e7;
  document.querySelector('#source').innerHTML = `<span>${escape(task.category)} · PRESET TEXT</span><p>${escape(task.text)}</p>`;
  const row=(a,unranked=false)=>{
    const affordable=validBudget&&a.price+state.fee<=Math.round(amount);
    return `<article class="agent-listing"><div class="rank-row"><span class="rank-number">${unranked?'↗':String(a.rank).padStart(2,'0')}</span><div class="avatar ${a.id}">${a.initials}</div><div class="agent-name"><strong>${a.name}</strong></div><div class="score"><strong>${a.score}</strong><progress aria-label="${a.name} quality score" max="100" value="${a.score}"></progress></div></div><div class="agent-purchase"><div class="price">${money(a.price+state.fee)}<small>${money(a.price)} + 0.2 fee · ${affordable?'Within budget':'Over budget'}</small></div><button class="primary" data-hire="${a.id}" ${busy||!affordable?'disabled':''}>${busy?'Purchase in progress…':`Hire ${a.name.replace('Unknown Agent ','').replace('Agent ','')}`}</button></div></article>`;
  };
  document.querySelector('#rankings').innerHTML = `${direct&&state.announced?`<div class="discovery-pick"><div class="eyebrow">FROM THE DISCOVERY ANNOUNCEMENT</div>${row(state.birch,true)}<button class="text-button" id="ranked">Close discovery pick</button></div>`:''}${[...state.agents].sort((a,b)=>b.score-a.score).map(a=>row(a)).join('')}`;
  if(document.querySelector('#ranked'))document.querySelector('#ranked').onclick=()=>{direct=false;updateSelection();};
  document.querySelectorAll('[data-hire]').forEach(b=>b.onclick=()=>purchase(b.dataset.hire));
  document.querySelector('#evidence').innerHTML = evidence(direct?'birch':'cedar', taskId);
}
async function purchase(agentId) {
  if (busy || taskType!=='summary') return;
  if (state.hosted && !state.authorized) { view='wallet'; shell(); toast('Enter the demo access code to enable real testnet purchases.'); return; }
  busy = true; updateSelection();
  try {
    current = await api('/api/purchases', { requestId: crypto.randomUUID(), taskType, taskId, budget, ...(agentId==='birch'&&!state.enrolled?{directAgent:'birch'}:{agentId}) });
    startPolling(current.id); renderRun(); document.querySelector('#run').scrollIntoView({ behavior:'smooth', block:'start' });
  } catch (e) { busy=false; toast(e.message); updateSelection(); }
}
function announcement() {
  const result=state.comparisons?.filter(c=>c.status==='complete').at(-1);
  const pool=[state.birch,...state.agents], challenger=pool.find(a=>a.id===(result?.challengerId||'birch')), opponent=result?.opponent||pool.find(a=>a.id==='atlas');
  const winner={...challenger,score:result?.challengerScore??94}, loser={...opponent,score:result?.opponentScore??70};
  return `<section class="announcement"><div class="announcement-mark">↗</div><div><div class="eyebrow">DISCOVERY ANNOUNCEMENT · SIMULATED</div><h2>${escape(winner.name)} outperformed ${escape(loser.name)}.</h2><p>${winner.score} vs ${loser.score} on the product launch benchmark. One scripted comparison; not a general superiority claim.</p></div><button class="secondary try-birch" data-winner="${winner.id}">Try this agent <span>↗</span><small>${money(winner.price+state.fee)} including fee</small></button></section>`;
}
function bindTry() { document.querySelectorAll('.try-birch').forEach(b => b.onclick = () => { const id=b.dataset.winner||'birch', agent=[state.birch,...state.agents].find(a=>a.id===id);direct=id==='birch'&&!state.enrolled; taskType='summary'; taskId='launch'; budget=String((agent.price+state.fee)/1e6); view='buyer'; current=null; shell(); }); }
function evidence() { return ''; }
function creatorPanel() {
  return `<section class="panel creator-panel"><div class="panel-heading"><div><div class="eyebrow">FOR AGENT CREATORS</div><h2>Add your agent to the benchmarks.</h2></div></div><label for="creator-model">Select model</label><select id="creator-model"><option value="new-agent" ${creatorModel==='new-agent'?'selected':''}>New Agent</option>${(registry?.agents||[]).slice(0,9).map(a=>`<option value="${escape(a.id)}" ${creatorModel===a.id?'selected':''}>${escape(a.name)}</option>`).join('')}</select><p class="fine">${registry?`Live Masumi Preprod registry · ${Math.min(9,registry.agents.length)} listings · refreshed ${new Date(registry.fetchedAt).toLocaleTimeString()}`:registryError?escape(registryError):'Loading real Masumi agents…'} <button class="text-button" id="refresh-registry">Refresh list</button></p><div id="creator-details"></div></section>`;
}
function creatorDetails(){
  const demo=creatorModel==='new-agent', chosen=registry?.agents.find(a=>a.id===creatorModel);
  document.querySelector('#creator-details').innerHTML=demo?`<div class="bill"><div><span>Summary benchmark · one model run</span><b>1.5 tADA</b></div><div><span>Compare with stored outputs</span><b>No extra charge</b></div></div><button class="primary full" id="add-agent" ${busy&&!state.enrolled?'disabled':''}>${state.enrolled?'Added ✓ · View benchmarks':busy?'Run in progress…':'Add agent · 1.5 tADA'} <span>→</span></button>${state.enrolled?'<div class="empty"><strong>Benchmark updated: Agent Birch (new) is #1.</strong><p>94/100, ahead of Cedar at 92. Saved for this browser’s demo session.</p><button class="secondary" id="view-benchmarks">View updated benchmarks →</button></div>':''}`:`<div class="empty"><strong>${escape(chosen?.name||'Masumi agent')}</strong><p>${escape(chosen?.description||'Real registry listing.')}</p><p>Live service execution is not connected in this MVP. Select New Agent to try the benchmark entry flow.</p></div><button class="primary full" id="add-agent" disabled>Add agent <span>→</span></button>`;
  const add=document.querySelector('#add-agent');if(add&&demo)add.onclick=async()=>{
    if(state.enrolled){view='buyer';taskType='summary';direct=false;current=null;shell();return;}
    if(busy)return;statusError=false;busy=true;creatorDetails();
    try{current=await api('/api/enrollments',{modelId:'new-agent'});state.enrollment=current;startPolling(current.id);renderCompare();document.querySelector('#run').scrollIntoView({behavior:'smooth',block:'start'});}catch(e){busy=false;toast(e.message);creatorDetails();}
  };
  const show=document.querySelector('#view-benchmarks');if(show)show.onclick=()=>{view='buyer';taskType='summary';direct=false;current=null;shell();};
  if(state.enrolled){
    document.querySelector('#creator-details').insertAdjacentHTML('beforeend','<button class="secondary" id="reset-benchmark">Reset benchmark · Remove New Agent</button>');
    document.querySelector('#reset-benchmark').onclick=resetBenchmark;
  }
}
async function resetBenchmark(){
  try{
    await api('/api/enrollments/reset',{});
    state=await api('/api/state');
    if(current?.type==='enrollment'){clearInterval(polling);current=null;busy=false;}
    direct=false;creatorModel='new-agent';shell();
    toast('New Agent removed from benchmarks. You can add it again.');
  }catch(e){toast(e.message);}
}
async function loadRegistry(){
  if(registryLoading)return;registryLoading=true;
  try{registry=await api('/api/masumi-agents');registryError='';}catch(e){registryError=e.message;}finally{registryLoading=false;}
  if(view==='compare')renderCompare();
}
function bindCreator(load=true){
  document.querySelector('#creator-model').onchange=e=>{creatorModel=e.target.value;creatorDetails();};
  document.querySelector('#refresh-registry').onclick=loadRegistry;creatorDetails();
  if(load&&!registry&&!registryError)void loadRegistry();
}
function renderCompare() {
  const opponents=(registry?.agents||[]).slice(0,10);
  if(!opponents.some(a=>a.id===opponentId))opponentId=opponents[0]?.id||'';
  const opponent=opponents.find(a=>a.id===opponentId);
  const challenger=[state.birch,...state.agents].find(a=>a.id===challengerId);
  if(state.enrollment && !current)current=state.enrollment;
  if(current?.type==='enrollment'&&current.status==='running'&&!busy&&!statusError){busy=true;startPolling(current.id);}
  document.querySelector('#content').innerHTML = `${state.announced?announcement():''}<div class="creator-challenge-grid">${creatorPanel()}<section class="panel"><div class="panel-heading"><h2>Newcomer challenge</h2></div><div class="matchup"><div><div class="avatar ${challenger.id} big">${challenger.initials}</div><label for="challenger-model">Challenger</label><select id="challenger-model" ${busy?'disabled':''}>${[state.birch,...state.agents.filter(a=>a.id!=='birch'&&a.id!=='atlas')].map(a=>`<option value="${a.id}" ${a.id===challengerId?'selected':''}>${escape(a.name)}</option>`).join('')}</select></div><span class="versus">vs</span><div><div class="avatar atlas big">M</div><label for="opponent-model">Masumi agent</label><select id="opponent-model" ${busy||!opponents.length?'disabled':''}>${opponents.length?opponents.map(a=>`<option value="${escape(a.id)}" ${a.id===opponentId?'selected':''}>${escape(a.name)}</option>`).join(''):'<option>Loading Masumi agents…</option>'}</select><p>Simulated ranking · #2</p></div></div><div class="bill"><div><span>One ${escape(challenger.name)} run</span><b>${money(challenger.price)}</b></div><div><span>One ${escape(opponent?.name||'Masumi agent')} run (simulated price)</span><b>3.0 tADA</b></div><div><span>Comparison service fee</span><b>0.2 tADA</b></div><div class="bill-total"><span>Simulated provider payment</span><b>${money(challenger.price+3000000+state.fee)}</b></div></div><button class="primary full" id="challenge" ${busy||!opponent?'disabled':''}>${busy?'Run in progress…':'Simulate payment & compare'} <span>→</span></button><p class="fine">Scripted demo: your challenger always wins. Scores and prices are simulated; no Masumi agent is run and no funds move.</p></section></div><div id="run"></div><div id="comparison-evidence"></div>`;
  bindCreator(); bindTry();
  document.querySelector('#opponent-model').onchange=e=>{opponentId=e.target.value;renderCompare();};
  document.querySelector('#challenger-model').onchange=e=>{challengerId=e.target.value;renderCompare();};
  document.querySelector('#challenge').onclick = async () => {
    if (busy) return;
    busy=true; renderCompare();
    try { current=await api('/api/comparisons',{challengerId,opponentId}); startPolling(current.id); renderRun(); } catch(e) { busy=false; toast(e.message); renderCompare(); }
  };
  renderRun();
}
function renderRun() {
  const target=document.querySelector('#run'); if (!target) return;
  if (!current) { target.innerHTML=''; return; }
  const comparison=current.type==='comparison', enrolling=current.type==='enrollment';
  target.innerHTML=`<section class="panel execution" aria-label="Execution timeline"><div class="panel-heading"><div><div class="eyebrow">${enrolling?'CREATOR → MASUMI → BENCHMARK':comparison?'PROVIDER COMPARISON · SIMULATED':'BUYER → AgentOnboard → PROVIDER'}</div><h2>${enrolling?'Adding your agent, step by step.':comparison?'The comparison, step by step.':'Your purchase, step by step.'}</h2></div>${pill(current.status, current.status==='complete'?'success':'outline')}</div><ol class="timeline">${current.events.map((event,i)=>`<li><span class="step-index">${String(i+1).padStart(2,'0')}</span><details ${i===current.events.length-1?'open':''}><summary>${escape(event.label)} ${pill(event.simulated?'simulated transaction with Masimu':'REAL TESTNET',event.simulated?'lavender':'success')}</summary><p>${escape(event.detail)}</p></details></li>`).join('')}</ol>${['running','queued','fulfilling'].includes(current.status)?'<div class="working"><span class="spinner"></span> Processing automatically…</div>':''}${current.status==='pending'?'<div class="empty"><strong>Awaiting network confirmation</strong><p>No summary is released until the original payment is confirmed.</p><button class="secondary" id="resume">Check confirmation</button></div>':''}${current.error?`<p class="error" role="alert">${escape(current.error)}</p>`:''}${current.receipt?.success?`<div class="receipt"><strong>Real testnet receipt</strong><a href="https://preprod.cardanoscan.io/transaction/${escape(current.receipt.transaction)}" target="_blank" rel="noopener">${escape(current.receipt.transaction)} ↗</a><small>Service ${money(current.total)} · Network fee ${(current.networkFee / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' tADA'} · Confirmed block inclusion</small></div>`:''}</section>${view==='buyer'&&current.result?`<section class="panel output-panel" aria-label="Output"><div class="panel-heading"><h2>Output</h2></div><div class="output-text"><p>${escape(current.result)}</p><button class="text-button" id="copy-result">Copy summary ↗</button></div></section>`:''}`;
  if(statusError){target.insertAdjacentHTML('beforeend','<button class="secondary" id="retry-status">Check progress</button>');document.querySelector('#retry-status').onclick=()=>{busy=true;startPolling(current.id);shell();};}
  if (document.querySelector('#copy-result')) document.querySelector('#copy-result').onclick=async()=>{await navigator.clipboard.writeText(current.result);toast('Summary copied.');};
  if (document.querySelector('#resume')) document.querySelector('#resume').onclick=async()=>{try {await api(`/api/jobs/${current.id}/resume`,{});busy=true;startPolling(current.id);}catch(e){toast(e.message);}};
}
function startPolling(id) {
  clearInterval(polling);
  let checking=false, failures=0;statusError=false;
  polling=setInterval(async()=>{
    if(checking)return;checking=true;
    try {
      current=await api(`/api/jobs/${id}`); if(current.type==="enrollment")state.enrollment=current; renderRun();
      if(['complete','failed','pending'].includes(current.status)) {
        state=await api('/api/state');clearInterval(polling);busy=false;statusError=false;
        if(view==='compare')renderCompare();else if(view==='buyer')renderBuyer();else shell();
        if(current.status==='complete')void refreshWallet().catch(()=>{});
      }
    }catch(e){if(++failures>=3){clearInterval(polling);busy=false;statusError=true;shell();toast("Connection interrupted. Check progress to finish updating this run.");}}finally{checking=false;}
  },650);
}
async function refreshWallet() {
  wallet=await api('/api/wallet');
  const indicator=document.querySelector('.wallet-button');
  if(indicator) indicator.innerHTML=`<span class="live-dot ${wallet.ready?'':'muted-dot'}"></span>${wallet.ready?`${money(wallet.balance)} · Test wallet`:'Test wallet setup'}`;
  if(view==='wallet')renderWallet();
}
function renderWallet() {
  document.querySelector('#content').innerHTML=`<section class="panel wallet-panel"><div class="panel-heading"><h2>Dedicated buyer wallet</h2>${pill(wallet?.ready?'Funded':'Funding required',wallet?.ready?'success':'outline')}</div><p>The demo automatically signs service purchases with this wallet. Its keys stay on the local server.</p><dl class="wallet-details"><dt>Network</dt><dd>Cardano preprod · test funds only</dd><dt>Balance</dt><dd>${wallet?.balance===undefined?'Checking…':money(wallet.balance)}</dd><dt>Buyer address</dt><dd class="address">${escape(wallet?.buyerAddress||'Run npm run wallet to create the dedicated wallet.')}</dd><dt>Service recipient</dt><dd class="address">${escape(wallet?.sellerAddress||'Not configured')}</dd><dt>Provider</dt><dd>${escape(wallet?.provider||'Public Koios preprod')}</dd></dl>${wallet?.reason?`<div class="empty">${escape(wallet.reason)}</div>`:''}<div class="wallet-actions"><a class="primary" href="https://faucet.preprod.world.dev.cardano.org/basic-faucet" target="_blank" rel="noopener">Get free test ADA ↗</a><button class="secondary" id="refresh-wallet">Refresh balance</button><button class="secondary" id="copy-address">Copy buyer address</button></div><p class="fine">The faucet may require a human CAPTCHA. Budget covers provider price + service fee. Network fees are additional, capped at 1 tADA. The actual fee is recorded in the payment timeline.</p><div class="method-note"><p><strong>Payment integration</strong><br>Cardano x402 exact address-payment flow, as documented by Masumi. No Masumi escrow or registry registration is claimed. All model identities and outputs are demo fixtures.</p></div></section>`;
  if(state.hosted) {
    document.querySelector('.wallet-panel').insertAdjacentHTML('afterbegin', `<div class="access-panel"><h2>${state.authorized?'Real payments unlocked':'Unlock real testnet payments'}</h2><p>${state.authorized?'Your access lasts for two hours in this browser.':'Rankings and simulated comparisons are public. An access code is required to spend from the shared test wallet.'}</p>${state.authorized?'':`<form id="unlock-form"><label for="access-code">Demo access code</label><div class="access-input"><input id="access-code" type="password" autocomplete="off" required maxlength="100"><button class="primary" type="submit">Unlock payments</button></div></form>`}<p class="fine">Shared demo spend cap: 20 tADA including network-fee reserves. No mainnet funds.</p></div>`);
    if(document.querySelector('#unlock-form'))document.querySelector('#unlock-form').onsubmit=async e=>{
      e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;
      try{await api('/api/unlock',{code:document.querySelector('#access-code').value});state=await api('/api/state');view='buyer';shell();toast('Real testnet payments unlocked for two hours.');}catch(error){toast(error.message);button.disabled=false;}
    };
    const paragraph=document.querySelector('.wallet-panel>p');
    if(paragraph)paragraph.textContent='The demo automatically signs approved purchases. Signing keys are held only in server-side deployment secrets.';
  }
  document.querySelector('#refresh-wallet').onclick=async()=>{document.querySelector('#refresh-wallet').disabled=true;try{await refreshWallet();toast(wallet.ready?'Wallet is funded.':'Wallet checked.');}catch(e){toast(e.message);}};
  document.querySelector('#copy-address').onclick=async()=>{if(wallet?.buyerAddress){await navigator.clipboard.writeText(wallet.buyerAddress);toast('Buyer address copied.');}};
}
function renderActivity() {
  const jobs=state.jobs.slice().reverse();
  document.querySelector('#content').innerHTML=`<section class="panel"><div class="panel-heading"><h2>Buyer purchases</h2>${pill('Persistent receipts','outline')}</div>${jobs.length?jobs.map(j=>`<button class="activity-row" data-job="${j.id}"><div><strong>${escape([...state.agents,state.birch].find(a=>a.id===j.agentId)?.name)}</strong><small>${escape(new Date(j.createdAt).toLocaleString())}</small></div><span>${money(j.total)}</span>${pill(j.status,j.status==='complete'?'success':'outline')}<span>↗</span></button>`).join(''):'<div class="empty"><strong>No buyer payments yet.</strong><p>Choose a sample text and hire an agent to start a real testnet purchase.</p></div>'}</section><div id="run"></div>`;
  document.querySelectorAll('[data-job]').forEach(b=>b.onclick=async()=>{current=await api(`/api/jobs/${b.dataset.job}`);renderRun();if(['running','queued','fulfilling'].includes(current.status))startPolling(current.id);});renderRun();
}
try { state=await api('/api/state');shell();void api('/api/wallet').then(w=>{wallet=w;if(!busy)shell();}).catch(()=>toast('Wallet status unavailable.')); }
catch { app.innerHTML='<main><div class="empty"><h1>Workbench unavailable</h1><p>Start the local server and reload this page.</p></div></main>'; }

