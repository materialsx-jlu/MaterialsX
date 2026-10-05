import {setTimeout as delay} from 'node:timers/promises';
/** Shared by all ResearchService instances/engines in this desktop process, including PDF fetches. */
export class SerialSourceQueue {
  private tail:Promise<unknown>=Promise.resolve();private next=0;
  constructor(private interval=3000){}
  run<T>(job:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
    const result=this.tail.catch(()=>{}).then(async()=>{signal?.throwIfAborted();
      // Timers can wake early. Recheck the monotonic deadline before consuming a source request.
      while(performance.now()<this.next)await delay(Math.ceil(this.next-performance.now()),undefined,signal?{signal}:{});
      signal?.throwIfAborted();this.next=performance.now()+this.interval;return job();});this.tail=result.catch(()=>{});return result;
  }
}
export const arxivQueue=new SerialSourceQueue();
export const crossrefQueue=new SerialSourceQueue(1000);
export async function boundedBody(response:Response,limit:number,signal?:AbortSignal):Promise<Buffer>{
  if(Number(response.headers.get('content-length'))>limit)throw Error('SOURCE_SIZE_LIMIT');
  const reader=response.body?.getReader();if(!reader)throw Error('SOURCE_BODY_MISSING');let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){signal?.throwIfAborted();const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>limit)throw Error('SOURCE_SIZE_LIMIT');chunks.push(r.value);}return Buffer.concat(chunks,size);}finally{await reader.cancel().catch(()=>{});}
}
export class PublicResearchNetwork {
  private flights=new Map<string,{promise:Promise<{bytes:Buffer;contentType:string;url:string}>;controller:AbortController;users:number}>();
  constructor(private request:typeof fetch=fetch,private queue=arxivQueue,private crossref=crossrefQueue){}
  get(url:string,limit:number,signal?:AbortSignal):Promise<{bytes:Buffer;contentType:string;url:string}>{
    signal?.throwIfAborted();const key=url+':'+limit;let flight=this.flights.get(key);
    if(!flight){const controller=new AbortController();const promise=this.requestOne(url,limit,controller.signal);flight={promise,controller,users:0};this.flights.set(key,flight);void promise.finally(()=>{if(this.flights.get(key)?.promise===promise)this.flights.delete(key);}).catch(()=>{});}
    const shared=flight;shared.users++;
    return new Promise((resolve,reject)=>{let done=false;const finish=(value:unknown,failed=false)=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);shared.users--;if(!shared.users&&this.flights.get(key)===shared)shared.controller.abort();failed?reject(value):resolve(value as {bytes:Buffer;contentType:string;url:string});};
      const abort=()=>finish(signal?.reason??Error('CANCELLED'),true);signal?.addEventListener('abort',abort,{once:true});shared.promise.then(v=>finish(v),e=>finish(e,true));if(signal?.aborted)abort();});
  }
  private async requestOne(url:string,limit:number,signal?:AbortSignal):Promise<{bytes:Buffer;contentType:string;url:string}>{
    const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||!['export.arxiv.org','arxiv.org','api.crossref.org','info.arxiv.org','www.crossref.org','docs.python.org'].includes(parsed.hostname))throw Error('SOURCE_URL_NOT_ALLOWED');
    const queue=parsed.hostname==='api.crossref.org'||parsed.hostname==='www.crossref.org'?this.crossref:this.queue;
    for(let attempt=0;attempt<3;attempt++){
      try{return await queue.run(async()=>{
        const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000);
        const response=await this.request(url,{signal:combined,redirect:'error',credentials:'omit',headers:{'User-Agent':'MaterialsX/UA.6 (research; https://github.com/materialsx-jlu/MaterialsX)','Accept':parsed.hostname==='api.crossref.org'?'application/json':'*/*'}});
        if(!response.ok){const retry=[429,502,503,504].includes(response.status);const e=Object.assign(Error('SOURCE_HTTP_'+response.status),{retry,after:response.headers.get('retry-after')});await response.body?.cancel();throw e;}
        return {bytes:await boundedBody(response,limit,combined),contentType:response.headers.get('content-type')??'',url};
      },signal);}catch(error){signal?.throwIfAborted();const e=error as Error&{retry?:boolean;after?:string|null};if(!e.retry||attempt===2)throw e;
        const seconds=Number(e.after),wait=Number.isFinite(seconds)&&seconds>0?seconds*1000:e.after?Date.parse(e.after)-Date.now():3000*(attempt+1);
        if(wait>30000)throw Error('SOURCE_RETRY_DEFERRED');await delay(Math.max(3000,wait||3000),undefined,signal?{signal}:{});
      }
    }throw Error('SOURCE_UNAVAILABLE');
  }
}
