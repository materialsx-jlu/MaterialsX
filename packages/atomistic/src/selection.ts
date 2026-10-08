import {COMPOSITE_ID} from '../../contracts/src/potential-physics.js';
import { createReadStream } from "node:fs";
import { createHash,randomUUID } from 'node:crypto';
import type { AtomicStructure } from '../../contracts/src/atomistic.js';
import type {SelectionRequest} from '../../contracts/src/potential-physics.js';
import type {CurrentRegistry as PotentialRegistry} from '../../contracts/src/potential-native.js';
import {elementSymbols} from '../../contracts/src/atomistic.js';
import { currentSelectionAssessmentSchema as selectionAssessmentSchema,selectionProposalSchema,type CapabilityReceipt,type SelectionAssessment } from '../../contracts/src/potential-packages.js';
export async function digestFile(path:string,maximum:number):Promise<string>{const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(path)){const data=chunk as Buffer;bytes+=data.length;if(bytes>maximum)throw Error('WEIGHT_SIZE_LIMIT');hash.update(data);}return hash.digest('hex');}
export const digest=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
/** Capability receipts are created only by the trusted worker after checking actual checkpoint bytes. */
export function assessPotentials(registry:PotentialRegistry,registrySha256:string,structure:AtomicStructure,request:SelectionRequest,capabilities:CapabilityReceipt[]):SelectionAssessment{
 const candidates:SelectionAssessment['selection']['candidates']=[],exclusions:SelectionAssessment['selection']['exclusions']=[];
 for(const p of registry.potentials){
  const reasons:string[]=[];const c=capabilities.find(c=>c.potentialId===p.id&&c.sha256===p.weights.sha256);
  if(['disabled','failed','unsupported'].includes(p.state))reasons.push('POTENTIAL_DISABLED');
  if(!c)reasons.push('VERIFIED_RUNTIME_UNAVAILABLE');
  if(!p.weights.sha256||p.weights.verification==='unverified')reasons.push('WEIGHT_IDENTITY_UNVERIFIED');
  if(p.licenses.redistribution!=='permitted-with-notices'||p.licenses.code.status!=='documented'||p.licenses.weights.status!=='documented')reasons.push('LICENSE_REVIEW_REQUIRED');
  if(p.declared.headPolicy!=='single')reasons.push('HEAD_NOT_RESOLVED');
  if(structure.issues.some(i=>i.severity==='blocking')||structure.atoms.some(a=>a.occupancy!==1))reasons.push('STRUCTURE_HAS_BLOCKING_ISSUES');
  const composed=p.id===COMPOSITE_ID;
  if(composed){if(structure.atoms.length>128)reasons.push('COMPOSITION_ATOM_LIMIT');if(!structure.cell||!nativeCellAllowed(structure.cell)||determinant(structure.cell)/structure.atoms.length<5)reasons.push('COMPOSITION_CELL_LIMIT');if(structure.cell&&nativeCellAllowed(structure.cell)&&compositionTooClose(structure))reasons.push('COMPOSITION_MINIMUM_DISTANCE');}
  const molecular=p.id==='ani-2x-ensemble',native=p.id==='nep-si-2022-nep4-3body';
  if(native){if(structure.atoms.length>256)reasons.push('NEP_NATIVE_ATOM_LIMIT');if(!structure.cell||!nativeCellAllowed(structure.cell)||determinant(structure.cell)/structure.atoms.length<5)reasons.push('NEP_NATIVE_CELL_LIMIT');}
  if(molecular){
   if(structure.pbc.some(Boolean))reasons.push('MOLECULE_REQUIRES_ISOLATED_BOUNDARY');
   if(request.domain!=='molecules')reasons.push('DOMAIN_OUTSIDE_POLICY');
   if(structure.charge===null||structure.spinMultiplicity===null)reasons.push('ELECTRONIC_STATE_REQUIRED');
   else if(structure.charge!==0||structure.spinMultiplicity!==1)reasons.push('NEUTRAL_SINGLET_REQUIRED');
   if(structure.charge!==null&&(structure.atoms.reduce((n,a)=>n+elementSymbols.indexOf(a.element)+1,0)-structure.charge)%2!==0)reasons.push('ELECTRON_COUNT_PARITY_MISMATCH');
   if(structure.atoms.length>128)reasons.push('MOLECULAR_ATOM_COUNT_LIMIT');

   if(request.task==='relaxation'&&(!structure.cell||structure.cell.some((row,i)=>row[i]!<=0)))reasons.push('EXPLICIT_DISPLAY_BOX_REQUIRED');
  }else{
  if(!structure.pbc.every(Boolean)||!p.declared.periodicity.includes('bulk'))reasons.push('BULK_PBC_REQUIRED');
  if(request.domain!=='inorganic-crystals'||!p.declared.domains.includes(request.domain))reasons.push('DOMAIN_OUTSIDE_POLICY');
  if(structure.charge!==null||structure.spinMultiplicity!==null||p.declared.chargeInput!=='unsupported'||p.declared.spinInput!=='unsupported')reasons.push('ELECTRONIC_STATE_NOT_SUPPORTED');
  }
  if(request.interaction==='dispersion-required'&&!composed)reasons.push('DISPERSION_CORRECTION_REQUIRED');
  if(['spin-required','field-required','delta-required','multi-head-required'].includes(request.interaction??''))reasons.push('ADVANCED_PHYSICS_NOT_VERIFIED');
  if(request.interaction==='long-range-required')reasons.push('LONG_RANGE_PHYSICS_UNAVAILABLE');
  if(c&&!structure.atoms.every(a=>c.elements.includes(a.element)))reasons.push('ELEMENT_NOT_SUPPORTED');
  if(p.declared.energy!=='yes'||p.declared.forces!=='yes'||(!molecular&&p.declared.stress!=='yes'))reasons.push('REQUIRED_OUTPUT_UNKNOWN');
  if(request.task==='md'&&!['mace-mp-0b3-medium','chgnet-0.3.0','chgnet-r2scan'].includes(p.id))reasons.push('MOUNTED_MD_NOT_VERIFIED');
  if(['relaxation','md'].includes(request.task)&&p.declared.conservative!=='yes')reasons.push('CONSERVATIVE_FORCES_REQUIRED');
  if(request.mode==='production')reasons.push('DOMAIN_NOT_VALIDATED');
  if(request.budget&&structure.atoms.length>request.budget.maxAtoms||!request.budget&&structure.atoms.length>256)reasons.push('ATOM_COUNT_LIMIT');
  if(request.budget&&c&&request.budget.maxMemoryMiB<c.loadedMemoryMiB+128)reasons.push('MEMORY_PREFLIGHT_FAILED');
  if(request.task==='relaxation'&&request.budget&&request.budget.maxSteps>500)reasons.push('STEP_LIMIT');
  if(reasons.length)exclusions.push({potentialId:p.id,reasonCodes:[...new Set(reasons)]});
  else candidates.push({potentialId:p.id,evidenceIds:[...new Set([p.source.id,...p.declared.evidenceIds,`runtime:${p.id}`])],reason:composed?{zh:'固定 MACE 基线 + PBE-D3(BJ) 两体色散；纯硅周期 CPU 单点/固定 FIRE，分项结果。无 ATM 或长程静电，不代表 DFT 精度。',en:'Fixed MACE baseline plus two-body PBE-D3(BJ); pure-Si CPU SP/fixed FIRE with components. No ATM/electrostatics or DFT accuracy claim.'}:molecular?{zh:'ANI-2x 八成员平均；仅中性单重态非周期分子 CPU 探索。无显式长程静电、附加色散或分子应力；无独立 DFT 精度证据。',en:'ANI-2x eight-member mean; neutral singlet isolated molecules, CPU exploratory only. No explicit long-range electrostatics, added dispersion or molecular stress. No independent DFT accuracy evidence.'}:{zh:'实际权重、隔离依赖与元素覆盖通过；仅限无机三维周期晶体 CPU 探索试算。无独立 DFT 精度证据。',en:'Verified checkpoint, locked environment and element coverage; CPU exploratory inorganic bulk screening only. No independent DFT accuracy evidence.'}});
 }
 // No comparable scientific error metrics exist. Stable ID order is a tie breaker, not an accuracy rank.
 candidates.sort((a,b)=>a.potentialId.localeCompare(b.potentialId));
 return selectionAssessmentSchema.parse({version:capabilities.some(c=>!['mace-mp-0b3-medium','chgnet-0.3.0','chgnet-r2scan'].includes(c.potentialId))?'m6.8-v1':'m6.4-v1',id:randomUUID(),createdAt:new Date().toISOString(),registrySha256,structureSha256:digest(JSON.stringify(structure)),request,capabilities,rankingBasis:'Hard gates first. Scientific error/training-overlap/resource scaling evidence unavailable; eligible candidates tied, stable ID order only. No accuracy scores.',selection:{schemaVersion:'m6.0-v1',structureId:structure.id,selectedPotentialId:null,head:null,candidates,exclusions,limitations:[{zh:'质量需复核：未知独立误差、训练集重叠与任务规模资源需求；不得将试算当作 DFT 精度或全局稳定性验证。',en:'Needs review: independent errors, training overlap and task-size resource demand unknown. Screening is not DFT accuracy or global stability validation.'},{zh:'模型能量基准不可直接比较；多模型一致不等于准确。短程 MD 仅为探索诊断，不证明长期热稳定性。',en:'Cross-model total-energy references are not aligned. Agreement does not imply accuracy. Short MD is an exploratory diagnostic, not long-term thermal stability evidence.'}],validationPlan:'Acquire licensed independent DFT labels with matched theory/settings, audit training overlap, validate forces/stress and per-domain errors before production.'}});
}
export function validateProposal(assessment:SelectionAssessment,input:unknown){
 const p=selectionProposalSchema.parse(input);if(p.assessmentId!==assessment.id)throw Error('ASSESSMENT_NOT_OWNED');
 const candidate=assessment.selection.candidates.find(c=>c.potentialId===p.selectedPotentialId);
 if(!candidate)throw Error('POTENTIAL_EXCLUDED');
 if(!p.evidenceIds.every(id=>candidate.evidenceIds.includes(id)))throw Error('EVIDENCE_NOT_IN_REGISTRY_OR_RUNTIME');
 return p;
}

function determinant(a:number[][]){return a[0]![0]!*(a[1]![1]!*a[2]![2]!-a[1]![2]!*a[2]![1]!)-a[0]![1]!*(a[1]![0]!*a[2]![2]!-a[1]![2]!*a[2]![0]!)+a[0]![2]!*(a[1]![0]!*a[2]![1]!-a[1]![1]!*a[2]![0]!);}

function nativeCellAllowed(a:number[][]){const g=a.map(x=>a.map(y=>x.reduce((n,v,k)=>n+v*y[k]!,0)));const psd=(m:number[][])=>m.every((r,i)=>r[i]!>=-1e-8)&&[ [0,1],[0,2],[1,2] ].every(([i,j])=>m[i!]![i!]!*m[j!]![j!]!-m[i!]![j!]!*m[j!]![i!]!>=-1e-8)&&determinant(m)>=-1e-7;return determinant(a)>0&&psd(g.map((r,i)=>r.map((v,j)=>v-(i===j?16:0))))&&psd(g.map((r,i)=>r.map((v,j)=>(i===j?40000:0)-v)));}

// With cell singular value >=4, all images closer than 2.3 A are among these 27 wrapped images.
function compositionTooClose(s:AtomicStructure){const a=s.cell!,volume=determinant(a);for(let i=0;i<s.atoms.length;i++)for(let j=0;j<i;j++){const d=s.atoms[i]!.position.map((v,k)=>v-s.atoms[j]!.position[k]!);const f=a.map((_,k)=>{const c=a.map(r=>[...r]);c[k]=d;const x=determinant(c)/volume;return x-Math.round(x);});for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){const v=[x,y,z];const cart=[0,1,2].map(k=>a.reduce((n,r,q)=>n+(f[q]!+v[q]!)*r[k]!,0));if(cart.reduce((n,u)=>n+u*u,0)<2.3**2)return true;}}return false;}
