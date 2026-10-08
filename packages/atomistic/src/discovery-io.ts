import {PublicResearchNetwork} from "../../agent/src/papers/network.js";
import {constants,existsSync,lstatSync,mkdirSync,readFileSync,renameSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export function canonical(v:unknown):string {if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v as object).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';}
export function safeDirectory(base:string,name:string){if(!/^[a-z0-9.-]+$/.test(name))throw Error('UNSAFE_DISCOVERY_DIRECTORY');mkdirSync(base,{recursive:true});if(lstatSync(base).isSymbolicLink())throw Error('UNSAFE_DISCOVERY_DIRECTORY');const p=join(base,name);mkdirSync(p,{recursive:true});if(lstatSync(p).isSymbolicLink())throw Error('UNSAFE_DISCOVERY_DIRECTORY');return p;}
export function ownedText(path:string,maxBytes=8*1024*1024){const s=lstatSync(path);if(s.isSymbolicLink()||!s.isFile()||s.size>maxBytes)throw Error('UNSAFE_DISCOVERY_FILE');const f=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{return readFileSync(f,'utf8');}finally{closeSync(f);}}
export function atomicJson(dir:string,name:string,value:unknown){if(!/^[a-z0-9.-]+\.json$/.test(name))throw Error('UNSAFE_DISCOVERY_FILE');const tmp=join(dir,name+'.tmp');if(existsSync(tmp)&&lstatSync(tmp).isSymbolicLink())throw Error('UNSAFE_DISCOVERY_FILE');const f=openSync(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);try{writeFileSync(f,JSON.stringify(value,null,2)+'\n');fsyncSync(f);}finally{closeSync(f);}renameSync(tmp,join(dir,name));}
const hosts=new Set(['huggingface.co','api.github.com','github.com','raw.githubusercontent.com','release-assets.githubusercontent.com','objects.githubusercontent.com','export.arxiv.org','arxiv.org','query.openkim.org','openkim.org','www.ctcms.nist.gov']);
/** No user-supplied URL and no private/project content; fail closed on redirects and size. */
export async function fetchMetadata(url:string,network:typeof fetch=fetch,options:{etag?:string;signal?:AbortSignal;body?:URLSearchParams;maxBytes?:number}={}){
 const source=new URL(url);
 if(['export.arxiv.org','arxiv.org'].includes(source.hostname)){
  if(options.body)throw Error('ARXIV_POST_NOT_SUPPORTED');
  const r=await new PublicResearchNetwork(network).get(url,Math.min(options.maxBytes??4*1024*1024,32*1024*1024),options.signal);
  return {status:200,text:r.bytes.toString('utf8'),etag:null};
 }
 const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
 for(let n=0;n<5;n++){
  const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.has(u.hostname))throw Error('METADATA_SOURCE_NOT_APPROVED');
  const headers:Record<string,string>={'User-Agent':'MaterialsX-Potential-Hub/0.0.1','Accept':'application/json, application/atom+xml, text/html'};if(options.etag)headers['If-None-Match']=options.etag;if(options.body)headers['Content-Type']='application/x-www-form-urlencoded';
  const r=await network(url,{redirect:'manual',signal,headers,...(options.body?{method:'POST',body:options.body}:{})});
  if([301,302,303,307,308].includes(r.status)){const next=r.headers.get('location');await r.body?.cancel();if(!next)throw Error('METADATA_REDIRECT_INVALID');url=new URL(next,url).href;continue;}
  if(r.status===304||r.status===404){await r.body?.cancel();return {status:r.status,text:'',etag:r.headers.get('etag')};}
  if(!r.ok||!r.body){await r.body?.cancel();throw Error(r.status===403||r.status===429?'METADATA_RATE_LIMIT':'METADATA_HTTP_FAILED');}
  const parts:Uint8Array[]=[];let size=0;for await(const b of r.body){size+=b.length;if(size>Math.min(options.maxBytes??4*1024*1024,32*1024*1024)){await r.body.cancel().catch(()=>{});throw Error('METADATA_SIZE_LIMIT');}parts.push(b);}
  return {status:r.status,text:Buffer.concat(parts).toString('utf8'),etag:r.headers.get('etag')};
 }
 throw Error('METADATA_REDIRECT_LIMIT');
}
