import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {resolveAtomicResearchArtifact} from './atomic-research-artifacts.js';
test('atomic deliverables require same-step current receipts and unchanged completed project artifacts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'mx-atomic-artifacts-'));
  try{
    const relativePath='materials-output/atomistic/job/result.json',file=join(root,relativePath),content='{"energyEv":-1}';
    await mkdir(join(root,'materials-output/atomistic/job'),{recursive:true});await writeFile(file,content);
    const snapshot={job:{status:'completed'},result:{energyEv:-1},artifacts:[{relativePath,sha256:createHash('sha256').update(content).digest('hex'),partial:false}]};
    const runtime={assess:async()=>({}),get:({runId,projectId}:any)=>{assert.equal(projectId,'project');if(runId!=='job')throw Error('NOT_OWNED');return snapshot;}} as any;
    const state={task:{projectId:'project'},planRevision:2,attempts:[{stepId:'step2',planRevision:2,state:'completed',jobs:[{id:'job',state:'completed'}]}]} as any;
    assert.equal(await resolveAtomicResearchArtifact(runtime,state,'step2','JSON',root),relativePath);
    assert.equal(await resolveAtomicResearchArtifact(runtime,state,'step1','JSON',root),null);
    state.attempts[0].planRevision=1;assert.equal(await resolveAtomicResearchArtifact(runtime,state,'step2','JSON',root),null);
    state.attempts[0].planRevision=2;snapshot.job.status='running';assert.equal(await resolveAtomicResearchArtifact(runtime,state,'step2','JSON',root),null);
    snapshot.job.status='completed';assert.equal(await resolveAtomicResearchArtifact(runtime,state,'step2','missing.json',root),null);
    await writeFile(file,'tampered');await assert.rejects(resolveAtomicResearchArtifact(runtime,state,'step2','JSON',root),/ARTIFACT_CHANGED/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('singlepoint uses hashed original structure; relaxation requires its actual final structure',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mx-atomic-structure-'));
 try{
  const relativePath='materials-output/atomistic/job/structure.json',content='{}';
  await mkdir(join(root,'materials-output/atomistic/job'),{recursive:true});await writeFile(join(root,relativePath),content);
  const job={job:{status:'completed'},plan:{task:{kind:'singlepoint'}},result:{energyEv:-1},artifacts:[{relativePath,sha256:createHash('sha256').update(content).digest('hex'),partial:false}]};
  const runtime={get:()=>job} as any,state={task:{projectId:'project'},planRevision:1,attempts:[{stepId:'step1',planRevision:1,state:'completed',jobs:[{id:'job',state:'completed'}]}]} as any;
  assert.equal(await resolveAtomicResearchArtifact(runtime,state,'step1','3D结构',root),relativePath);
  job.plan.task.kind='relaxation';assert.equal(await resolveAtomicResearchArtifact(runtime,state,'step1','3D结构',root),null);
  job.plan.task.kind='singlepoint';job.artifacts[0]!.partial=true;assert.equal(await resolveAtomicResearchArtifact(runtime,state,'step1','3D结构',root),null);
 }finally{await rm(root,{recursive:true,force:true});}
});
