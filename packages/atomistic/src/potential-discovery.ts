import {existsSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {discoverySourcesSchema,observationSchema,discoveryRecordSchema,discoverySearchSchema,discoveryReviewSchema,type DiscoverySource,type Observation} from '../../contracts/src/potential-discovery.js';
import {type PotentialCatalog} from '../../contracts/src/potential-hub.js';
import {atomicJson,canonical,fetchMetadata,hash,ownedText,safeDirectory} from './discovery-io.js';
const clean=(v:unknown,max=1600)=>String(v??'').replace(/<[^>]*>/g,' ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/\s+/g,' ').trim().slice(0,max);
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const decode=(s:string)=>s.replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,v:string)=>{const n=v[0]?.toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';}).replace(/&(amp|lt|gt|quot|apos);/g,(_,v:string)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[v]??''));
const xml=(s:string,k:string)=>decode(s.match(new RegExp(`<${k}(?:\\s[^>]*)?>([\\s\\S]*?)</${k}>`))?.[1]??'');
const ghAsset=z.object({id:z.number().int().positive(),name:z.string(),browser_download_url:z.url(),size:z.number().int().nonnegative(),digest:z.string().nullable().optional(),state:z.string()});
const ghRelease=z.object({id:z.number().int().positive(),tag_name:z.string(),name:z.string().nullable(),html_url:z.url(),body:z.string().nullable(),draft:z.boolean(),prerelease:z.boolean(),published_at:z.string().nullable(),created_at:z.string(),assets:z.array(ghAsset)});
/** Source text is evidence only. No capability/element/license inference or source code evaluation. */
export function parseDiscoverySource(source:DiscoverySource,body:string):Observation[]{
 const snapshotSha256=hash(body),base={sourceId:source.id,publishedAt:null,updatedAt:null,status:'active' as const,access:'public' as const,asset:null,doi:null,arxivId:null,license:null,excerpt:'',snapshotSha256};
 const out:unknown[]=[];
 if(source.kind==='github_release'){
  const repo=new URL(source.url).pathname.match(/^\/repos\/([^/]+\/[^/]+)\/releases$/)?.[1];if(!repo)throw Error('SOURCE_CONFIGURATION_INVALID');
  for(const r of z.array(ghRelease).max(100).parse(JSON.parse(body))){if(r.draft)continue;const releaseUrl=`https://github.com/${repo}/releases/tag/${encodeURIComponent(r.tag_name)}`;
   if(r.html_url!==releaseUrl)throw Error('SOURCE_ORIGIN_MISMATCH');const excerpt=clean(r.body);
   const assets=r.assets.filter(a=>a.state==='uploaded'&&/\.(pth|pt|ckpt|model|bin|safetensors|npz|zip|tar|gz|xml|txt)$/i.test(a.name));
   if(!assets.length)out.push({...base,identity:`github:${source.id}:release:${r.id}`,kind:'code',title:clean(r.name||r.tag_name,1024),url:r.html_url,revision:r.tag_name,publishedAt:date(r.published_at??r.created_at),excerpt:clean((r.prerelease?'Prerelease. ':'')+excerpt)});
   for(const a of assets){if(!a.browser_download_url.startsWith(`https://github.com/${repo}/releases/download/`))throw Error('SOURCE_ORIGIN_MISMATCH');
    const digest=a.digest?.match(/^sha256:([a-f0-9]{64})$/)?.[1]??null;
    out.push({...base,identity:`github:${source.id}:asset:${a.id}`,kind:'checkpoint',title:clean(a.name,1024),url:r.html_url,revision:r.tag_name,publishedAt:date(r.published_at??r.created_at),asset:{url:a.browser_download_url,sha256:digest,bytes:a.size||null},excerpt:clean((r.prerelease?'Prerelease. ':'')+excerpt)});
   }
  }
 }else if(source.kind==='github_commits'){
  const rows=z.array(z.object({sha:z.string().regex(/^[a-f0-9]{40}$/),html_url:z.url(),commit:z.object({message:z.string(),committer:z.object({date:z.string()})})})).max(100).parse(JSON.parse(body));
  const repo=new URL(source.url).pathname.match(/^\/repos\/([^/]+\/[^/]+)\/commits$/)?.[1];
  for(const r of rows){if(r.html_url!==`https://github.com/${repo}/commit/${r.sha}`)throw Error('SOURCE_ORIGIN_MISMATCH');out.push({...base,identity:`github:${source.id}:commit:${r.sha}`,kind:'code',title:clean(r.commit.message,1024),url:r.html_url,revision:r.sha,publishedAt:date(r.commit.committer.date)});}
 }else if(source.kind==='arxiv'){
  if(/<!DOCTYPE|<!ENTITY/i.test(body)||!body.includes('http://www.w3.org/2005/Atom')||!/<feed[\s>]/.test(body)||!/<\/feed>/.test(body))throw Error('PAPER_FEED_INVALID');
  const entries=body.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/g)??[];if(entries.length>100)throw Error('PAPER_FEED_SIZE_LIMIT');
  for(const e of entries){const id=xml(e,'id').match(/^https?:\/\/arxiv.org\/abs\/([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?)$/)?.[1];if(!id)throw Error('PAPER_ID_INVALID');const arxivId=id.replace(/v[0-9]+$/,''),title=clean(xml(e,'title'),1024);
   if(!/interatomic|machine.learning.potential|neural.*potential|force.field|equivariant|atomistic|foundation.*material/i.test(title))continue;
   const doi=xml(e,'arxiv:doi').trim().toLowerCase()||null;out.push({...base,identity:`arxiv:${arxivId}`,kind:'paper',title,url:`https://arxiv.org/abs/${id}`,revision:id,publishedAt:date(xml(e,'published')),updatedAt:date(xml(e,'updated')),arxivId,doi,excerpt:clean(xml(e,'summary'))});
  }
 }else if(source.kind==='huggingface'){
  const author=new URL(source.url).searchParams.get('author');
  const rows=z.array(z.object({id:z.string(),sha:z.string().regex(/^[a-f0-9]{40}$/),private:z.boolean(),gated:z.union([z.boolean(),z.string()]).optional(),lastModified:z.string()})).max(100).parse(JSON.parse(body));
  for(const r of rows){if(r.private)continue;if(!r.id.startsWith(author+'/')||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r.id))throw Error('SOURCE_ORIGIN_MISMATCH');out.push({...base,identity:'huggingface:'+r.id,kind:'repository',title:r.id,url:'https://huggingface.co/'+r.id,revision:r.sha,updatedAt:date(r.lastModified),access:r.gated?'gated':'public',excerpt:'Official multi-file model repository. Commit SHA identifies repository metadata, not individual weight hashes. Asset set, dependency profile, license and scientific domain need separate review.'});}
 }else if(source.kind==='openkim'){
  const rows=z.array(z.record(z.string(),z.unknown())).max(100).parse(JSON.parse(body));
  for(const r of rows){const id=String(r['kimcode']??r['extended-id']??'');if(!/^[A-Za-z0-9_.-]+__(?:MO|MD)_[0-9]{12}_[0-9]{3}$/.test(id))continue;
   const title=clean(r['title']??id,1024);out.push({...base,identity:`openkim:${id}`,kind:'repository',title,url:`https://openkim.org/id/${id}`,revision:id,publishedAt:date(r['publication-year']?`${r['publication-year']}-01-01`:null),excerpt:clean(r['description'])});
  }
 }else if(source.kind==='nist'){
  const links=[...body.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];const seen=new Set<string>();
  for(const l of links){const u=new URL(decode(l[1]!),source.url);if(u.origin!=='https://www.ctcms.nist.gov'||!u.pathname.startsWith('/potentials/entry/')||!u.pathname.endsWith('.html')||seen.has(u.href))continue;seen.add(u.href);if(seen.size>100)break;const title=clean(decode(l[2]!),1024)||u.pathname.split('/').at(-2)!;
   out.push({...base,identity:`nist:${u.pathname}`,kind:'repository',title,url:u.href,revision:snapshotSha256,excerpt:'NIST registry entry; type, code, model weights, license and scientific scope require separate review.'});
  }
  if(!out.length)out.push({...base,identity:'nist:repository-index',kind:'repository',title:'NIST Interatomic Potentials Repository',url:source.url,revision:snapshotSha256,excerpt:'Repository index snapshot only. Individual model entries are not advertised as discovered weights.'});
 }
 return out.map(o=>observationSchema.parse(o));
}
const sourceState=z.strictObject({id:z.string(),lastAttempt:z.iso.datetime().nullable(),lastSuccess:z.iso.datetime().nullable(),etag:z.string().nullable(),snapshotSha256:z.string().nullable(),error:z.string().nullable(),count:z.number().int().nonnegative()});
const stateSchema=z.strictObject({version:z.literal('m6.11-v1'),sources:z.array(sourceState),records:z.array(discoveryRecordSchema).max(5000)});
type DiscoveryState=z.infer<typeof stateSchema>;
export class PotentialDiscoveryService{
 readonly sources:DiscoverySource[];private state:DiscoveryState;private readonly dir:string;private readonly snapshots:string;
 private cacheError:string|null=null;private controller:AbortController|null=null;private changed:()=>void=()=>{};
 constructor(root:string,userData:string,private catalog:()=>PotentialCatalog,private network:typeof fetch=fetch,private clock:()=>number=Date.now){
  this.sources=discoverySourcesSchema.parse(JSON.parse(ownedText(join(root,'models/potentials/discovery-sources.json')))).sources;
  this.dir=safeDirectory(userData,'potential-discovery');this.snapshots=safeDirectory(this.dir,'snapshots');
  this.state={version:'m6.11-v1',sources:[],records:[]};
  const stateFile=join(this.dir,'state.json');if(existsSync(stateFile))try{this.state=stateSchema.parse(JSON.parse(ownedText(stateFile,32*1048576)));}catch{this.cacheError='DISCOVERY_CACHE_INVALID';renameSync(stateFile,join(this.dir,'state.invalid-'+this.clock()+'.json'));}

 }
 onChanged(fn:()=>void){this.changed=fn;}
 status(){return {version:'m6.11-v1',busy:!!this.controller,cacheError:this.cacheError,total:this.state.records.length,pending:this.state.records.filter(r=>r.review.status==='pending').length,sources:this.sources.map(s=>({...s,...this.state.sources.find(v=>v.id===s.id)})),networkScope:'fixed-public-metadata',executionAuthority:false};}
 search(input:unknown){const q=discoverySearchSchema.parse(input),tokens=q.query.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);const rows=this.state.records.filter(r=>tokens.every(t=>[r.observation.title,r.description.zh,r.description.en,...r.sourceIds,r.observation.doi??'',r.observation.arxivId??''].join(' ').toLowerCase().includes(t))&&(q.status==='all'||q.status==='withdrawn'&&r.observation.status==='withdrawn'||q.status==='paper_only'&&r.observation.kind==='paper'||q.status===r.review.status));return {total:rows.length,offset:q.offset,records:rows.slice(q.offset,q.offset+q.limit).map(r=>structuredClone(r)),executionAuthority:false};}
 get(id:string){const r=this.state.records.find(r=>r.id===id);if(!r)throw Error('UNKNOWN_DISCOVERY_ID');return structuredClone(r);}
 readEvidence(id:string){const r=this.get(id),p=join(this.snapshots,r.observation.snapshotSha256+'.json');const blob=JSON.parse(ownedText(p));if(hash(blob.text)!==r.observation.snapshotSha256)throw Error('DISCOVERY_EVIDENCE_CHANGED');return {id,untrustedSourceMaterial:true,url:r.observation.url,snapshotSha256:r.observation.snapshotSha256,title:r.observation.title,excerpt:r.observation.excerpt,executionAuthority:false};}
 private save(){atomicJson(this.dir,'state.json',this.state);this.changed();}
 ingest(observations:Observation[]){let changes=0;const c=this.catalog(),now=new Date(this.clock()).toISOString();
  for(const raw of observations){const o=observationSchema.parse(raw),source=this.sources.find(s=>s.id===o.sourceId);if(!source)throw Error('UNKNOWN_DISCOVERY_SOURCE');
   const content=hash(canonical({...o,snapshotSha256:null,sourceId:null}));let r=this.state.records.find(v=>v.identity===o.identity||(o.doi&&v.observation.doi===o.doi));
   if(r?.contentSha256===content){if(!r.sourceIds.includes(o.sourceId)){r.sourceIds.push(o.sourceId);changes++;}continue;}
   const matched=c.entries.filter(e=>o.asset&&e.asset.url===o.asset.url);const historical=r?.relation==='same_official_asset'&&r.identity===o.identity?c.entries.filter(e=>r.relatedCatalogIds.includes(e.id)):[];const exact=matched.length?matched:historical;const papers=o.kind==='paper'?c.entries.filter(e=>e.sources.some(s=>o.doi&&s.url.toLowerCase()===('https://doi.org/'+o.doi.toLowerCase())||o.arxivId&&s.url.replace(/v[0-9]+$/,'').endsWith('/abs/'+o.arxivId))):[];const family=this.sources.find(s=>s.id===o.sourceId)!.family;const related=exact.length?exact.map(e=>e.id):papers.length?papers.map(e=>e.id):source.relatedCatalogIds.filter(id=>c.entries.some(e=>e.id===id));
   const description={zh:`${family} ${o.kind==='paper'?'论文线索（无可执行权重）':o.kind==='checkpoint'?'官方权重候选':'官方资源更新'}：${o.title}。中英说明草稿；许可、依赖与适用域待审核。`,en:`${family} ${o.kind==='paper'?'paper-only lead':o.kind==='checkpoint'?'official checkpoint candidate':'official resource update'}: ${o.title}. Draft metadata; license, dependencies and scientific scope need review.`};
   const examples=[{zh:`查看 ${o.title} 的来源证据和版本；未审核或未适配时不要执行。`,en:`Inspect the source evidence and version of ${o.title}; do not run an unreviewed or unadapted resource.`},{zh:`对比 ${o.title} 与已收录资源的权重身份及适用范围，列出待核实事项。`,en:`Compare ${o.title} with existing resource identities and domains and list unverified fields.`}];
   const change=!r?'created':o.status==='withdrawn'?'withdrawn':r.observation.license!==o.license?'license_changed':r.observation.title!==o.title?'renamed':'updated';
   const updated=discoveryRecordSchema.parse({id:r?.id??'discovery-'+hash(o.identity).slice(0,24),identity:r?.identity??o.identity,sourceIds:[...new Set([...(r?.sourceIds??[]),o.sourceId])],observation:o,contentSha256:content,description,examples,relatedCatalogIds:related,relation:exact.length?'same_official_asset':papers.length?'same_paper':o.doi&&r?.observation.doi===o.doi?'same_doi':related.length?'family_only':'unlinked',firstSeen:r?.firstSeen??now,lastChanged:now,change,history:r?[...r.history,{sha256:r.contentSha256,at:r.lastChanged,change:r.change}].slice(-100):[],review:{status:'pending',reviewer:null,note:null,sha256:null}});
   if(r)this.state.records[this.state.records.indexOf(r)]=updated;else {if(this.state.records.length>=5000)throw Error('DISCOVERY_RECORD_LIMIT');this.state.records.push(updated);}changes++;
  }
  if(changes)this.save();return changes;
 }
 /** Maintainer CLI only. The public desktop cannot approve or sign catalog entries. */
 review(input:unknown){const q=discoveryReviewSchema.parse(input),r=this.state.records.find(v=>v.id===q.id);if(!r||r.contentSha256!==q.sha256)throw Error('STALE_DISCOVERY_REVIEW');r.review={status:q.decision,sha256:q.sha256,reviewer:q.reviewer,note:q.note};this.save();return this.get(q.id);}
 async sync(ids?:string[],force=false){if(this.controller)throw Error('DISCOVERY_SYNC_BUSY');if(ids?.some(id=>!this.sources.some(s=>s.id===id)))throw Error('UNKNOWN_DISCOVERY_SOURCE');const controller=new AbortController();this.controller=controller;this.changed();let changes=0;
  try{for(const source of this.sources){if(!source.enabled||ids&&!ids.includes(source.id))continue;let s=this.state.sources.find(s=>s.id===source.id);if(!s){s={id:source.id,lastAttempt:null,lastSuccess:null,etag:null,snapshotSha256:null,error:null,count:0};this.state.sources.push(s);}if(!force&&s.lastAttempt&&this.clock()-Date.parse(s.lastAttempt)<source.intervalHours*3600000)continue;
    s.lastAttempt=new Date(this.clock()).toISOString();try{controller.signal.throwIfAborted();const u=new URL(source.url);if(source.kind==='github_release')u.searchParams.set('per_page','30');if(source.kind==='github_commits')u.searchParams.set('per_page','3');
     const body=source.kind==='openkim'?new URLSearchParams({database:'obj',query:JSON.stringify({type:'mo'}),fields:JSON.stringify({kimcode:1,title:1,description:1,'publication-year':1}),limit:'50'}):undefined;
     const response=await fetchMetadata(u.href,this.network,{signal:controller.signal,...(s.etag?{etag:s.etag}:{}),...(body?{body}:{})});
     if(response.status===404)throw Error('SOURCE_NOT_FOUND');
     let sourceBody=response.text;if(response.status===304){if(!s.snapshotSha256)throw Error('MISSING_SOURCE_SNAPSHOT');const stored=JSON.parse(ownedText(join(this.snapshots,s.snapshotSha256+'.json')));sourceBody=stored.text;try{const wrapped=JSON.parse(sourceBody);if(wrapped.materialsxSnapshotVersion===1)sourceBody=wrapped.responseBody;}catch{/* XML/HTML or original JSON snapshot */}}
     let snapshotText=sourceBody,license:string|null=null;
     if(source.kind==='github_release'||source.kind==='github_commits'){
      const endpoint=source.url.replace(/\/(releases|commits)$/, '/license');const result=await fetchMetadata(endpoint,this.network,{signal:controller.signal});let codeLicense:unknown=null;
      if(result.status===200){const info=z.object({sha:z.string().regex(/^[a-f0-9]{40}$/),license:z.object({spdx_id:z.string()}).nullable()}).parse(JSON.parse(result.text));codeLicense=info;license='repository-code:'+(info.license?.spdx_id??'unknown')+'@'+info.sha;}
      snapshotText=JSON.stringify({materialsxSnapshotVersion:1,responseBody:sourceBody,repositoryCodeLicense:codeLicense});
     }
     const digest=hash(snapshotText);atomicJson(this.snapshots,digest+'.json',{sourceId:source.id,url:u.href,capturedAt:s.lastAttempt,text:snapshotText});const observations=parseDiscoverySource(source,sourceBody).map(o=>({...o,license,snapshotSha256:digest}));
     // A latest-page omission is never a withdrawal. Only an asset removed from a positively observed release is one.
     if(source.kind==='github_release'){
      const releases=z.array(ghRelease).parse(JSON.parse(sourceBody));const releaseTags=new Set(releases.filter(r=>!r.draft).map(r=>r.tag_name));
      const identities=new Set(releases.flatMap(r=>r.assets.map(a=>`github:${source.id}:asset:${a.id}`)));for(const old of this.state.records.filter(r=>r.sourceIds.includes(source.id)&&r.observation.kind==='checkpoint'&&r.observation.status==='active'))if(releaseTags.has(old.observation.revision)&&!identities.has(old.observation.identity))observations.push({...old.observation,status:'withdrawn',snapshotSha256:digest,excerpt:'Official asset removed from the observed release; pending maintainer confirmation.'});
     }
     changes+=this.ingest(observations);s.etag=response.etag??s.etag;s.snapshotSha256=digest;s.lastSuccess=s.lastAttempt;s.error=null;s.count=observations.length;
    }catch(e){s.error=controller.signal.aborted?'DISCOVERY_CANCELLED':e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'SOURCE_PARSE_FAILED';}this.save();if(controller.signal.aborted)break;
   }
  }finally{this.controller=null;this.save();}return {...this.status(),changes};
 }
 cancel(){this.controller?.abort();return !!this.controller;}
 dispose(){this.cancel();}
}
