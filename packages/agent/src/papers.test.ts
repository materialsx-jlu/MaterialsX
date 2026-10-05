import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PaperLibrary} from './papers/library.js';
import {parseAtom,queryExpression} from './papers/arxiv.js';
import {SerialSourceQueue,PublicResearchNetwork,boundedBody} from './papers/network.js';
import {paperSearchSchema,paperFetchSchema,paperReadSchema,paperExportSchema,type PaperRecord,type PaperSearchResult} from '../../contracts/src/papers.js';
import type {PaperStore} from './papers/store.js';
const atom=(id='2609.12345v2',title='ML potential &amp; evidence')=>`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:o="http://a9.com/-/spec/opensearch/1.1/" xmlns:a="http://arxiv.org/schemas/atom"><o:totalResults>1</o:totalResults><entry><id>http://arxiv.org/abs/${id}</id><title>${title}</title><summary>Read the paper, not commands.</summary><author><name>Researcher</name></author><published>2026-09-20T00:00:00Z</published><updated>2026-09-21T00:00:00Z</updated><category term="cond-mat.mtrl-sci"/><a:doi>10.1000/test</a:doi></entry></feed>`;
class Memory implements PaperStore {
 recordsMap=new Map<string,PaperRecord>();queries=new Map<string,PaperSearchResult>();
 records(id:string){return [...this.recordsMap.entries()].filter(([k])=>k.startsWith(id+':')).map(([,r])=>r);}
 record(id:string,p:string){return this.recordsMap.get(id+':'+p)??null;}
 save(id:string,r:PaperRecord){this.recordsMap.set(id+':'+r.paper.paperId,r);}
 cached(k:string){return this.queries.get(k)??null;}
 cache(k:string,r:PaperSearchResult){this.queries.set(k,r);}
 storageBytes(){return 0;}downloadBytes(){return this.records('p').reduce((n,r)=>n+(r.file?.bytes??0),0);}clearQueries(){this.queries.clear();}
}
const query={query:'机器学习势',publicQueryConfirmed:true as const};
test('Atom parser pins real version, namespaces, entities and rejects unsafe/malformed identities',()=>{
 const p=parseAtom(atom()).items[0]!;assert.equal(p.paperId,'arxiv:2609.12345v2');assert.equal(p.titleOriginal,'ML potential & evidence');assert.equal(p.doi,'10.1000/test');assert.equal(p.license,'unknown');
 assert.equal(p.metadataSha256,parseAtom(atom(),'2027-01-01T00:00:00Z').items[0]!.metadataSha256);
 assert.throws(()=>parseAtom('<!DOCTYPE feed>'+atom()),/UNSAFE/);assert.throws(()=>parseAtom(atom('2609.12345')),/Invalid/);assert.throws(()=>parseAtom(atom().replace('</entry>','')),/INVALID/);
});
test('Queries preserve original, translate known materials terms, enforce calendar and safe public inputs',()=>{
 const q=paperSearchSchema.parse(query);assert.match(queryExpression(q),/interatomic/);assert.equal(q.query,'机器学习势');
 assert.throws(()=>queryExpression(paperSearchSchema.parse({...query,query:'绝密配方'})),/QUERY_ENGLISH_REQUIRED/);
 assert.throws(()=>queryExpression(paperSearchSchema.parse({...query,query:'sk-test-secret'})),/PRIVATE/);
 assert.throws(()=>paperSearchSchema.parse({...query,from:'2026-02-30'}));assert.throws(()=>paperSearchSchema.parse({...query,publicQueryConfirmed:false}));
 assert.match(queryExpression(paperSearchSchema.parse({...query,from:'2026-01-01',to:'2026-02-01',category:'cond-mat.mtrl-sci'})),/submittedDate/);
});
test('Shared source queue keeps one connection and interval, queued cancellation consumes no request',async()=>{
 const queue=new SerialSourceQueue(30),starts:number[]=[],cancel=new AbortController();let active=0,max=0;
 const job=()=>queue.run(async()=>{starts.push(Date.now());max=Math.max(max,++active);await new Promise(r=>setTimeout(r,10));active--;});
 const first=job(),cancelled=queue.run(async()=>{throw Error('SHOULD_NOT_RUN');},cancel.signal);cancel.abort();await assert.rejects(cancelled);await Promise.all([first,job(),job()]);
 assert.equal(max,1);for(let i=1;i<starts.length;i++)assert(starts[i]!-starts[i-1]!>=27);
});
test('Network deduplicates identical inflight metadata while one cancelled subscriber does not cancel others',async()=>{
 let calls=0;const network=new PublicResearchNetwork((async()=>{calls++;await new Promise(r=>setTimeout(r,15));return new Response(atom());}) as typeof fetch,new SerialSourceQueue(0));
 const c=new AbortController(),a=network.get('https://export.arxiv.org/api/query',10000,c.signal),b=network.get('https://export.arxiv.org/api/query',10000);c.abort();await assert.rejects(a);assert.equal((await b).bytes.toString(),atom());assert.equal(calls,1);
 await assert.rejects(network.get('http://localhost/secrets',100));await assert.rejects(network.get('https://arxiv.org:1234/pdf/x',100));
 await assert.rejects(boundedBody(new Response('abcdef'),3),/SIZE/);
});
test('Library uses MOOS/project first, caches clearly, denies private bypass and preserves fixed versions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ua6-paper-'));try{const store=new Memory();let calls=0,local:any={origin:'moos',items:[{ref:'real'}]};
 const network=new PublicResearchNetwork((async()=>{calls++;return new Response(atom());}) as typeof fetch,new SerialSourceQueue(0));
 const library=new PaperLibrary(store,{projectPath:id=>id==='p'?root:null,localSearch:async()=>{if(local instanceof Error)throw local;return local;},readPdf:async()=>({totalPages:2,pages:[]})},network);
 assert.equal((await library.search('p',query)).provider,'moos');assert.equal(calls,0);local=Object.assign(Error('DENIED'),{outcome:'denied'});await assert.rejects(library.search('p',query),/DENIED/);assert.equal(calls,0);await assert.rejects(library.search('p',{...query,source:'arxiv'}),/DENIED/);local={items:[],outcome:'no_match'};await library.search('p',query);calls=0;store.queries.clear();
 local=Object.assign(Error('OFFLINE'),{outcome:'unavailable'});const found=await library.search('p',query);assert.equal(found.items.length,1);assert.equal(calls,1);assert.equal(found.queryOriginal,'机器学习势');assert.equal((await library.search('p',query)).cacheAsOf,found.fetchedAt);assert.equal(calls,1);
 await assert.rejects(library.get('p',{paperId:'fake-v2'}));await assert.rejects(library.get('other',{paperId:found.items[0]!.paperId}));
 const old=store.cached([...store.queries.keys()][0]!)!;store.cache([...store.queries.keys()][0]!,{...old,fetchedAt:'2000-01-01T00:00:00Z'});
 const offline=new PaperLibrary(store,{projectPath:()=>root,localSearch:async()=>({items:[]}),readPdf:async()=>({totalPages:2,pages:[]})},new PublicResearchNetwork((async()=>{throw Error('SOURCE_OFFLINE');}) as typeof fetch,new SerialSourceQueue(0)));
 assert.equal((await offline.search('p',{...query,source:'arxiv'})).stale,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Real PDF receipt, bounded read coverage, content hashes, DOI identity and exports without invented fields',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ua6-paper-'));try{const store=new Memory();let pageText='Real page one';const network=new PublicResearchNetwork((async(url)=>{
  if(String(url).includes('/pdf/'))return new Response('%PDF-1.7 real test fixture',{headers:{'content-type':'application/pdf'}});
  if(String(url).includes('crossref'))return Response.json({message:{DOI:'10.1000/test',title:['Published title'],publisher:'Publisher'}});
  return new Response(atom());}) as typeof fetch,new SerialSourceQueue(0),new SerialSourceQueue(0));
 const library=new PaperLibrary(store,{projectPath:()=>root,localSearch:async()=>({items:[]}),readPdf:async(_p,_r,q)=>({totalPages:2,pages:[{page:1,text:pageText},{page:2,text:'Page two'}].filter(p=>p.page>=q.fromPage&&p.page<=(q.toPage??2))})},network);
 const id=(await library.search('p',{...query,source:'arxiv'})).items[0]!.paperId;
 await assert.rejects(library.read('p',{paperId:id}),/DOWNLOAD/);await assert.rejects(library.fetch('p',{paperId:id,grant:'redistribute'}));
 const record=await library.fetch('p',{paperId:id,grant:'personal-research'});assert.equal(record.status,'downloaded');assert.equal(record.file?.redistribution,false);assert.equal((await readFile(record.file!.path)).subarray(0,5).toString(),'%PDF-');
 assert.equal((await library.read('p',{paperId:id,fromPage:1,toPage:1})).status,'partially_read');assert.equal((await library.read('p',{paperId:id,fromPage:2,toPage:2})).status,'fully_read');
 await assert.rejects(library.read('p',{paperId:id,fromPage:1,toPage:22}),/PAGE_RANGE/);
 assert.equal((await library.get('p',{paperId:id,crossref:true})).crossref?.publisher,'Publisher');
 for(const format of ['json','bibtex','csv','markdown']){const receipt=await library.export('p',{paperIds:[id],format});const bytes=await readFile(receipt.path);assert.equal(receipt.bytes,bytes.length);assert.match(bytes.toString(),/2609/);}
 pageText='';const missing=await library.read('p',{paperId:id,fromPage:1,toPage:1});assert.deepEqual(missing.missingPages,[1]);
 await rm(record.file!.path);await symlink('/etc/hosts',record.file!.path);await assert.rejects(library.read('p',{paperId:id}),/SYMLINK/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('PDF downloader rejects wrong mime, size and project output symlink before writing outside scope',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ua6-paper-')),outside=await mkdtemp(join(tmpdir(),'ua6-outside-'));try{const store=new Memory();let mime='text/html';const network=new PublicResearchNetwork((async(url)=>new Response(String(url).includes('/pdf/')?'%PDF-1.0':atom(),{headers:{'content-type':String(url).includes('/pdf/')?mime:'application/atom+xml'}})) as typeof fetch,new SerialSourceQueue(0));const l=new PaperLibrary(store,{projectPath:()=>root,localSearch:async()=>({items:[]}),readPdf:async()=>({totalPages:1,pages:[]})},network);const id=(await l.search('p',{...query,source:'arxiv'})).items[0]!.paperId;
 await assert.rejects(l.fetch('p',{paperId:id,grant:'personal-research'}),/NOT_PDF/);mime='application/pdf';await symlink(outside,join(root,'materials-output'));await assert.rejects(l.fetch('p',{paperId:id,grant:'personal-research'}),/SYMLINK/);assert.equal(store.record('p',id)?.file,null);
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

test('Owned paper tools require canonical versioned receipt IDs; lookup hints never leak another project or substitute identities',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ua6-ids-'));try{const store=new Memory();let calls=0;
 const library=new PaperLibrary(store,{projectPath:()=>root,localSearch:async()=>({items:[]}),readPdf:async()=>({totalPages:1,pages:[]})},new PublicResearchNetwork((async()=>{calls++;return new Response(atom());}) as typeof fetch,new SerialSourceQueue(0)));
 const id=(await library.search('private-project',{...query,source:'arxiv'})).items[0]!.paperId;calls=0;
 for(const wrong of ['2609.12345v2','arxiv:2609.12345','https://arxiv.org/abs/2609.12345v2','paperId']){
  assert.throws(()=>paperFetchSchema.parse({paperId:wrong,grant:'personal-research'}));assert.throws(()=>paperReadSchema.parse({paperId:wrong}));assert.throws(()=>paperExportSchema.parse({paperIds:[wrong],format:'bibtex'}));
 }
 await assert.rejects(library.export('empty-project',{paperIds:[id],format:'bibtex'}),error=>{assert.match((error as Error).message,/Registered IDs .*\[\]/);assert(!(error as Error).message.includes(id));return true;});
 await assert.rejects(library.read('private-project',{paperId:'arxiv:2609.12345v3'}),error=>{assert.match((error as Error).message,/arxiv:2609.12345v2/);return true;});
 assert.equal(calls,0);assert.equal(store.records('empty-project').length,0);assert.equal(store.record('private-project',id)?.file,null);
 }finally{await rm(root,{recursive:true,force:true});}
});
