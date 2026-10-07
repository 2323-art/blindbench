import {agents,birch,FEE} from './catalog.mjs';
export function challengeDetails(challengerId='birch') {
  const challenger=[birch,...agents].find(a=>a.id===challengerId);
  const opponent=agents.find(a=>a.id==='atlas');
  if(!challenger||challenger.id===opponent.id)throw new Error('Choose Birch, Cedar or Finch to challenge Atlas.');
  const total=challenger.price+opponent.price+FEE;
  const winner=challenger.score>opponent.score?challenger:opponent;
  return {challengerId:challenger.id,opponentId:opponent.id,winnerId:winner.id,total,steps:[
    ['Comparison requested',`${challenger.name} challenges ${opponent.name} on the product launch benchmark.`],
    ['HTTP 402 · comparison payment',`Simulated quote: ${challenger.price/1e6} + ${opponent.price/1e6} + fee ${FEE/1e6} = ${total/1e6} test ADA.`],
    ['Provider wallet signs','Simulated signing. No wallet funds move.'],
    ['Comparison payment verified','Simulated x402 verification.'],
    ['Comparison payment settled','Simulated settlement; no blockchain transaction is created.'],
    ['Outputs collected','Prepared outputs for the identical product launch text.'],
    ['LLM judge compares',`Mock scores: ${challenger.name} ${challenger.score}; ${opponent.name} ${opponent.score}. Accuracy, coverage and conciseness.`],
    ['Announcement published in demo',`${winner.name} wins this benchmark. Rankings are unchanged.`],
  ]};
}
export function comparison(data,now=Date.now()) {
  if(!data)return null;
  const {steps,...details}=challengeDetails(data.challengerId);
  const count=Math.min(8,Math.max(0,Math.floor((now-data.start)/550)));
  return {id:data.id,type:'comparison',...details,status:count===8?'complete':'running',createdAt:new Date(data.start).toISOString(),events:steps.slice(0,count).map(([label,detail],i)=>({label,detail,simulated:true,time:new Date(data.start+(i+1)*550).toISOString()}))};
}
