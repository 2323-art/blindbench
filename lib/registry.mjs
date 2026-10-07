let cache;
export async function listMasumiAgents() {
  if(cache && Date.now()-cache.fetchedAt<300000)return cache;
  const response=await fetch('https://registry.masumi.network/api/v1/registry-entry/',{
    method:'POST',headers:{'Content-Type':'application/json',token:'public-test-key-masumi-registry-c23f3d21'},
    body:JSON.stringify({network:'Preprod',limit:9}),signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw new Error('Masumi registry unavailable');
  const body=await response.json();
  if(!Array.isArray(body.data?.entries))throw new Error('Unexpected registry response');
  cache={fetchedAt:Date.now(),source:'Masumi public registry · Preprod',agents:body.data.entries.slice(0,9).map(a=>({id:a.id,name:String(a.name).slice(0,160),description:String(a.description||'').slice(0,500),status:a.status}))};
  return cache;
}
