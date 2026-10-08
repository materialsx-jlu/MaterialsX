import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {HostMcp} from './host-mcp.js';
import {selectedAssetTools,readAssetExcerpt} from './selected-assets.js';
import {harness} from './task-supervisor.fixture.js';
const text=Array.from({length:240},(_,i)=>'Real snapshot line '+(i+1)).join('\n'),sha=createHash('sha256').update(text).digest('hex');
const selection={files:[{id:'owned-file',name:'public sample.txt',text,sha256:sha}],skills:[{id:'pinned-skill',name:'pinned-skill',text:'Instructions',sha256:createHash('sha256').update('Instructions').digest('hex')}]};
test('long PDF text stays out of one model result and exposes the next exact range',()=>{
 const full=Array.from({length:4000},(_,i)=>`[PDF 第 ${i+1} 页] `+'实验条件 '.repeat(30)).join('\n');
 const asset={id:'paper',name:'paper.pdf',text:full,sha256:createHash('sha256').update('original-pdf').digest('hex'),format:'pdf',pageCount:4000};
 const first=readAssetExcerpt(asset);assert(first.partial);assert(Buffer.byteLength(JSON.stringify(first))<65536);assert(first.endLine<4000);
 const next=readAssetExcerpt(asset,first.endLine+1);assert.equal(next.startLine,first.endLine+1);assert.equal(next.pageCount,4000);
});
test('frozen snapshots return exact hashes and bounded ranges, with explicit partial coverage',async()=>{
 const tool=selectedAssetTools(selection)[0]!,signal=new AbortController().signal;
 const first=JSON.parse((await tool.execute({fileId:'owned-file'},signal)).content[0]!.text);assert.equal(first.endLine,200);assert(first.partial);assert.equal(first.sha256,sha);
 const last=JSON.parse((await tool.execute({fileId:'owned-file',startLine:201},signal)).content[0]!.text);assert.equal(last.endLine,240);assert.equal(last.text,text.split('\n').slice(200).join('\n'));
 for(const args of [{fileId:'outside'},{fileId:'owned-file',startLine:241},{fileId:'owned-file',endLine:240},{fileId:'owned-file',startLine:5,endLine:4},{fileId:'owned-file',execute:true}])await assert.rejects(tool.execute(args,signal));
});
test('ordinary first-200-line reads stop at EOF without retries or false partial coverage',async()=>{
 const short={id:'short-file',name:'short.txt',text:'one\ntwo',sha256:createHash('sha256').update('one\ntwo').digest('hex')};
 for(const tool of selectedAssetTools({files:[short],skills:selection.skills})){
  const key=tool.name==='read_skill'?'name':'fileId',id=key==='name'?'pinned-skill':short.id;
  const result=JSON.parse((await tool.execute({[key]:id,startLine:1,endLine:200},new AbortController().signal)).content[0]!.text);
  assert.equal(result.endLine,result.totalLines);assert.equal(result.partial,false);assert.match(result.sha256,/^[a-f0-9]{64}$/);
  for(const range of [{startLine:1,endLine:201},{startLine:3,endLine:2},{startLine:201,endLine:400}])await assert.rejects(tool.execute({[key]:id,...range},new AbortController().signal));
 }
});
test('real MCP discovery and scoped asset reads use one schema, one dispatcher and actual receipts',async()=>{
 const h=harness();h.plan.originalRequest='读取已选文件';h.context.methods.set('read_material_file',['read']);h.context.methods.set('read_skill',['read']);h.control.acceptPlan(h.plan);
 let wrongReader=0;const mcp=new HostMcp(selection,undefined,{permissions:h.context.grant.permissions,signal:new AbortController().signal,tools:[{name:'read_skill',description:'Unpinned duplicate reader',parameters:{type:'object'},permissions:['read'],execute:async()=>{wrongReader++;throw Error('duplicate');}}]},h.control);
 const client=new Client({name:'ap3-asset-fixture',version:'1'});
 try{await mcp.start();await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url),{requestInit:{headers:{Authorization:'Bearer '+mcp.token}}}) as Transport);
  const listed=await client.listTools();assert.equal(listed.tools.filter(t=>t.name==='read_skill').length,1);
  const find=await client.callTool({name:'find_tools',arguments:{query:'read_material_file',includeSchema:true}});const found=JSON.parse((find.content as any)[0].text);assert.equal(found.tools[0].parameters.properties.fileId.type,'string');
  const read=await client.callTool({name:'invoke_material_tool',arguments:{name:'read_material_file',arguments:{fileId:'owned-file',startLine:201}}});assert(!read.isError);const value=JSON.parse((read.content as any)[0].text);assert.equal(value.sha256,sha);assert.equal(value.startLine,201);
  const skill=await client.callTool({name:'read_skill',arguments:{name:'pinned-skill'}});assert(!skill.isError);assert.equal(wrongReader,0);assert.equal(h.control.snapshot().attempts.length,2);
  const foreign=await client.callTool({name:'read_material_file',arguments:{fileId:'foreign'}});assert(foreign.isError);assert.equal(h.control.snapshot().attempts.at(-1)?.state,'failed');
 }finally{await client.close();await mcp.close();}
});
