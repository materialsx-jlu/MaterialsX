import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {runManagedRpsme} from './managed-rpsme.js';
import {ManagedEnvironment} from '../../agent/src/managed-environment.js';
import type {ExecutionControl} from '../../agent/src/execution-control.js';
test('Shared managed RPSME backend reuses real PDF/script chain, pins source SHA, validates quotes and returns three real review artifacts',{skip:process.platform!=='darwin'||process.arch!=='arm64'},async()=>{
 const temp=await mkdtemp(join(tmpdir(),'ua6-rpsme-')),project=join(temp,'project');await mkdir(project);
 try{assert.equal((await new ManagedEnvironment(process.cwd(),temp).check()).status,'ready');const pdf=resolve('tests/fixtures/agent/ua6-paper.pdf'),input={pdfPath:pdf,approvedPdfPath:pdf,projectPath:project,projectRoot:process.cwd(),connection:{id:randomUUID(),source:'local' as const,modelId:'fixture-no-real-model',endpoint:'http://127.0.0.1:1234/v1',protocol:'responses' as const,contextWindow:8192,maxOutputTokens:2000,revision:'fixture'},control:{} as ExecutionControl,signal:new AbortController().signal};
 const result=await runManagedRpsme(input,async(_prompt,label)=>label==='论文元数据'?{title:'Synthetic fixture only',doi:null}:{facts:[{sample:'unspecified',category:'property',name:'measured value',descriptionZh:'合成测试文字中的 3.2 GPa。',quote:'measured value 3.2 GPa, room temperature.',value:3.2,unit:'GPa',conditions:'room temperature',recipe:''}],notes:'synthetic fixture, no scientific validation',gaps:['Material identity missing.']});
 assert.equal(result.artifacts.length,3);assert.equal(result.scientificStatus,'needs_review');for(const artifact of result.artifacts){assert.equal((await readFile(artifact.path)).length,artifact.bytes);assert.match(artifact.sha256,/^[a-f0-9]{64}$/);}
 const report=result.artifacts.find(a=>a.label==='校验报告')!;assert.equal(JSON.parse(await readFile(report.path,'utf8')).extraction_quality_ready,false);
 await assert.rejects(runManagedRpsme({...input,pdfPath:'/etc/private.pdf'}),/USER_REQUEST/);
 await assert.rejects(runManagedRpsme({...input,connection:{...input.connection,source:'platform'}}),/LOCAL_MODEL/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
