import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {AtomisticRuntime} from '../../packages/atomistic/src/runtime.js';
import {WorkspaceStore} from '../../apps/desktop/main/store.js';
import {ResearchService} from '../../apps/desktop/main/research-service.js';
const root=process.cwd(),temp=await mkdtemp(join(tmpdir(),'mx-ua7-m6-')),projectPath=join(temp,'project');
await mkdir(projectPath);const store=new WorkspaceStore(join(temp,'state.sqlite')),project=store.createProject(projectPath);
const runtime=new AtomisticRuntime(root,join(temp,'state'),id=>id===project.id?projectPath:null,
  id=>{if(id!=='chgnet-0.3.0')throw Error('THIS_PROBE_ALLOWS_ONLY_CHGNET_CORE');});
const research=new ResearchService(store,{client:null});research.scientific.atomistic=runtime;
try{
  await runtime.restore();const structure=await runtime.importSample(project.id,'si-diamond');
  const atomic={structureId:structure.id,domain:'inorganic-crystals',task:'singlepoint',mode:'exploratory'};
  const assessment=await research.scientific.assess(project.id,null,{task:'atomistic',question:'Inspect existing silicon sample with locked core potential',atomic});
  assert(assessment.candidates.some(c=>c.methodId==='atomistic-screening'));
  const receipt=assessment.atomicReceipt as any,candidate=receipt.selection.candidates.find((c:any)=>c.potentialId==='chgnet-0.3.0');assert(candidate);
  const job=await runtime.startSelected({projectId:project.id,proposal:{assessmentId:receipt.id,selectedPotentialId:candidate.potentialId,evidenceIds:candidate.evidenceIds}});
  let current=job;for(let n=0;n<1200;n++){current=runtime.get({projectId:project.id,runId:job.job.id});if(['completed','failed','cancelled','interrupted'].includes(current.job.status))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(current.job.status,'completed',current.job.error??'');assert.equal(current.result?.quality,'needs_review');assert(Number.isFinite(current.result!.energyEv));assert.equal(current.result?.potentialId,'chgnet-0.3.0');
  const formal=await research.scientific.assess(project.id,null,{task:'atomistic',question:'Production qualification must remain blocked',atomic:{...atomic,mode:'production'}});
  assert(!formal.candidates.length);
  const incompatible=await research.scientific.assess(project.id,null,{task:'atomistic',question:'Compute silicon with required long-range electrostatics',atomic:{...atomic,interaction:'short-range'}});
  assert(!incompatible.candidates.length);assert.equal(incompatible.request.atomic!.interaction,'long-range-required');
  const report={stage:'UA.7',realM6:true,realCheckpoint:true,potential:current.result!.potentialId,potentialSha256:current.result!.potentialSha256,
    energyEv:current.result!.energyEv,actualAtomCount:current.result!.atomCount,scientificStatus:'needs_review',productionApproved:false,
    artifacts:current.artifacts.map(a=>({type:a.type,sha256:a.sha256})),physicsRequirementDowngradeRejected:true,paidProviderCalls:0};
  await mkdir(resolve('runtime/agent/ua-7'),{recursive:true});await writeFile(resolve('runtime/agent/ua-7/m6-live.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{runtime.dispose();await research.close();store.close();await rm(temp,{recursive:true,force:true});}
