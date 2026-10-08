import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import type {TaskExecution} from '../../contracts/src/task-execution.js';
import {verifiedRpsmeArtifacts} from './rpsme-artifacts.js';
test('logical RPSME roles resolve only from owned successful receipts, with original source and all file hashes checked',async()=>{
  const root=await mkdtemp(join(tmpdir(),'mx-rpsme-artifacts-'));
  const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
  try{
    const pdf=join(root,'source.pdf');await writeFile(pdf,'%PDF-synthetic');
    const artifacts=[];
    for(const [i,label]of ['RPSME JSON','中文摘要','校验报告'].entries()){
      const path=join(root,'artifact-'+i),text='synthetic artifact '+i;await writeFile(path,text);
      artifacts.push({label,path,sha256:sha(text),bytes:Buffer.byteLength(text)});
    }
    const result={content:[{type:'text',text:JSON.stringify({source:{path:pdf,sha256:sha('%PDF-synthetic')},scientificStatus:'needs_review',artifacts})}]};
    const state={planRevision:1,attempts:[{method:'materials_rpsme_extract',state:'completed',planRevision:1,stepId:'execute',resultRef:'owned'}]} as unknown as TaskExecution;
    assert.deepEqual(await verifiedRpsmeArtifacts(root,pdf,state,()=>result,'execute'),artifacts);
    await assert.rejects(verifiedRpsmeArtifacts(root,pdf,{...state,planRevision:2},()=>result),/RECEIPT_MISSING/);
    await assert.rejects(verifiedRpsmeArtifacts(root,pdf,state,()=>result,'different-step'),/RECEIPT_MISSING/);
    await writeFile(artifacts[0]!.path,'tampered');await assert.rejects(verifiedRpsmeArtifacts(root,pdf,state,()=>result),/CHANGED/);
    await writeFile(pdf,'%PDF-changed');await assert.rejects(verifiedRpsmeArtifacts(root,pdf,state,()=>result),/CHANGED/);
  }finally{await rm(root,{recursive:true,force:true});}
});
