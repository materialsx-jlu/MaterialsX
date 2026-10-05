import { createHash } from "node:crypto";
import { join } from 'node:path';
import { mdFrameSchema,mdIndexSchema,mdStepSchema,mdSummarySchema,type ScientificSnapshot } from '../../contracts/src/atomistic-dynamics.js';
import { readOwnedBytes,readOwnedRange,hashOwnedFile } from './artifact-io.js';
import type { z } from 'zod';
export type MDIndex=z.infer<typeof mdIndexSchema>;
// Cache validated metadata only, never skip hashing actual index bytes on a read.
const indexes=new Map<string,MDIndex>();
export async function readMDIndex(project:string,item:ScientificSnapshot){
 const artifact=item.artifacts.find(a=>a.relativePath.endsWith('/trajectory-index.json'));
 if(!item.md||!artifact)throw Error('TRAJECTORY_NOT_REGISTERED');
 const bytes=await readOwnedBytes(project,join(item.outputDirectory,'trajectory-index.json'),artifact.sha256);
 let index=indexes.get(artifact.sha256);if(!index){index=mdIndexSchema.parse(JSON.parse(bytes.toString()));indexes.set(artifact.sha256,index);while(indexes.size>8)indexes.delete(indexes.keys().next().value!);}
 validateIndex(item,index);return index;
}
export function validateIndex(item:ScientificSnapshot,index:MDIndex){
 if(index.runId!==item.job.id||index.planId!==item.plan.id||index.structureId!==item.structure.id||index.atomCount!==item.structure.atoms.length||JSON.stringify(index.options)!==JSON.stringify(item.md?.options))throw Error('TRAJECTORY_SCOPE_MISMATCH');
}
export async function readMDFrame(project:string,item:ScientificSnapshot,index:MDIndex,n:number){
 const entry=index.entries[n];if(!entry)throw Error('FRAME_NOT_FOUND');
 const frame=mdFrameSchema.parse(JSON.parse((await readOwnedRange(project,join(item.outputDirectory,'frames.ndjson'),entry.frame,item.plan.budget.maxOutputMiB*1048576)).toString()));
 if(frame.runId!==item.job.id||frame.planId!==item.plan.id||frame.structureId!==item.structure.id||frame.index!==n||frame.positionsAngstrom.length!==item.structure.atoms.length||frame.step.step!==entry.step||frame.step.timeFs!==entry.timeFs)throw Error('FRAME_SCOPE_MISMATCH');return frame;
}
export async function readMDHistory(project:string,item:ScientificSnapshot){
 const artifact=item.artifacts.find(a=>a.relativePath.endsWith('/md-observables.json'));if(!artifact)throw Error('MD_OBSERVABLES_MISSING');
 const raw=JSON.parse((await readOwnedBytes(project,join(item.outputDirectory,'md-observables.json'),artifact.sha256)).toString());
 if(!Array.isArray(raw)||raw.length!==item.md!.options.steps+1)throw Error('MD_HISTORY_LENGTH');
 return raw.map((r,i)=>{const v=mdStepSchema.parse(r);if(v.step!==i||Math.abs(v.timeFs-i*item.md!.options.timestepFs)>1e-8)throw Error('MD_HISTORY_TIME');return v;});
}
export async function verifyMD(project:string,item:ScientificSnapshot){
 const index=await readMDIndex(project,item),summary=mdSummarySchema.parse(item.md?.summary),rows=await readMDHistory(project,item);
 if(summary.frameCount!==index.entries.length||JSON.stringify(rows[0])!==JSON.stringify(summary.initial)||JSON.stringify(rows.at(-1))!==JSON.stringify(summary.final)||index.entries.at(-1)?.step!==summary.completedSteps)throw Error('MD_SUMMARY_CHANGED');
 for(const e of index.entries){const f=await readMDFrame(project,item,index,e.index);if(e.index===0){if(JSON.stringify(f.positionsAngstrom)!==JSON.stringify(item.structure.atoms.map(a=>a.position)))throw Error('MD_INITIAL_GEOMETRY_CHANGED');const velocities=Buffer.alloc(f.velocitiesAngstromPerFs.length*3*8);f.velocitiesAngstromPerFs.flat().forEach((v,i)=>velocities.writeDoubleLE(v,i*8));if(createHash('sha256').update(velocities).digest('hex')!==summary.initialVelocitySha256)throw Error('MD_INITIAL_VELOCITY_CHANGED');}
 if(JSON.stringify(f.step)!==JSON.stringify(rows[e.step]))throw Error('MD_FRAME_OBSERVABLE_MISMATCH');await readOwnedRange(project,join(item.outputDirectory,'trajectory.extxyz'),e.extxyz,item.plan.budget.maxOutputMiB*1048576);}
 for(const [name,key] of [['frames.ndjson','frame'],['trajectory.extxyz','extxyz']] as const){const a=item.artifacts.find(a=>a.relativePath.endsWith('/'+name))!,last=index.entries.at(-1)![key];const hash=await hashOwnedFile(project,join(item.outputDirectory,name),a.sha256,item.plan.budget.maxOutputMiB*1048576);if(hash.bytes!==a.bytes||hash.bytes!==last.offset+last.bytes||a.frames!==index.entries.length)throw Error('MD_ARCHIVE_CHANGED');}
 if(summary.options.ensemble==='nve'){const t=rows.map(r=>r.timeFs),e=rows.map(r=>r.totalEnergyEv),tm=t.reduce((s,v)=>s+v,0)/t.length,em=e.reduce((s,v)=>s+v,0)/e.length;const slope=t.reduce((s,v,i)=>s+(v-tm)*(e[i]!-em),0)/t.reduce((s,v)=>s+(v-tm)**2,0)*1e6/item.structure.atoms.length;if(Math.abs(slope-summary.nveDriftMevPerAtomPerPs!)>1e-6)throw Error('MD_DRIFT_CHANGED');}
 else{const tail=rows.filter(r=>r.timeFs>=summary.final.timeFs/2),mean=tail.reduce((s,r)=>s+r.temperatureK,0)/tail.length;if(Math.abs(mean-summary.nvtMeanTemperatureK!)>1e-8||Math.abs(Math.abs(mean/summary.options.temperatureK-1)-summary.nvtRelativeTemperatureError!)>1e-10)throw Error('MD_TEMPERATURE_DIAGNOSTIC_CHANGED');}
 if(item.result?.completedSteps!==summary.completedSteps||item.result.stopReason!=='max_steps'||item.result.energyEv!==summary.final.potentialEnergyEv||Math.abs(Math.max(...item.result.forcesEvPerAngstrom.map(f=>Math.hypot(...f)))-summary.final.maxForceEvPerAngstrom)>1e-8)throw Error('MD_RESULT_CHANGED');
}
