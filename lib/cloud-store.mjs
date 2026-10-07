import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
const KEY = 'blindbench/payment-ledger-v1.json';
const empty = () => ({ jobs: {}, active: null, spent: 0 });
export function blobStore() {
  async function read() {
    // Compression weakens the HTTP ETag; CAS needs the original strong ETag.
    const result = await get(KEY, { access:'private', useCache:false, headers:{'Accept-Encoding':'identity'} });
    if (!result) return { data:empty(), etag:null };
    return { data:await new Response(result.stream).json(), etag:result.blob.etag };
  }
  return {
    async read() { return (await read()).data; },
    async change(mutator) {
      for(let attempt=0;attempt<8;attempt++) {
        const {data,etag}=await read();
        const result=mutator(data);
        try {
          await put(KEY,JSON.stringify(data),{access:'private',addRandomSuffix:false,contentType:'application/json',...(etag?{allowOverwrite:true,ifMatch:etag}:{allowOverwrite:false})});
          return result;
        } catch(e) {
          if (!(e instanceof BlobPreconditionFailedError) && !/already exists/i.test(e.message)) throw e;
          await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));
        }
      }
      throw new Error('The payment ledger is busy. Try again shortly.');
    },
  };
}
