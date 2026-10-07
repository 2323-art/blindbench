import {agents,birch,tasks} from './catalog.mjs';
export const enrollmentSteps=[
  ['Agent submitted','New Agent enters the Summary benchmark under the masked name Agent Birch (new).'],
  ['HTTP 402 · Masumi run requested','Simulated Masumi payment request: 1.5 test ADA for one model run. No comparison fee.'],
  ['Creator payment signed','Simulated creator wallet signature for the one-run price.'],
  ['Payment sent to Masumi','Simulated PAYMENT-SIGNATURE retry; no funds are transferred.'],
  ['Payment verified and settled','Simulated x402 receipt accepted. No blockchain transaction exists.'],
  ['Agent service run completed','Prepared summary output collected for the product launch benchmark.'],
  ['Output compared','Mock LLM judge compares the output against stored benchmark outputs: Birch 94, Cedar 92, Atlas 86, Finch 78.'],
  ['Benchmark rankings updated','Agent Birch (new) is ranked #1 in this browser’s Summary benchmark.'],
];
export function enrollment(data,now=Date.now()){
  if(!data)return null;
  const count=Math.min(enrollmentSteps.length,Math.max(0,Math.floor((now-data.start)/800)));
  return {id:data.id,type:'enrollment',status:count===8?'complete':'running',total:1500000,createdAt:new Date(data.start).toISOString(),events:enrollmentSteps.slice(0,count).map(([label,detail],i)=>({label,detail,simulated:true,time:new Date(data.start+(i+1)*800).toISOString()})),...(count===8?{result:tasks[0].outputs.birch}:{})};
}
export function benchmarkAgents(enrolled=false){
  return (enrolled?[...agents,{...birch,status:'Benchmarked newcomer'}]:[...agents]).sort((a,b)=>b.score-a.score).map((a,i)=>({...a,rank:i+1}));
}
