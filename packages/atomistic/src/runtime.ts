import {compositionResultSchema} from '../../contracts/src/potential-physics.js';
import {nativeExpansion} from './native-expansion.js';
import {reproductionReceiptSchema} from '../../contracts/src/potential-distribution.js';
import {canonical,hash} from './discovery-io.js';
import { mountedId as runnablePotentialId, selectedRunSchema, startAtomisticMountedSchema as startAtomisticSchema, startRelaxationMountedSchema as startRelaxationSchema, capabilityReceiptSchema, currentSelectionAssessmentSchema as selectionAssessmentSchema, type CapabilityReceipt, type SelectionAssessment, type MountedRuntimeStatus as AtomisticRuntimeStatus } from "../../contracts/src/potential-packages.js";
import { PotentialPackageManager } from "./package-manager.js";
import { scientificSnapshotSchema as atomisticSnapshotSchema,type ScientificSnapshot as AtomisticSnapshot,startMDSchema,mdOptionsSchema,mdStepSchema,mdSummarySchema,mdIndexSchema,frameRequestSchema,trajectoryRequestSchema,trajectoryPayloadSchema,mdComparisonRequestSchema,mdComparisonSchema,type MDOptions } from "../../contracts/src/atomistic-dynamics.js";
import { ModelPackageManager,effectiveRegistry } from "./model-packages.js";
import { readMDIndex,readMDFrame,readMDHistory,validateIndex,verifyMD } from "./dynamics.js";
import { assessPotentials, digest, digestFile, validateProposal } from "./selection.js";
import { electronicStateRequestSchema } from "../../contracts/src/potential-molecules.js";
import { selectionRequestSchema,COMPOSITE_ID } from "../../contracts/src/potential-physics.js";
import {physicsExpansion} from "./physics-expansion.js";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { atomicStructureSchema, atomisticArtifactSchema, atomisticPlanSchema, atomisticResultSchema, type AtomicStructure } from "../../contracts/src/atomistic.js";
import { corePotentialId, getAtomisticSchema, inspectAtomisticSchema, localId } from "../../contracts/src/atomistic-runtime.js";
import { runBoundedChild } from "./process.js";
import { readOwnedBytes,hashOwnedFile,readOwnedRange } from "./artifact-io.js";
import { relaxationOptionsSchema, relaxationSummarySchema, relaxationCheckpointSchema, relaxationComparisonSchema, relaxationStepSchema, relaxationHistorySchema, type RelaxationOptions } from "../../contracts/src/atomistic-relaxation.js";
import { atomicViewRequestSchema, atomicViewPayloadSchema, type AtomicViewPayload } from "../../contracts/src/atomic-viewer.js";

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const terminal = (status: string) => ["completed","failed","cancelled","interrupted"].includes(status);
const installationSchema = z.strictObject({version:z.literal("m6.1-v1"),platform:z.enum(["macos-arm64","windows-x64"]),potentialId:corePotentialId,
  environmentProfileId:localId,sourceRevision:z.string().regex(/^[a-f0-9]{40}$/),dependencyLockSha256:z.string().regex(/^[a-f0-9]{64}$/),
  python:z.string().min(1).max(4096),portable:z.boolean(),weight:z.literal("checkpoint.bin"),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().positive(),
  createdAt:z.iso.datetime(),runtimeValidation:z.literal("pending"),scientificQuality:z.literal("needs_review")});
const sevenNetInstallationSchema=installationSchema.extend({version:z.literal('m6.10-v1'),potentialId:z.literal('sevennet-0-11jul2024')});
const importSchema=z.strictObject({projectId:localId,structure:atomicStructureSchema});
type ImportRecord=z.infer<typeof importSchema>;

/** Reject symlinked output components. Input files are copied once, never modified. */
export async function ownedDirectory(project: string, runId: string): Promise<string> {
  localId.parse(runId);
  let path=await realpath(project);
  for(const component of ["materials-output","atomistic",runId]) {
    path=join(path,component);await mkdir(path,{recursive:true});
    const info=await lstat(path);
    if(info.isSymbolicLink()||!info.isDirectory())throw Error("UNSAFE_OUTPUT_DIRECTORY");
  }
  return path;
}
export class AtomisticRuntime {
  readonly platform=process.platform==="darwin"&&process.arch==="arm64"?"macos-arm64":process.platform==="win32"&&process.arch==="x64"?"windows-x64":"unsupported";
  private assessments=new Map<string,SelectionAssessment>();
  private capabilityCache=new Map<string,CapabilityReceipt>();
  private imports=new Map<string,ImportRecord>();
  private jobs=new Map<string,AtomisticSnapshot>();
  // Publish only validated persisted snapshots; async artifact finalization must not expose a half-terminal job.
  private published=new Map<string,AtomisticSnapshot>();
  private queue:string[]=[];
  private controller:AbortController|null=null;
  private running:string|null=null;
  private inspecting=false;
  private disposed=false;
  private readonly stateDir:string;
  constructor(private root:string,userData:string,private projectPath:(id:string)=>string|null,private assertUsable:(id:string)=>void=()=>{}) {
    this.packages=new ModelPackageManager(root,userData,fetch,id=>this.assertUsable(id),id=>this.packageInUse(id)||this.mountedPackages.operationBusy(id));
    this.mountedPackages=new PotentialPackageManager(root,userData,id=>this.packageInUse(id)||this.packages.operationBusy(),fetch,undefined,id=>this.assertUsable(id));
    this.stateDir=join(userData,"atomistic");mkdirSync(join(this.stateDir,"imports"),{recursive:true});
    mkdirSync(join(this.stateDir,"jobs"),{recursive:true});
  }
  async restore():Promise<void> {
    for(const name of await readdir(join(this.stateDir,"imports"))) {
      if(!/^[a-f0-9-]+\.json$/.test(name))continue;
      try { const path=join(this.stateDir,"imports",name);if((await stat(path)).size>2*1024*1024)continue;
        const item=importSchema.parse(JSON.parse(await readFile(path,"utf8")));this.imports.set(item.structure.id,item); }catch { /* invalid records are never authorized */ }
    }
    for(const name of await readdir(join(this.stateDir,"jobs"))) {
      if(!/^[a-f0-9-]+\.json$/.test(name))continue;
      try { const path=join(this.stateDir,"jobs",name);if((await stat(path)).size>4*1024*1024)continue;
        const item=atomisticSnapshotSchema.parse(JSON.parse(await readFile(path,"utf8")));
        if(item.job.status==="completed") {
          try{await this.verifyStoredResult(item);}catch{item.job.status="failed";item.job.quality="needs_review";item.job.error="STORED_ARTIFACTS_MISSING_OR_CHANGED";item.result=null;item.artifacts=[];item.job.resultArtifactId=null;if(item.relaxation){item.relaxation.summary=null;item.relaxation.partialArtifactId=null;}if(item.md){item.md.summary=null;item.md.trajectoryArtifactId=null;}this.save(item);}
        }
        if(!terminal(item.job.status)){item.job.status="interrupted";item.job.finishedAt=new Date().toISOString();item.job.error="APP_RESTARTED";item.job.quality="needs_review";item.result=null;item.artifacts=[];item.job.resultArtifactId=null;if(item.relaxation){item.relaxation.summary=null;item.relaxation.partialArtifactId=null;}if(item.md){item.md.summary=null;item.md.trajectoryArtifactId=null;}await this.partialCheckpoint(item);this.save(item);}
        this.jobs.set(item.job.id,item);this.published.set(item.job.id,structuredClone(item));
      }catch { /* invalid records are never authorized */ }
    }
  }
  private project(id:string):string {localId.parse(id);const path=this.projectPath(id);if(!path)throw Error("UNKNOWN_PROJECT");return path;}
  private async verifyStoredResult(item:AtomisticSnapshot):Promise<void> {
    const expected=join(await realpath(this.project(item.job.projectId)),"materials-output/atomistic",item.job.id);
    if(item.outputDirectory!==expected||await realpath(expected)!==expected||item.result?.quality!=="needs_review")throw Error("STORED_SCOPE_MISMATCH");
    const legacySinglepoint=item.plan.task.kind==="singlepoint"&&!item.artifacts.some(a=>a.relativePath.endsWith("/report.zh.md"))&&! [COMPOSITE_ID,"ani-2x-ensemble","nep-si-2022-nep4-3body"].includes(item.plan.potentialId);
    const expectedNames=this.artifactNames(item,legacySinglepoint).map(([name])=>name);
    if(item.artifacts.length!==expectedNames.length||!item.artifacts.some(a=>a.id===item.job.resultArtifactId&&a.type==="atomistic_result"))throw Error("STORED_RESULT_MISSING");
    const bytes=new Map<string,Buffer>();
    for(const artifact of item.artifacts){
      const name=artifact.relativePath.split("/").at(-1)!;
      if(this.artifactNames(item,legacySinglepoint).find(([n])=>n===name)?.[1]!==artifact.type||!expectedNames.includes(name)||bytes.has(name)||artifact.partial||artifact.relativePath!==`materials-output/atomistic/${item.job.id}/${name}`)throw Error("STORED_ARTIFACT_SCOPE");
      if(item.md&&["frames.ndjson","trajectory.extxyz"].includes(name)){const d=await hashOwnedFile(this.project(item.job.projectId),join(expected,name),artifact.sha256,item.plan.budget.maxOutputMiB*1048576);if(d.bytes!==artifact.bytes)throw Error("STORED_ARTIFACT_CHANGED");continue;}
      const data=await readOwnedBytes(this.project(item.job.projectId),join(expected,name),artifact.sha256,4*1024*1024);
      if(data.length!==artifact.bytes)throw Error("STORED_ARTIFACT_CHANGED");bytes.set(name,data);
    }
    if(JSON.stringify(atomisticResultSchema.parse(JSON.parse(bytes.get("result.json")!.toString("utf8"))))!==JSON.stringify(item.result))throw Error("STORED_RESULT_CHANGED");
    if(JSON.stringify(atomicStructureSchema.parse(JSON.parse(bytes.get("structure.json")!.toString("utf8"))))!==JSON.stringify(item.structure))throw Error("STORED_STRUCTURE_CHANGED");
    if(item.plan.potentialId===COMPOSITE_ID){
      const q=compositionResultSchema.parse(JSON.parse(bytes.get('composition.json')!.toString()));
      const m=physicsExpansion(this.root)!;
      const profile=JSON.parse(bytes.get('physics-profile.json')!.toString());
      if(q.profileSha256!==m.profileSha256||profile.sha256!==m.profileSha256||JSON.stringify(profile.profile)!==JSON.stringify(m.profile)||q.total.energyEv!==item.result!.energyEv||JSON.stringify(q.total.forcesEvPerAngstrom)!==JSON.stringify(item.result!.forcesEvPerAngstrom)||JSON.stringify(q.total.stress)!==JSON.stringify(item.result!.stress!.values))throw Error('COMPOSITION_RESULT_CHANGED');
    }
    if(bytes.has("selection.json")){
      const assessment=selectionAssessmentSchema.parse(JSON.parse(bytes.get("selection.json")!.toString("utf8")));
      if(!item.plan.selectionEvidenceIds.includes(`m64:${assessment.id}`)||assessment.request.projectId!==item.job.projectId||assessment.structureSha256!==digest(JSON.stringify(item.structure))||assessment.selection.selectedPotentialId!==item.plan.potentialId)throw Error("SELECTION_PROVENANCE_CHANGED");
    }
    if(item.md){
      await readOwnedBytes(this.project(item.job.projectId),join(expected,"artifacts.json"),sha(JSON.stringify(item.artifacts,null,2)+"\n"));
      const summary=mdSummarySchema.parse(JSON.parse(bytes.get("md-summary.json")!.toString()));
      if(JSON.stringify(summary)!==JSON.stringify(item.md.summary)||JSON.stringify(mdOptionsSchema.parse(JSON.parse(bytes.get("md-settings.json")!.toString())))!==JSON.stringify(item.md.options)||JSON.stringify(atomisticPlanSchema.parse(JSON.parse(bytes.get("plan.json")!.toString())))!==JSON.stringify(item.plan))throw Error("MD_PLAN_OR_SUMMARY_CHANGED");
      await verifyMD(this.project(item.job.projectId),item);
    }
    if(item.relaxation){
      await readOwnedBytes(this.project(item.job.projectId),join(expected,"artifacts.json"),sha(JSON.stringify(item.artifacts,null,2)+"\n"));
      const summary=relaxationSummarySchema.parse(JSON.parse(bytes.get("relaxation.json")!.toString("utf8")));
      if(JSON.stringify(summary)!==JSON.stringify(item.relaxation.summary)||summary.finalStructureSha256!==sha(bytes.get("final.json")!))throw Error("STORED_RELAXATION_CHANGED");
      if(item.result!.potentialId!==item.plan.potentialId||item.result!.potentialSha256!==item.plan.potentialSha256||item.result!.atomCount!==item.structure.atoms.length||item.result!.completedSteps!==summary.completedSteps||item.result!.stopReason!==summary.stopReason||item.result!.energyEv!==summary.final.energyEv||Math.abs(Math.max(...item.result!.forcesEvPerAngstrom.map(f=>Math.hypot(...f)))-summary.final.maxForceEvPerAngstrom)>1e-8)throw Error("RELAXATION_RESULT_CHANGED");
      if(JSON.stringify(relaxationOptionsSchema.parse(JSON.parse(bytes.get("relaxation-settings.json")!.toString("utf8"))))!==JSON.stringify(item.relaxation.options)||JSON.stringify(atomisticPlanSchema.parse(JSON.parse(bytes.get("plan.json")!.toString("utf8"))))!==JSON.stringify(item.plan))throw Error("RELAXATION_PLAN_CHANGED");
      const after=atomicStructureSchema.parse(JSON.parse(bytes.get("final.json")!.toString("utf8")));
      relaxationComparisonSchema.parse({version:"m6.3-v1",projectId:item.job.projectId,runId:item.job.id,history:relaxationHistorySchema.parse(JSON.parse(bytes.get("steps.json")!.toString("utf8"))),before:item.structure,after,forcesEvPerAngstrom:item.result!.forcesEvPerAngstrom,summary});
      const history=relaxationHistorySchema.parse(JSON.parse(bytes.get("steps.json")!.toString("utf8")));
      if(JSON.stringify(history[0])!==JSON.stringify(summary.initial)||JSON.stringify(history.at(-1))!==JSON.stringify(summary.final))throw Error("HISTORY_SUMMARY_MISMATCH");
      if(after.source.sha256!==sha(bytes.get("final.extxyz")!))throw Error("FINAL_SOURCE_CHANGED");
    }
  }
  private artifactNames(item:AtomisticSnapshot,legacySinglepoint=false):Array<[string,"atomic_structure"|"atomic_trajectory"|"atomistic_result"|"validation_report"]>{
    const common:Array<[string,"atomic_structure"|"atomic_trajectory"|"atomistic_result"|"validation_report"]>=[["structure.json","atomic_structure"],["result.json","atomistic_result"],["validation.json","validation_report"]];
    if(item.plan.potentialId===COMPOSITE_ID)common.push(['composition.json','validation_report'],['physics-profile.json','validation_report'],['native-engine.json','validation_report']);
    if(item.plan.potentialId==='nep-si-2022-nep4-3body')common.push(['native-engine.json','validation_report']);
    if(item.plan.potentialId==='ani-2x-ensemble')common.push(["molecular-scope.json","validation_report"]);
    if(item.plan.selectionEvidenceIds.some(id=>id.startsWith("m64:")))common.push(["selection.json","validation_report"]);
    if(item.md)return [...common,["frames.ndjson","atomic_trajectory"],["trajectory.extxyz","atomic_trajectory"],["trajectory-index.json","validation_report"],["md-summary.json","validation_report"],["md-observables.json","validation_report"],["observables.csv","validation_report"],["md-settings.json","validation_report"],["plan.json","validation_report"],["environment.json","validation_report"],["report.zh.md","validation_report"],["report.en.md","validation_report"]];
    if(!item.relaxation&&!legacySinglepoint)return [...common,['plan.json','validation_report'],['environment.json','validation_report'],['report.zh.md','validation_report'],['report.en.md','validation_report']];
    return item.relaxation?[...common,["final.json","atomic_structure"],["final.extxyz","atomic_structure"],["relaxation.json","validation_report"],["steps.json","validation_report"],["observables.csv","validation_report"],["report.zh.md","validation_report"],["report.en.md","validation_report"],["relaxation-settings.json","validation_report"],["plan.json","validation_report"],["environment.json","validation_report"]]:common;
  }

  private save(item:AtomisticSnapshot):void {atomisticSnapshotSchema.parse(item);const path=join(this.stateDir,"jobs",`${item.job.id}.json`);
    writeFileSync(`${path}.tmp`,JSON.stringify(item,null,2)+"\n",{mode:0o600});renameSync(`${path}.tmp`,path);this.published.set(item.job.id,structuredClone(item));
    appendFileSync(join(this.stateDir,"jobs",`${item.job.id}.events.ndjson`),JSON.stringify({at:new Date().toISOString(),status:item.job.status,quality:item.job.quality,error:item.job.error})+"\n",{mode:0o600});}
  readonly packages:ModelPackageManager;
  readonly mountedPackages:PotentialPackageManager;
  packageInUse(id:string){return this.inspecting||[...this.jobs.values()].some(j=>j.plan.potentialId===id&&!terminal(j.job.status));}
  private sevenNetEnvironment(){
    const entry=this.mountedPackages.entry('sevennet-0-11jul2024');
    if(entry.family!=='sevennet'||!entry.platforms.some(r=>r.platform===this.platform&&r.device==='cpu'&&r.status==='verified'))throw Error('ADAPTER_BACKEND_NOT_VERIFIED');
    const base=join(this.root,existsSync(join(this.root,'atomistic-runtime'))?'atomistic-runtime':`runtime/atomistic/${this.platform}`,'sevennet');
    const receipt=sevenNetInstallationSchema.parse(JSON.parse(readFileSync(join(base,'RUNTIME.json'),'utf8')));
    if(receipt.platform!==this.platform||receipt.environmentProfileId!==entry.environmentProfileId||receipt.sourceRevision!==entry.sourceRevision||receipt.dependencyLockSha256!==entry.dependencyLockSha256||receipt.sha256!==entry.sha256||receipt.bytes!==entry.bytes)throw Error('RUNTIME_IDENTITY_MISMATCH');
    const python=receipt.portable?resolve(base,receipt.python):receipt.python;
    if(receipt.portable&&(isAbsolute(receipt.python)||receipt.python.includes('..')||relative(base,python).startsWith(`..${sep}`)))throw Error('UNSAFE_RUNTIME_PATH');
    if(!existsSync(python))throw Error('PYTHON_RUNTIME_MISSING');
    return {base,receipt,python};
  }
  private molecularEnvironment(){
    const entry=this.mountedPackages.entry('ani-2x-ensemble');
    if(entry.family!=='ani'||!entry.platforms.some(r=>r.platform===this.platform&&r.device==='cpu'&&r.status==='verified'))throw Error('ADAPTER_BACKEND_NOT_VERIFIED');
    const base=join(this.root,existsSync(join(this.root,'atomistic-runtime'))?'atomistic-runtime':`runtime/atomistic/${this.platform}`,'ani');
    const receipt=JSON.parse(readFileSync(join(base,'RUNTIME.json'),'utf8'));
    if(receipt.version!=='m6.13-v1'||receipt.portable!==true||receipt.platform!==this.platform||receipt.potentialId!==entry.potentialId||receipt.environmentProfileId!==entry.environmentProfileId||receipt.sourceRevision!==entry.sourceRevision||receipt.dependencyLockSha256!==entry.dependencyLockSha256||receipt.sha256!==entry.sha256||receipt.bytes!==entry.bytes||receipt.python!=='bin/python3.12')throw Error('RUNTIME_IDENTITY_MISMATCH');
    const python=join(base,receipt.python);if(!existsSync(python))throw Error('PYTHON_RUNTIME_MISSING');return {base,python,receipt};
  }
  private nativeEnvironment(){
    const m=nativeExpansion(this.root);if(!m||!m.entry.platforms.some(p=>p.platform===this.platform&&p.device==='cpu'&&p.status==='verified'))throw Error('ADAPTER_BACKEND_NOT_VERIFIED');
    const core=this.installation('chgnet-0.3.0',false),base=join(this.root,existsSync(join(this.root,'native-engines'))?'native-engines':`runtime/native-engines/${this.platform}`,'nep-cpu');
    const r=JSON.parse(readFileSync(join(base,'RUNTIME.json'),'utf8'));const binary=join(base,'nep-runner');
    if(r.version!=='m6.14-v1'||r.platform!==this.platform||r.binary!=='nep-runner'||r.sourceRevision!==m.engine.revision||r.sourceSha256!==sha(JSON.stringify(m.engine.sources))||r.dependencyLockSha256!==m.entry.dependencyLockSha256||lstatSync(binary).isSymbolicLink()||sha(readFileSync(binary))!==r.binarySha256||core.receipt.dependencyLockSha256!==m.entry.dependencyLockSha256)throw Error('NATIVE_ENGINE_IDENTITY_MISMATCH');
    return {...core,receipt:{...core.receipt,version:'m6.14-v1' as const,potentialId:m.entry.potentialId,environmentProfileId:m.entry.environmentProfileId,sourceRevision:m.entry.sourceRevision,sha256:m.entry.sha256,bytes:m.entry.bytes}};
  }
  isPotentialAllowed(id:string){try{this.assertUsable(id);return true;}catch{return false;}}
  private compositionEnvironment(){
    const m=physicsExpansion(this.root);if(!m||this.platform!=='macos-arm64')throw Error('COMPOSITION_BACKEND_NOT_VERIFIED');
    this.assertUsable(m.entry.basePotentialId);const core=this.installation(m.entry.basePotentialId,false),base=join(this.root,existsSync(join(this.root,'native-engines'))?'native-engines':`runtime/native-engines/${this.platform}`,'d3-bj'),r=JSON.parse(readFileSync(join(base,'RUNTIME.json'),'utf8')),binary=join(base,'d3-runner');
    if(r.version!=='m6.15-v1'||r.platform!==this.platform||r.binary!=='d3-runner'||r.sourceRevision!==m.engine.revision||r.sourceSha256!==sha(JSON.stringify(m.engine.sources))||r.profileSha256!==m.profileSha256||r.dependencyLockSha256!==m.entry.dependencyLockSha256||lstatSync(binary).isSymbolicLink()||sha(readFileSync(binary))!==r.binarySha256||core.receipt.dependencyLockSha256!==m.entry.dependencyLockSha256)throw Error('COMPOSITION_ENGINE_IDENTITY_MISMATCH');
    return {...core,receipt:{...core.receipt,version:'m6.15-v1' as const,potentialId:COMPOSITE_ID,environmentProfileId:m.entry.environmentProfileId}};
  }
  environmentReady(id:string){try{this.assertUsable(id);const e=this.mountedPackages.entry(id);if(id===COMPOSITE_ID)this.compositionEnvironment();else if(e.family==='nep')this.nativeEnvironment();else if(e.family==='ani')this.molecularEnvironment();else if(e.family==='sevennet')this.sevenNetEnvironment();else this.installation(e.basePotentialId,false);return true;}catch{return false;}}
  private installation(id:string,checkPolicy=true):{base:string;receipt:Omit<z.infer<typeof installationSchema>,"potentialId"|"version">&{potentialId:z.infer<typeof runnablePotentialId>;version:'m6.1-v1'|'m6.10-v1'|'m6.13-v1'|'m6.14-v1'|'m6.15-v1'};python:string;potential:import("../../contracts/src/potential-native.js").CurrentPotential;weight:string} {
    if(checkPolicy)this.assertUsable(id);runnablePotentialId.parse(id);const extension=this.mountedPackages.entries().find(e=>e.potentialId===id);const family=extension?.family??(id.startsWith("mace-")?"mace":"chgnet");
    if(id===COMPOSITE_ID){if(this.mountedPackages.disabled(id))throw Error('POTENTIAL_DISABLED');const r=this.compositionEnvironment();return {...r,potential:effectiveRegistry(this.root).potentials.find(p=>p.id===id)!};}
    if(extension?.family==='nep'){if(this.mountedPackages.disabled(id))throw Error('POTENTIAL_DISABLED');const environment=this.nativeEnvironment(),weight=this.mountedPackages.weight(id),potential=effectiveRegistry(this.root).potentials.find(p=>p.id===id)!;if(!existsSync(weight)||statSync(weight).size!==extension.bytes)throw Error('EXTENSION_PACKAGE_ABSENT');return {...environment,weight,potential};}
    if(extension?.family==='ani'){if(this.mountedPackages.disabled(id))throw Error('POTENTIAL_DISABLED');const environment=this.molecularEnvironment(),weight=this.mountedPackages.weight(id),potential=effectiveRegistry(this.root).potentials.find(p=>p.id===id)!;if(!existsSync(weight)||statSync(weight).size!==extension.bytes)throw Error('EXTENSION_PACKAGE_ABSENT');return {...environment,weight,potential};}
    if(extension?.family==='sevennet'){
      if(this.mountedPackages.disabled(id))throw Error('POTENTIAL_DISABLED');
      const environment=this.sevenNetEnvironment(),weight=this.mountedPackages.weight(id),potential=effectiveRegistry(this.root).potentials.find(p=>p.id===id)!;
      if(!existsSync(weight)||statSync(weight).size!==extension.bytes)throw Error('EXTENSION_PACKAGE_ABSENT');
      return {...environment,weight,potential};
    }
    const base=join(this.root,existsSync(join(this.root,"atomistic-runtime"))?"atomistic-runtime":`runtime/atomistic/${this.platform}`,family);
    const receipt=installationSchema.parse(JSON.parse(readFileSync(join(base,"RUNTIME.json"),"utf8")));
    const potential=effectiveRegistry(this.root).potentials.find(p=>p.id===id)!;
    if(this.mountedPackages.entries().some(e=>e.potentialId===id)) {
      if(this.mountedPackages.disabled(id))throw Error("POTENTIAL_DISABLED");
      const entry=this.mountedPackages.entry(id);
      const core=this.installation(entry.basePotentialId,false),weight=this.mountedPackages.weight(id);
      if(core.receipt.dependencyLockSha256!==entry.dependencyLockSha256||core.receipt.sourceRevision!==entry.sourceRevision)throw Error("PACKAGE_ENVIRONMENT_MISMATCH");
      if(!existsSync(weight)||statSync(weight).size!==potential.weights.bytes)throw Error("EXTENSION_PACKAGE_ABSENT");
      return {...core,potential,weight,receipt:{...core.receipt,potentialId:id,sha256:potential.weights.sha256!,bytes:potential.weights.bytes!}};
    }
    const lock=readFileSync(join(this.root,"atomistic/environments",family,"uv.lock"));
    if(receipt.platform!==this.platform||receipt.potentialId!==id||receipt.sha256!==potential.weights.sha256||receipt.bytes!==potential.weights.bytes||
       receipt.environmentProfileId!==potential.environment.profileId||receipt.sourceRevision!==potential.environment.codeRevision||receipt.dependencyLockSha256!==sha(lock))throw Error("RUNTIME_IDENTITY_MISMATCH");
    const python=receipt.portable?resolve(base,receipt.python):receipt.python;
    if(receipt.portable && (isAbsolute(receipt.python)||receipt.python.includes("..")||relative(base,python).startsWith(`..${sep}`)))throw Error("UNSAFE_RUNTIME_PATH");
    if(!existsSync(python))throw Error("PYTHON_RUNTIME_MISSING");
    const weightInfo=statSync(join(base,"checkpoint.bin"));if(!weightInfo.isFile()||weightInfo.size!==receipt.bytes)throw Error("WEIGHT_FILE_MISSING_OR_TRUNCATED");
    return {base,receipt,python,potential,weight:join(base,"checkpoint.bin")};
  }
  status():AtomisticRuntimeStatus[] {return ["mace-mp-0b3-medium","chgnet-0.3.0",...this.mountedPackages.entries().map(e=>e.potentialId)].map(potentialId=>{
    try{const {receipt}=this.installation(potentialId);return {potentialId,installed:true,portable:receipt.portable,platform:this.platform,dependencyLockSha256:receipt.dependencyLockSha256,error:null};}
    catch(e){return {potentialId,installed:false,portable:false,platform:this.platform,dependencyLockSha256:null,error:e instanceof Error&&['POTENTIAL_WITHDRAWN','TRUSTED_CATALOG_CACHE_INVALID'].includes(e.message)?e.message:potentialId===COMPOSITE_ID?"MACE+D3 组合环境未就绪；开发版运行 npm run m615:runtime / composition backend unavailable":potentialId==='nep-si-2022-nep4-3body'?"NEP 原生引擎或审核权重未就绪（仅 macOS arm64 CPU）；开发版请运行 npm run m614:runtime 并安装审核权重 / native engine or checkpoint absent":potentialId==='ani-2x-ensemble'?"ANI-2x 权重或匹配环境未就绪（仅 macOS arm64 CPU）；开发版请运行 npm run m613:runtime 并安装审核权重 / checkpoint or supported environment absent":potentialId==='sevennet-0-11jul2024'?"SevenNet 权重或匹配环境未就绪 / checkpoint or environment absent; npm run m610:runtime:dev":"未安装匹配的隔离运行时；开发版请运行 npm run m6:runtime:dev"};}
  });}
  private async readCapability(id:string,signal?:AbortSignal,force=false):Promise<CapabilityReceipt>{
    const r=this.installation(id),actual=await digestFile(r.weight,r.receipt.bytes);
    if(actual!==r.receipt.sha256)throw Error('PACKAGE_IDENTITY_MISMATCH');
    const key=`${id}:${r.receipt.environmentProfileId}:${actual}:${r.receipt.dependencyLockSha256}`;
    if(!force&&this.capabilityCache.has(key))return structuredClone(this.capabilityCache.get(key)!);
    if(this.running)throw Error('SCIENCE_BUSY');
    const cwd=join(this.stateDir,'capabilities',id);await mkdir(cwd,{recursive:true});let receipt:CapabilityReceipt|undefined;
    await runBoundedChild(r.python,join(this.root,'atomistic/worker.py'),{operation:'capabilities',root:this.root,potentialId:id,weight:r.weight,dependencyLockSha256:r.receipt.dependencyLockSha256},{cwd,seconds:60,...(signal?{signal}:{}),onEvent:e=>{if(e.event==='capabilities')receipt=capabilityReceiptSchema.parse(e.receipt);}});
    if(!receipt||receipt.sha256!==actual||receipt.potentialId!==id||receipt.dependencyLockSha256!==r.receipt.dependencyLockSha256)throw Error('CAPABILITY_IDENTITY_MISMATCH');
    this.capabilityCache.set(key,receipt);return structuredClone(receipt);
  }
  async checkpointFile(id:string){const r=this.installation(runnablePotentialId.parse(id));if(await digestFile(r.weight,r.receipt.bytes)!==r.receipt.sha256)throw Error('PACKAGE_IDENTITY_MISMATCH');return r.weight;}
  /** Loads in a bounded worker and returns actual capabilities; it is not a resident inference service. */
  async loadPotential(id:string):Promise<CapabilityReceipt>{
    runnablePotentialId.parse(id);this.assertUsable(id);
    if(this.disposed)throw Error('RUNTIME_CLOSED');
    if(this.inspecting||this.running||this.mountedPackages.operationBusy(id))throw Error('SCIENCE_BUSY');
    this.inspecting=true;
    try{return await this.readCapability(id,undefined,true);}finally{this.inspecting=false;void this.pump();}
  }
  async assess(input:unknown,signal?:AbortSignal):Promise<SelectionAssessment>{
    const request=selectionRequestSchema.parse(input);const structure=this.inspect({projectId:request.projectId,structureId:request.structureId});
    await this.view({kind:"import",projectId:request.projectId,structureId:structure.id});
    if(this.inspecting)throw Error("SCIENCE_BUSY: wait for the active import/selection");
    this.inspecting=true;
    try{
      const registry=effectiveRegistry(this.root);const registryBytes=Buffer.from(JSON.stringify(registry));const capabilities:CapabilityReceipt[]=[];
      for(const installed of this.status().filter(s=>s.installed)){
        signal?.throwIfAborted();
        try{capabilities.push(await this.readCapability(installed.potentialId,signal));}
        catch(e){if(signal?.aborted)throw e;}

      }
      const assessment=assessPotentials(registry,digest(registryBytes),structure,request,capabilities);
      this.assessments.set(assessment.id,assessment);if(this.assessments.size>100)this.assessments.delete(this.assessments.keys().next().value!);
      await mkdir(join(this.stateDir,"selections"),{recursive:true});await writeFile(join(this.stateDir,"selections",`${assessment.id}.json`),JSON.stringify(assessment,null,2)+"\n",{flag:"wx",mode:0o600});
      return structuredClone(assessment);
    }finally{this.inspecting=false;void this.pump();}
  }
  async startSelected(input:unknown,signal?:AbortSignal):Promise<AtomisticSnapshot>{
    const request=selectedRunSchema.parse(input),previous=this.assessments.get(request.proposal.assessmentId);
    if(!previous||previous.request.projectId!==request.projectId)throw Error("ASSESSMENT_NOT_OWNED");
    validateProposal(previous,request.proposal);
    const fresh=await this.assess(previous.request,signal);
    if(fresh.registrySha256!==previous.registrySha256||fresh.structureSha256!==previous.structureSha256)throw Error("ASSESSMENT_STALE");
    validateProposal(fresh,{...request.proposal,assessmentId:fresh.id});
    if((previous.request.task==='relaxation')!==!!request.options||(previous.request.task==='md')!==!!request.mdOptions)throw Error("SELECTION_TASK_MISMATCH");
    signal?.throwIfAborted();
    return this.enqueue({projectId:request.projectId,structureId:previous.request.structureId,potentialId:request.proposal.selectedPotentialId,...(previous.request.budget?{budget:previous.request.budget}:{})},this.project(request.projectId),this.inspect({projectId:previous.request.projectId,structureId:previous.request.structureId}),'agent-tool-request',request.options,previous,request.mdOptions);
  }
  async importSample(projectId:string,sampleId:string):Promise<AtomicStructure>{
    const manifest=JSON.parse(await readFile(join(this.root,"samples/atomistic/MANIFEST.json"),"utf8")) as {samples:Array<{id:string;file:string;sha256:string;expected:string}>};
    const molecularSamples=join(this.root,'samples/atomistic/molecules-m613.json');if(existsSync(molecularSamples))manifest.samples.push(...JSON.parse(await readFile(molecularSamples,'utf8')).samples);
    const sample=manifest.samples.find(s=>s.id===sampleId&&s.expected==='parse-valid');if(!sample||!/^[a-zA-Z0-9_.-]+$/.test(sample.file))throw Error("UNKNOWN_BUNDLED_SAMPLE");
    const data=await readOwnedBytes(this.root,join(this.root,"samples/atomistic",sample.file),sample.sha256);if(!data.length)throw Error("EMPTY_SAMPLE");
    return this.importFile(projectId,join(this.root,"samples/atomistic",sample.file),sample.id);
  }
  async importFile(projectId:string,path:string,bundledSampleId?:string):Promise<AtomicStructure> {
    this.project(projectId);if(this.disposed)throw Error("RUNTIME_CLOSED");if(this.inspecting)throw Error("IMPORT_BUSY");
    this.inspecting=true;
    try {
      const source=await realpath(path);const info=await stat(source);
      if(!info.isFile()||info.size>4*1024*1024||info.size===0)throw Error("STRUCTURE_SIZE_LIMIT");
      const id=randomUUID();const directory=join(this.stateDir,"sources",id);await mkdir(directory,{recursive:true});
      const format=["poscar","contcar"].includes(basename(source).toLowerCase())?"poscar":extname(source).slice(1).toLowerCase();
      if(!["cif","xyz","extxyz","poscar"].includes(format))throw Error("UNSUPPORTED_STRUCTURE_FORMAT");
      const snapshot=join(directory,`source.${format}`);await copyFile(source,snapshot);
      if((await stat(snapshot)).size>4*1024*1024)throw Error("STRUCTURE_SIZE_LIMIT");
      const runtime=this.status().find(s=>s.installed);if(!runtime)throw Error("ATOMISTIC_RUNTIME_NOT_INSTALLED");
      const {python}=this.installation(runtime.potentialId);let structure:AtomicStructure|undefined;
      await runBoundedChild(python,join(this.root,"atomistic/worker.py"),{operation:"inspect",root:this.root,source:snapshot,structureId:id,artifactId:id},
        {cwd:directory,seconds:30,onEvent:event=>{if(event.event==="structure")structure=atomicStructureSchema.parse(event.structure);}});
      if(!structure||structure.id!==id||structure.source.sha256!==sha(await readFile(snapshot)))throw Error("IMPORT_IDENTITY_MISMATCH");
      if(bundledSampleId){structure.source.provenance="team-synthetic";structure.source.license="AGPL-3.0-only";structure.source.transformations.push(`Verified bundled sample ${bundledSampleId}; source hash checked against MANIFEST.json`);}
      const record={projectId,structure};this.imports.set(id,record);
      await writeFile(join(this.stateDir,"imports",`${id}.json`),JSON.stringify(record,null,2)+"\n",{mode:0o600});
      return structuredClone(structure);
    } finally {this.inspecting=false;}
  }
  async annotateElectronicState(input:unknown):Promise<AtomicStructure>{
    const q=electronicStateRequestSchema.parse(input),original=this.inspect({projectId:q.projectId,structureId:q.structureId});await this.view({kind:'import',projectId:q.projectId,structureId:q.structureId});
    if(original.pbc.some(Boolean))throw Error('MOLECULE_REQUIRES_ISOLATED_BOUNDARY');
    const structure=structuredClone(original),id=randomUUID();structure.id=id;structure.charge=q.charge;structure.spinMultiplicity=q.spinMultiplicity;
    if(q.addDisplayBox&&!structure.cell){const lengths=[0,1,2].map(k=>Math.max(...structure.atoms.map(a=>a.position[k]!))-Math.min(...structure.atoms.map(a=>a.position[k]!))+20);structure.cell=[[lengths[0]!,0,0],[0,lengths[1]!,0],[0,0,lengths[2]!]];structure.source.transformations.push('User explicitly added a nonperiodic display box: coordinate span + 20 angstrom per axis; coordinates unchanged; not a physical molecular volume.');}
    const lattice=structure.cell?`Lattice="${structure.cell.flat().join(' ')}" `:'';
    const data=`${structure.atoms.length}\n${lattice}Properties=species:S:1:pos:R:3 pbc="F F F" charge=${q.charge} spinMultiplicity=${q.spinMultiplicity}\n`+structure.atoms.map(a=>`${a.element} ${a.position.join(' ')}`).join('\n')+'\n';
    structure.source={...structure.source,artifactId:id,format:'extxyz',sha256:sha(data),transformations:[...structure.source.transformations,`User explicitly declared charge=${q.charge}, spinMultiplicity=${q.spinMultiplicity}; derived from ${original.id} source SHA256 ${original.source.sha256}`]};
    structure.issues=structure.issues.filter(i=>i.code!=='MOLECULE_NO_CHARGE_SPIN');atomicStructureSchema.parse(structure);
    const directory=join(this.stateDir,'sources',id);await mkdir(directory,{recursive:true});await writeFile(join(directory,'source.extxyz'),data,{flag:'wx',mode:0o600});
    const record={projectId:q.projectId,structure};await writeFile(join(this.stateDir,'imports',id+'.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});this.imports.set(id,record);return structuredClone(structure);
  }
  inspect(input:unknown):AtomicStructure {const {projectId,structureId}=inspectAtomisticSchema.parse(input);this.project(projectId);
    const record=this.imports.get(structureId);if(!record||record.projectId!==projectId)throw Error("STRUCTURE_NOT_OWNED");return structuredClone(record.structure);}
  async view(input:unknown):Promise<AtomicViewPayload> {
    const request=atomicViewRequestSchema.parse(input);this.project(request.projectId);
    if(request.kind==="import") {
      const structure=this.inspect({projectId:request.projectId,structureId:request.structureId});
      await readOwnedBytes(this.stateDir,join(this.stateDir,"sources",structure.id,`source.${structure.source.format}`),structure.source.sha256);
      return atomicViewPayloadSchema.parse({version:"m6.2-v1",request,structure,forcesEvPerAngstrom:null,quality:"unreviewed"});
    }
    const item=this.get({projectId:request.projectId,runId:request.runId});
    const artifact=item.artifacts.find(a=>a.id===request.artifactId&&a.type==="atomic_structure"&&!a.partial);
    if(item.job.status!=="completed"||!artifact||!item.result)throw Error("STRUCTURE_ARTIFACT_NOT_AVAILABLE");
    await this.verifyStoredResult(item);
    const bytes=await readOwnedBytes(this.project(request.projectId),join(item.outputDirectory,artifact.relativePath.endsWith("/structure.json")?"structure.json":"final.json"),item.artifacts.find(a=>a.relativePath.endsWith(artifact.relativePath.endsWith("/structure.json")?"/structure.json":"/final.json"))!.sha256,2*1024*1024);
    const structure=atomicStructureSchema.parse(JSON.parse(bytes.toString("utf8")));
    const final=artifact.relativePath.endsWith("/final.json")||artifact.relativePath.endsWith("/final.extxyz");
    if(!final&&(structure.id!==item.structure.id||JSON.stringify(structure)!==JSON.stringify(item.structure)))throw Error("STRUCTURE_IDENTITY_MISMATCH");
    return atomicViewPayloadSchema.parse({version:"m6.2-v1",request,structure,forcesEvPerAngstrom:item.md||item.relaxation&&!final?null:item.result.forcesEvPerAngstrom,quality:"needs_review"});
  }
  async originalStructure(input:unknown):Promise<{bytes:Buffer;format:string}> {
    const payload=await this.view(input);const {structure,request}=payload;
    const root=request.kind==="import"?this.stateDir:this.project(request.projectId);
    const directory=request.kind==="import"?join(this.stateDir,"sources",structure.id):this.get({projectId:request.projectId,runId:request.runId}).outputDirectory;
    return {bytes:await readOwnedBytes(root,join(directory,request.kind==="artifact"&&structure.id!==this.get({projectId:request.projectId,runId:request.runId}).structure.id?"final.extxyz":`source.${structure.source.format}`),structure.source.sha256),format:structure.source.format};
  }
  async start(input:unknown,origin:"explicit-user-choice"|"agent-tool-request"="explicit-user-choice"):Promise<AtomisticSnapshot> {
    const request=startAtomisticSchema.parse(input);const project=this.project(request.projectId);if(this.disposed)throw Error("RUNTIME_CLOSED");
    if(this.queue.length>=8)throw Error("ATOMISTIC_QUEUE_FULL");
    const structure=this.inspect({projectId:request.projectId,structureId:request.structureId});
    return this.enqueue(request,project,structure,origin);
  }
  async startRelaxation(input:unknown,origin:"explicit-user-choice"|"agent-tool-request"="explicit-user-choice"):Promise<AtomisticSnapshot>{
    const request=startRelaxationSchema.parse(input);const project=this.project(request.projectId);if(this.disposed)throw Error("RUNTIME_CLOSED");if(this.queue.length>=8)throw Error("ATOMISTIC_QUEUE_FULL");
    const structure=this.inspect({projectId:request.projectId,structureId:request.structureId});
    return this.enqueue(request,project,structure,origin,request.options);
  }
  async startMD(input:unknown,origin:"explicit-user-choice"|"agent-tool-request"="explicit-user-choice"):Promise<AtomisticSnapshot>{const q=startMDSchema.parse(input);return this.enqueue(q,this.project(q.projectId),this.inspect({projectId:q.projectId,structureId:q.structureId}),origin,undefined,undefined,q.mdOptions);}
  private async trajectoryRecord(input:unknown){const q=trajectoryRequestSchema.parse(input),item=this.get(q);if(!terminal(item.job.status)||!item.md?.trajectoryArtifactId)throw Error("TRAJECTORY_NOT_AVAILABLE");const expected=join(await realpath(this.project(q.projectId)),"materials-output/atomistic",q.runId);if(item.outputDirectory!==expected)throw Error("TRAJECTORY_OUTPUT_SCOPE");const index=await readMDIndex(this.project(q.projectId),item);return {q,item,index};}
  async trajectory(input:unknown){const {q,item,index}=await this.trajectoryRecord(input);return trajectoryPayloadSchema.parse({version:"m6.5-v1",...q,potentialId:item.plan.potentialId,history:item.job.status==="completed"?await readMDHistory(this.project(q.projectId),item):null,structure:item.structure,index,summary:item.md!.summary,partial:item.job.status!=="completed"});}
  async trajectoryFrame(input:unknown){const q=frameRequestSchema.parse(input);const {frame,...query}=q;const {item,index}=await this.trajectoryRecord(query);return readMDFrame(this.project(q.projectId),item,index,frame);}
  async trajectoryExport(input:unknown,write:(bytes:Buffer)=>Promise<void>){const q=trajectoryRequestSchema.parse(input),item=this.get(q),payload=await this.trajectory(q);const artifact=item.artifacts.find(a=>a.relativePath.endsWith("/trajectory.extxyz"))!;await hashOwnedFile(this.project(q.projectId),join(item.outputDirectory,"trajectory.extxyz"),artifact.sha256,item.plan.budget.maxOutputMiB*1048576);for(const e of payload.index.entries)await write(await readOwnedRange(this.project(q.projectId),join(item.outputDirectory,"trajectory.extxyz"),e.extxyz,item.plan.budget.maxOutputMiB*1048576));}
  async compareMD(input:unknown){const q=mdComparisonRequestSchema.parse(input);const runs=q.runIds.map(runId=>this.get({projectId:q.projectId,runId}));const [a,b]=runs;if(!a!.md?.summary||!b!.md?.summary||a!.job.status!=="completed"||b!.job.status!=="completed"||a!.plan.potentialId===b!.plan.potentialId||a!.plan.structureSha256!==b!.plan.structureSha256||JSON.stringify(a!.md.options)!==JSON.stringify(b!.md.options)||a!.md.summary.initialVelocitySha256!==b!.md.summary.initialVelocitySha256)throw Error("MD_COMPARISON_SCOPE_MISMATCH");for(const r of runs)await this.verifyStoredResult(r);return mdComparisonSchema.parse({version:"m6.5-v1",...q,potentialIds:runs.map(r=>r.plan.potentialId),series:await Promise.all(runs.map(r=>readMDHistory(this.project(q.projectId),r))),energyDefinition:"within-model-total-energy-change-per-atom",quality:"needs_review"});}
  async comparison(input:unknown){
    const query=getAtomisticSchema.parse(input);const item=this.get(query);if(item.job.status!=="completed"||!item.relaxation?.summary||!item.result)throw Error("RELAXATION_NOT_COMPLETED");
    await this.verifyStoredResult(item);const artifact=item.artifacts.find(a=>a.relativePath.endsWith("/final.json"))!;
    const after=atomicStructureSchema.parse(JSON.parse((await readOwnedBytes(this.project(query.projectId),join(item.outputDirectory,"final.json"),artifact.sha256)).toString("utf8")));
    const historyArtifact=item.artifacts.find(a=>a.relativePath.endsWith("/steps.json"))!;
    const history=relaxationHistorySchema.parse(JSON.parse((await readOwnedBytes(this.project(query.projectId),join(item.outputDirectory,"steps.json"),historyArtifact.sha256)).toString("utf8")));
    return relaxationComparisonSchema.parse({version:"m6.3-v1",...query,history,before:item.structure,after,forcesEvPerAngstrom:item.result.forcesEvPerAngstrom,summary:item.relaxation.summary});
  }
  async useOutputStructure(input:unknown):Promise<AtomicStructure>{
    const query=getAtomisticSchema.parse(input);const item=this.get(query);if(!terminal(item.job.status))throw Error("JOB_NOT_TERMINAL");
    if(item.md){const payload=await this.trajectory(query);const frame=await this.trajectoryFrame({...query,frame:payload.index.entries.length-1});const structure=structuredClone(item.structure);structure.atoms.forEach((a,i)=>a.position=frame.positionsAngstrom[i]!);
      const id=randomUUID(),dir=join(this.stateDir,"derived",id);await mkdir(dir,{recursive:true});const cell=structure.cell!.flat().join(" "),raw=`${structure.atoms.length}\nLattice="${cell}" Properties=species:S:1:pos:R:3 pbc="T T T"\n`+structure.atoms.map(a=>`${a.element} ${a.position.join(" ")}`).join("\n")+"\n";const path=join(dir,"geometry.extxyz");await writeFile(path,raw,{flag:"wx"});const imported=await this.importFile(query.projectId,path);imported.source.provenance=item.structure.source.provenance;imported.source.license=item.structure.source.license;imported.source.transformations.push(`New segment from MD ${item.job.id}, actual step ${frame.step.step}, time ${frame.step.timeFs} fs; velocities, integrator and RNG state are NOT resumed`);this.imports.set(imported.id,{projectId:query.projectId,structure:imported});await writeFile(join(this.stateDir,"imports",`${imported.id}.json`),JSON.stringify({projectId:query.projectId,structure:imported},null,2)+"\n",{mode:0o600});return imported;}
    if(!item.relaxation)throw Error("NO_GEOMETRY_CHECKPOINT");
    if(item.job.status==="completed"){
      await this.comparison(query);const raw=item.artifacts.find(a=>a.relativePath.endsWith("/final.extxyz"))!;
      await readOwnedBytes(this.project(query.projectId),join(item.outputDirectory,"final.extxyz"),raw.sha256);return this.importDerived(item,"final.extxyz");
    }
    const artifact=item.artifacts.find(a=>a.id===item.relaxation?.partialArtifactId&&a.partial);if(!artifact)throw Error("NO_VALID_CHECKPOINT");
    const bytes=await readOwnedBytes(this.project(query.projectId),join(item.outputDirectory,"last-valid.json"),artifact.sha256);
    const checkpoint=relaxationCheckpointSchema.parse(JSON.parse(bytes.toString("utf8")));this.validateCheckpoint(item,checkpoint);
    await readOwnedBytes(this.project(query.projectId),join(item.outputDirectory,"last-valid.extxyz"),checkpoint.structure.source.sha256);
    return this.importDerived(item,"last-valid.extxyz");
  }
  private async importDerived(item:AtomisticSnapshot,name:"final.extxyz"|"last-valid.extxyz"){
    const structure=await this.importFile(item.job.projectId,join(item.outputDirectory,name));
    structure.source.provenance=item.structure.source.provenance;structure.source.license=item.structure.source.license;
    structure.source.transformations=[`New task geometry from run ${item.job.id}/${name}; parent structure ${item.structure.id}; SHA256 ${structure.source.sha256}`,"Fresh FIRE task; optimizer velocities/state are not resumed"];
    const record=importSchema.parse({projectId:item.job.projectId,structure});this.imports.set(structure.id,record);
    await writeFile(join(this.stateDir,"imports",`${structure.id}.json`),JSON.stringify(record,null,2)+"\n",{mode:0o600});return structuredClone(structure);
  }
  private validateCheckpoint(item:AtomisticSnapshot,checkpoint:z.infer<typeof relaxationCheckpointSchema>){
    if(checkpoint.runId!==item.job.id||checkpoint.planId!==item.plan.id||checkpoint.structure.id!==`${item.job.id}:last-valid`||checkpoint.structure.atoms.length!==item.structure.atoms.length||checkpoint.step.step>(item.relaxation?.options.maxSteps??0)||checkpoint.structure.atoms.some((a,i)=>a.id!==item.structure.atoms[i]!.id||a.element!==item.structure.atoms[i]!.element||a.occupancy!==item.structure.atoms[i]!.occupancy)||JSON.stringify(checkpoint.structure.pbc)!==JSON.stringify(item.structure.pbc)||checkpoint.structure.charge!==item.structure.charge||checkpoint.structure.spinMultiplicity!==item.structure.spinMultiplicity||item.relaxation?.options.cellMode==="fixed"&&JSON.stringify(checkpoint.structure.cell)!==JSON.stringify(item.structure.cell))throw Error("CHECKPOINT_IDENTITY_MISMATCH");
  }
  private async publishManifest(item:AtomisticSnapshot){
    const directory=await ownedDirectory(this.project(item.job.projectId),item.job.id);if(directory!==item.outputDirectory)throw Error("OUTPUT_IDENTITY_MISMATCH");
    const temp=join(directory,`artifacts.${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(item.artifacts,null,2)+"\n",{flag:"wx",mode:0o600});renameSync(temp,join(directory,"artifacts.json"));
  }
  private async partialCheckpoint(item:AtomisticSnapshot){
    if(item.md){
      try{const bytes=await readOwnedBytes(this.project(item.job.projectId),join(item.outputDirectory,"trajectory-index.json"),null);const index=mdIndexSchema.parse(JSON.parse(bytes.toString()));validateIndex(item,index);
        for(const e of index.entries){await readMDFrame(this.project(item.job.projectId),item,index,e.index);await readOwnedRange(this.project(item.job.projectId),join(item.outputDirectory,"trajectory.extxyz"),e.extxyz,item.plan.budget.maxOutputMiB*1048576);}
        for(const name of ["frames.ndjson","trajectory.extxyz","trajectory-index.json"]){const d=await hashOwnedFile(this.project(item.job.projectId),join(item.outputDirectory,name),null,item.plan.budget.maxOutputMiB*1048576);item.artifacts.push(atomisticArtifactSchema.parse({schemaVersion:"m6.0-v1",id:randomUUID(),projectId:item.job.projectId,runId:item.job.id,type:name==="trajectory-index.json"?"validation_report":"atomic_trajectory",relativePath:`materials-output/atomistic/${item.job.id}/${name}`,...d,structureId:item.structure.id,frames:name==="trajectory-index.json"?null:index.entries.length,partial:true}));}
        item.md.trajectoryArtifactId=item.artifacts[0]!.id;item.md.progress=(await readMDFrame(this.project(item.job.projectId),item,index,index.entries.length-1)).step;await this.publishManifest(item);
      }catch{item.artifacts=[];item.md.trajectoryArtifactId=null;}return;
    }
    if(!item.relaxation)return;
    try{const bytes=await readOwnedBytes(this.project(item.job.projectId),join(item.outputDirectory,"last-valid.json"),null);const checkpoint=relaxationCheckpointSchema.parse(JSON.parse(bytes.toString("utf8")));this.validateCheckpoint(item,checkpoint);
      const raw=await readOwnedBytes(this.project(item.job.projectId),join(item.outputDirectory,"last-valid.extxyz"),checkpoint.structure.source.sha256);
      for(const [name,data] of [["last-valid.json",bytes],["last-valid.extxyz",raw]] as const)item.artifacts.push(atomisticArtifactSchema.parse({schemaVersion:"m6.0-v1",id:randomUUID(),projectId:item.job.projectId,runId:item.job.id,type:"atomic_structure",relativePath:`materials-output/atomistic/${item.job.id}/${name}`,sha256:sha(data),bytes:data.length,structureId:checkpoint.structure.id,frames:null,partial:true}));
      item.relaxation.partialArtifactId=item.artifacts[0]!.id;item.relaxation.progress=checkpoint.step;await this.publishManifest(item);
    }catch{/* No checkpoint is claimed when its real files are absent, inconsistent or incomplete. */}
  }
  private async enqueue(request:z.infer<typeof startAtomisticSchema>,project:string,structure:AtomicStructure,origin:"explicit-user-choice"|"agent-tool-request",options?:RelaxationOptions,assessment?:SelectionAssessment,mdOptions?:MDOptions):Promise<AtomisticSnapshot> {
    if(this.disposed)throw Error("RUNTIME_CLOSED");if(this.queue.length>=8)throw Error("ATOMISTIC_QUEUE_FULL");
    if(mdOptions&&! ["mace-mp-0b3-medium","chgnet-0.3.0","chgnet-r2scan"].includes(request.potentialId))throw Error("MOUNTED_MD_NOT_VERIFIED");
    if(structure.issues.some(i=>i.severity==="blocking")||structure.atoms.some(a=>a.occupancy!==1))throw Error("STRUCTURE_HAS_BLOCKING_ISSUES");
    const molecular=request.potentialId==='ani-2x-ensemble';
    if(!molecular&&!structure.pbc.every(Boolean))throw Error("CORE_REQUIRES_BULK_PBC");
    if(request.potentialId==='nep-si-2022-nep4-3body'&&options?.cellMode==='variable')throw Error('NEP_FIXED_CELL_REQUIRED');
    if(request.potentialId===COMPOSITE_ID&&options?.cellMode==='variable')throw Error('COMPOSITION_FIXED_CELL_REQUIRED');
    if(molecular&&options&&(options.cellMode!=='fixed'||!structure.cell))throw Error("MOLECULAR_FIXED_BOX_REQUIRED");
    assessment??=await this.assess({projectId:request.projectId,structureId:request.structureId,domain:molecular?"molecules":"inorganic-crystals",mode:"exploratory",task:mdOptions?"md":options?"relaxation":"singlepoint",...(request.budget?{budget:request.budget}:{})});
    const candidate=assessment.selection.candidates.find(c=>c.potentialId===request.potentialId);
    if(!candidate)throw Error(`POTENTIAL_EXCLUDED: ${assessment.selection.exclusions.find(c=>c.potentialId===request.potentialId)?.reasonCodes.join(",")}`);
    const runtime=this.installation(request.potentialId);
    const budget=request.budget??{maxAtoms:256,maxSteps:mdOptions?.steps??options?.maxSteps??1,maxWallSeconds:600,maxMemoryMiB:4096,maxOutputMiB:64,threads:4};
    if(mdOptions&&mdOptions.steps>budget.maxSteps)throw Error("STEP_BUDGET_EXCEEDED");
    if(mdOptions&&structure.atoms.some(a=>["H","He"].includes(a.element))&&mdOptions.timestepFs>.25)throw Error("MD_LIGHT_ELEMENT_TIMESTEP_LIMIT");
    if(options&&options.maxSteps>budget.maxSteps)throw Error("STEP_BUDGET_EXCEEDED");
    if(options?.cellMode==="variable"&&runtime.potential.declared.stress!=="yes")throw Error("STRESS_NOT_SUPPORTED");
    if(options?.cellMode==='variable'&&runtime.potential.family==='SevenNet')throw Error('ADAPTER_VARIABLE_CELL_NOT_VERIFIED');
    if(structure.atoms.length>budget.maxAtoms)throw Error("ATOM_COUNT_LIMIT");
    const id=randomUUID();const directory=await ownedDirectory(project,id);
    const data=JSON.stringify(structure,null,2)+"\n";await writeFile(join(directory,"structure.json"),data,{flag:"wx"});
    const sourceDirectory=join(this.stateDir,"sources",structure.id);
    await copyFile(join(sourceDirectory,`source.${structure.source.format}`),join(directory,`source.${structure.source.format}`));
    if(sha(await readFile(join(directory,`source.${structure.source.format}`)))!==structure.source.sha256)throw Error("SOURCE_IDENTITY_MISMATCH");
    const plan=atomisticPlanSchema.parse({schemaVersion:"m6.0-v1",id,projectId:request.projectId,structureId:structure.id,structureSha256:sha(data),
      potentialId:request.potentialId,potentialSha256:runtime.receipt.sha256,environmentProfileId:runtime.receipt.environmentProfileId,
      device:"cpu",dtype:["MACE","ANI","NEP"].includes(runtime.potential.family)?"float64":"float32",head:null,task:mdOptions?{kind:"md",...Object.fromEntries(Object.entries(mdOptions).filter(([k])=>k!=="frictionInverseFs"))}:options?{kind:"relaxation",optimizer:"FIRE",cellMode:options.cellMode,maxSteps:options.maxSteps,fmaxEvPerAngstrom:options.fmaxEvPerAngstrom,externalPressureGPa:options.externalPressureGPa}:{kind:"singlepoint"},budget,qualityPolicyId:molecular?"m6-molecular-screening-v1":"m6-inorganic-screening-v1",selectionEvidenceIds:[origin,`m64:${assessment.id}`,...candidate.evidenceIds]});
    const trace=structuredClone(assessment);trace.selection.selectedPotentialId=request.potentialId;
    await writeFile(join(directory,"selection.json"),JSON.stringify(trace,null,2)+"\n",{flag:"wx",mode:0o600});
    await writeFile(join(directory,"plan.json"),JSON.stringify(plan,null,2)+"\n",{flag:"wx"});
    if(options)await writeFile(join(directory,"relaxation-settings.json"),JSON.stringify(options,null,2)+"\n",{flag:"wx"});
    if(mdOptions)await writeFile(join(directory,"md-settings.json"),JSON.stringify(mdOptions,null,2)+"\n",{flag:"wx"});
    const item=atomisticSnapshotSchema.parse({...(mdOptions?{md:{options:mdOptions,progress:null,summary:null,trajectoryArtifactId:null}}:{}),...(options?{relaxation:{options,progress:null,summary:null,partialArtifactId:null}}:{}),job:{schemaVersion:"m6.0-v1",id,projectId:request.projectId,planId:id,status:"queued",quality:"unreviewed",createdAt:new Date().toISOString(),finishedAt:null,resultArtifactId:null,error:null},plan,structure,result:null,artifacts:[],outputDirectory:directory});
    this.jobs.set(id,item);this.save(item);this.queue.push(id);void this.pump();return structuredClone(item);
  }
  async composition(input:unknown){
    const q=getAtomisticSchema.parse(input),item=this.get(q);
    if(item.job.status!=='completed'||item.plan.potentialId!==COMPOSITE_ID)throw Error('COMPOSITION_NOT_COMPLETED');
    await this.verifyStoredResult(item);const a=item.artifacts.find(a=>a.relativePath.endsWith('/composition.json'))!;
    return compositionResultSchema.parse(JSON.parse((await readOwnedBytes(this.project(q.projectId),join(item.outputDirectory,'composition.json'),a.sha256,2*1024*1024)).toString()));
  }
  async reproductionReceipt(input:unknown){
    const item=this.get(input);if(item.job.status!=='completed'||!item.result)throw Error('RECEIPT_REQUIRES_COMPLETED_RUN');await this.verifyStoredResult(item);
    const registered=item.artifacts.find(a=>a.relativePath.endsWith('/environment.json'));
    const environment=JSON.parse((await readOwnedBytes(this.project(item.job.projectId),join(item.outputDirectory,'environment.json'),registered?.sha256??null)).toString());
    if(environment.potentialId!==item.plan.potentialId||environment.sha256!==item.plan.potentialSha256||environment.environmentProfileId!==item.plan.environmentProfileId||!environment.dependencyLockSha256)throw Error('RECEIPT_ENVIRONMENT_MISMATCH');
    const payload={version:'m6.12-v1',runId:item.job.id,completedAt:item.job.finishedAt!,platform:environment.platform??'unknown-legacy',quality:'needs_review',structure:item.structure,plan:item.plan,result:item.result,artifacts:item.artifacts,environment:{dependencyLockSha256:environment.dependencyLockSha256,sourceRevision:environment.sourceRevision??null,versions:environment.versions,registeredArtifact:!!registered},taskOptions:item.md?.options??item.relaxation?.options??null,bitwiseReproductionGuaranteed:false};
    return reproductionReceiptSchema.parse({payload,payloadSha256:hash(canonical(payload))});
  }
  get(input:unknown):AtomisticSnapshot {const {projectId,runId}=getAtomisticSchema.parse(input);this.project(projectId);const item=this.published.get(runId);
    if(!item||item.job.projectId!==projectId)throw Error("JOB_NOT_OWNED");return structuredClone(item);}
  list(projectId:string):AtomisticSnapshot[] {this.project(projectId);return [...this.published.values()].filter(i=>i.job.projectId===projectId).slice(-100).reverse().map(i=>structuredClone(i));}
  listStructures(projectId:string):AtomicStructure[] {this.project(projectId);return [...this.imports.values()].filter(i=>i.projectId===projectId).slice(-100).map(i=>structuredClone(i.structure));}
  cancel(input:unknown):boolean {const snapshot=this.get(input);const item=this.jobs.get(snapshot.job.id)!;if(terminal(item.job.status))return false;
    if(this.running===item.job.id){item.job.status="cancelling";this.save(item);this.controller?.abort();}
    else {this.queue=this.queue.filter(id=>id!==item.job.id);item.job.status="cancelled";item.job.finishedAt=new Date().toISOString();item.job.quality="needs_review";this.save(item);}return true;}
  private async pump():Promise<void> {
    if(this.running||this.inspecting||this.disposed)return;const id=this.queue.shift();if(!id)return;this.running=id;this.controller=new AbortController();
    const item=this.jobs.get(id)!;item.job.status="validating";this.save(item);
    try {
      const runtime=this.installation(item.plan.potentialId);
      const directory=await ownedDirectory(this.project(item.job.projectId),id);if(directory!==item.outputDirectory)throw Error("OUTPUT_IDENTITY_MISMATCH");
      let completed=false;
      await runBoundedChild(runtime.python,join(this.root,"atomistic/worker.py"),{operation:item.plan.task.kind,relaxationOptions:item.relaxation?.options,mdOptions:item.md?.options,root:this.root,directory,weight:runtime.weight,runId:id,plan:item.plan,dependencyLockSha256:runtime.receipt.dependencyLockSha256,sourceRevision:runtime.receipt.sourceRevision},
        {cwd:directory,seconds:item.plan.budget.maxWallSeconds,signal:this.controller.signal,onEvent:event=>{
          if(event.event==="md_step"&&item.md&&item.job.status!=="cancelling"){item.md.progress=mdStepSchema.parse(event.step);this.save(item);}
          if(event.event==="relaxation_step"&&item.relaxation&&item.job.status!=="cancelling"){item.relaxation.progress=relaxationStepSchema.parse(event.step);this.save(item);}
          if(event.event==="completed")completed=true;
          if(event.event==="progress"&&(event.status==="loading_model"||event.status==="running")&&item.job.status!=="cancelling") {item.job.status=event.status;this.save(item);}
        }});
      if(this.controller.signal.aborted)throw Error("CANCELLED");if(!completed)throw Error("WORKER_RESULT_MISSING");
      const result=atomisticResultSchema.parse(JSON.parse((await readOwnedBytes(this.project(item.job.projectId),join(directory,"result.json"),null)).toString("utf8")));
      if(result.runId!==id||result.planId!==item.plan.id||result.structureId!==item.structure.id||result.potentialSha256!==item.plan.potentialSha256||result.atomCount!==item.structure.atoms.length||result.quality!=="needs_review")throw Error("RESULT_IDENTITY_MISMATCH");
      if(item.relaxation)item.relaxation.summary=relaxationSummarySchema.parse(JSON.parse((await readOwnedBytes(this.project(item.job.projectId),join(directory,"relaxation.json"),null)).toString("utf8")));
      if(item.md)item.md.summary=mdSummarySchema.parse(JSON.parse((await readOwnedBytes(this.project(item.job.projectId),join(directory,"md-summary.json"),null)).toString()));
      for(const [name,type] of this.artifactNames(item)) {
        const path=join(directory,name);const actual=await realpath(path);if(actual!==path)throw Error("UNSAFE_ARTIFACT_PATH");const actualData=await hashOwnedFile(this.project(item.job.projectId),path,null,item.md?item.plan.budget.maxOutputMiB*1048576:4*1048576);
        item.artifacts.push(atomisticArtifactSchema.parse({schemaVersion:"m6.0-v1",id:randomUUID(),projectId:item.job.projectId,runId:id,type,relativePath:`materials-output/atomistic/${id}/${name}`,...actualData,structureId:name.startsWith("final.")?item.relaxation!.summary!.finalStructureId:item.structure.id,frames:type==="atomic_trajectory"?item.md!.summary!.frameCount:null,partial:false}));
      }
      if(item.md)item.md.trajectoryArtifactId=item.artifacts.find(a=>a.relativePath.endsWith("/frames.ndjson"))!.id;
      if(item.relaxation||item.md)await this.publishManifest(item);
      item.result=result;item.job.resultArtifactId=item.artifacts.find(a=>a.type==="atomistic_result")!.id;item.job.quality="needs_review";await this.verifyStoredResult(item);item.job.status="completed";
    } catch(error) {item.job.status=this.controller.signal.aborted?"cancelled":"failed";item.job.quality="needs_review";item.job.error=error instanceof Error?error.message.slice(0,2000):"LOCAL_CALCULATION_FAILED";item.result=null;item.artifacts=[];item.job.resultArtifactId=null;if(item.relaxation){item.relaxation.summary=null;item.relaxation.partialArtifactId=null;}if(item.md){item.md.summary=null;item.md.trajectoryArtifactId=null;}await this.partialCheckpoint(item);}
    finally {item.job.finishedAt=new Date().toISOString();this.save(item);
      try{const directory=await ownedDirectory(this.project(item.job.projectId),id);if(directory===item.outputDirectory)await copyFile(join(this.stateDir,"jobs",`${id}.events.ndjson`),join(directory,"events.ndjson"));}catch{/* authoritative journal remains in application state */}
      this.running=null;this.controller=null;void this.pump();}
  }
  dispose():void {this.disposed=true;this.controller?.abort();for(const id of this.queue){const item=this.jobs.get(id)!;item.job.status="interrupted";item.job.finishedAt=new Date().toISOString();item.job.error="APP_CLOSED";item.job.quality="needs_review";this.save(item);}this.queue=[];}
}
