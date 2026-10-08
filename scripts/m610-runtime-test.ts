import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {AtomisticRuntime} from '../packages/atomistic/src/runtime.js';
import {PotentialAnalysisService} from '../packages/atomistic/src/potential-workflow.js';
import {createScienceBridge} from '../packages/pi-adapter/src/science-bridge.js';
import {adapterExpansion} from '../packages/atomistic/src/adapter-expansion.js';

const root=process.cwd(),temp=await mkdtemp(join(tmpdir(),'mx-m610-')),project=join(temp,'project'),state=join(temp,'state');await mkdir(project);
const runtime=new AtomisticRuntime(root,state,id=>id==='project'?project:null),service=new PotentialAnalysisService(root,state,runtime);
const evidence=join(root,'runtime/m6/acceptance/m610');await mkdir(evidence,{recursive:true});const checks:string[]=[],rows:unknown[]=[];
const options={optimizer:'FIRE' as const,cellMode:'fixed' as const,cellConstraint:'none' as const,externalPressureGPa:null,maxSteps:100,fmaxEvPerAngstrom:.03};
const id='sevennet-0-11jul2024';
async function finish(runId:string){const end=Date.now()+600000;while(Date.now()<end){const r=runtime.get({projectId:'project',runId});if(['completed','failed','cancelled','interrupted'].includes(r.job.status))return r;await new Promise(r=>setTimeout(r,100));}throw Error('TIMEOUT');}
try{
 await runtime.restore();assert(runtime.environmentReady(id));assert(!runtime.status().find(s=>s.potentialId===id)!.installed);assert.equal(runtime.status().filter(s=>!['mace-mp-0b3-medium-d3-bj-pbe-si','ani-2x-ensemble','nep-si-2022-nep4-3body'].includes(s.potentialId)).length,6);
 const r=JSON.parse(await readFile(join(root,`runtime/atomistic/${runtime.platform}/sevennet/RUNTIME.json`),'utf8'));const python=r.portable?join(root,`runtime/atomistic/${runtime.platform}/sevennet`,r.python):r.python;
 execFileSync(python,['-I','-c',`from ase.io import read,write\na=read(${JSON.stringify(join(root,'samples/atomistic/si-diamond.POSCAR'))},format='vasp')\na.positions[0]+=[.15,-.06,.04]\nwrite(${JSON.stringify(join(project,'distorted.extxyz'))},a,format='extxyz',write_results=False)`],{timeout:30000});
 const structure=await runtime.importFile('project',join(project,'distorted.extxyz'));
 const scope={projectId:'project',conversationId:'m610-chat',structureId:structure.id,domain:'inorganic-crystals' as const,mode:'exploratory' as const,permission:'relaxation' as const,options};
 const bridge=createScienceBridge(runtime,'project',scope,undefined,{service,scope:{projectId:'project',conversationId:scope.conversationId,structureId:structure.id,maxDownloadBytes:20*1048576,maxSteps:100,permission:'relaxation'},prompt:'选择 SevenNet 分析扰动无机晶体，固定晶胞弛豫 / Choose SevenNet and relax the perturbed bulk crystal at fixed cell'});
 const args=(action:string,targetId:string,potentialId:string|null=null,evidenceIds:string[]=[])=>({action,targetId,secondaryId:null,potentialId,domain:scope.domain,mode:scope.mode,evidenceIds});
 const assessment=await bridge.execute(args('auto_plan',structure.id)) as any;const c=assessment.selection.candidates.find((c:any)=>c.potentialId===id);assert(c);
 const started=await bridge.execute(args('auto_run',assessment.id,id,c.evidenceIds)) as any;assert.equal(started.downloadBytes,10268648);console.log('Cold automatic SevenNet download -> Phase B -> actual FIRE');
 let last:any;do {last=await bridge.execute(args('auto_get',started.workflowId));console.log('Workflow',last.state);}while(!['completed','failed','cancelled','interrupted'].includes(last.state));assert.equal(last.state,'completed',JSON.stringify(last));assert(bridge.completedSummary(true).some(j=>j.potentialId===id));
 const workflow=service.get('project',started.workflowId),relaxed=runtime.get({projectId:'project',runId:workflow.runId!});assert.equal(relaxed.result?.stopReason,'converged');assert(relaxed.result.completedSteps>0);
 const comparison=await runtime.comparison({projectId:'project',runId:relaxed.job.id});assert.deepEqual(comparison.before.cell,comparison.after.cell);assert(comparison.summary.final.maxForceEvPerAngstrom<.03);assert(comparison.summary.final.energyEv<comparison.summary.initial.energyEv);
 const final=relaxed.artifacts.find(a=>a.relativePath.endsWith('/final.json'))!;const view=await runtime.view({kind:'artifact',projectId:'project',runId:relaxed.job.id,artifactId:final.id});assert.equal(view.structure.atoms.length,8);assert(relaxed.artifacts.some(a=>a.relativePath.endsWith('/report.en.md')));rows.push({kind:'automatic-converged-relaxation',workflow,comparison,view});
 for(const name of ['environment.json','plan.json','result.json','relaxation.json','steps.json','final.json','report.zh.md','report.en.md'])await copyFile(join(relaxed.outputDirectory,name),join(evidence,name));
 checks.push('Uninstalled SevenNet selected within explicit chat scope: official cold download, exact identity, actual Phase B, nonzero-force FIRE convergence, unchanged cell, real bilingual reports/3D/composer summary.');
 // All five previous interfaces perform actual same-sample single points, without another environment build.
 for(const e of runtime.mountedPackages.entries().filter(e=>e.family!=='sevennet')){
  const cache=join(root,'runtime/m6/m68-sources',e.potentialId,'checkpoint.bin');const old=join(root,'runtime/scientific-packages',e.potentialId,e.sha256,'checkpoint.bin');
  if(existsSync(cache))await runtime.mountedPackages.importFile(e.potentialId,cache);else if(existsSync(old))await runtime.mountedPackages.importFile(e.potentialId,old);else await runtime.mountedPackages.download(e.potentialId);
 }
 for(const s of runtime.status().filter(s=>s.installed)){
  const job=await runtime.start({projectId:'project',structureId:structure.id,potentialId:s.potentialId});const result=await finish(job.job.id);assert.equal(result.job.status,'completed',result.job.error??'');assert(result.result&&Number.isFinite(result.result.energyEv));assert.equal(result.result.forcesEvPerAngstrom.length,8);rows.push({kind:'singlepoint-regression',snapshot:result});console.log('Real single point',s.potentialId);
 }
 const capped=await runtime.startRelaxation({projectId:'project',structureId:structure.id,potentialId:id,options:{...options,maxSteps:1,fmaxEvPerAngstrom:.001}});assert.equal((await finish(capped.job.id)).result?.stopReason,'max_steps');
 await assert.rejects(runtime.startRelaxation({projectId:'project',structureId:structure.id,potentialId:id,options:{...options,cellMode:'variable',cellConstraint:'full',externalPressureGPa:0}}),/VARIABLE_CELL_NOT_VERIFIED/);
 for(const patch of [{domain:'molecules'},{domain:'surfaces'},{domain:'polymers'},{mode:'production'}]){
  const a=await runtime.assess({projectId:'project',structureId:structure.id,domain:'inorganic-crystals',mode:'exploratory',task:'singlepoint',...patch});assert(!a.selection.candidates.some(c=>c.potentialId===id));
 }
 const md=await runtime.assess({projectId:'project',structureId:structure.id,domain:'inorganic-crystals',mode:'exploratory',task:'md'});assert(md.selection.exclusions.find(c=>c.potentialId===id)?.reasonCodes.includes('MOUNTED_MD_NOT_VERIFIED'));
 const active=await runtime.startRelaxation({projectId:'project',structureId:structure.id,potentialId:id,options:{...options,maxSteps:500,fmaxEvPerAngstrom:.001}});
 await assert.rejects(runtime.mountedPackages.uninstall(id),/IN_USE/);const deadline=Date.now()+60000;while(Date.now()<deadline&&!runtime.get({projectId:'project',runId:active.job.id}).relaxation?.progress)await new Promise(r=>setTimeout(r,20));assert(runtime.cancel({projectId:'project',runId:active.job.id}));assert.equal((await finish(active.job.id)).job.status,'cancelled');
 checks.push('Six real single-point interfaces regress; maximum-step output remains nonconverged; unsupported domain, production, MD and variable-cell operations blocked; active package protected and real SevenNet worker cancelled.');
 const restored=new AtomisticRuntime(root,state,k=>k==='project'?project:null);await restored.restore();assert.equal(restored.get({projectId:'project',runId:relaxed.job.id}).job.status,'completed');await restored.comparison({projectId:'project',runId:relaxed.job.id});const recovered=new PotentialAnalysisService(root,state,restored);recovered.restore();assert.equal(recovered.get('project',workflow.id).state,'completed');recovered.dispose();restored.dispose();
 await writeFile(join(relaxed.outputDirectory,'report.zh.md'),'changed');await assert.rejects(runtime.view({kind:'artifact',projectId:'project',runId:relaxed.job.id,artifactId:final.id}),/ARTIFACT_CHANGED/);
 checks.push('Historical/current result restoration works; altered real report rejected before scientific display.');
 const receipt={stage:'M6.10',passed:true,platform:runtime.platform,device:'cpu',model:id,weight:adapterExpansion(root).entries[0],checks,rows,scientificQuality:'needs_review',modelAPICalls:0,paymentCalls:0};await writeFile(join(evidence,'runtime.json'),JSON.stringify(receipt,null,2)+'\n');console.log('M6.10 real runtime acceptance passed');
}finally{service.dispose();runtime.dispose();await rm(temp,{recursive:true,force:true});}
