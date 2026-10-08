import {preparationOption,verificationOption,preparationText,verificationText} from './research-recipe-options.js';
import {z} from 'zod';
import type {WorkspaceStore} from './store.js';
import type {ResearchSnapshot} from '../../../packages/contracts/src/research-project.js';
import {recipeSnapshots,recipeBundle,recipeMaterialLabel} from './research-recipe-view.js';
import {recipeProposalFollowup,requestedRecipeCount} from '../../../packages/agent/src/research-intent.js';
export const recipeProposalInput=z.strictObject({baselineSnapshotId:z.uuid().optional(),name:z.string().min(1).max(120),
 changes:z.array(z.strictObject({component:z.number().int().min(1).max(30),amount:z.number().finite().nonnegative(),unit:z.string().min(1).max(40),reason:z.string().min(1).max(300)})).max(8),
 preparation:z.array(preparationOption).min(1).max(5),checks:z.array(verificationOption).min(1).max(7),gaps:z.array(z.string().min(1).max(500)).min(1).max(12)});
const rows=(s:ResearchSnapshot,key:string):any[]=>Array.isArray(s.data[key])?s.data[key] as any[]:[];
export function proposalBaselines(store:WorkspaceStore,taskId:string){
 const binding=store.research.binding(taskId);return binding?binding.snapshotIds.map(id=>store.research.snapshot(binding.projectId,id))
  .filter(s=>rows(s,'ingredients').length>=2&&rows(s,'ingredients').length<=30&&rows(s,'ingredients').every(i=>typeof i.amount?.original_value==='number'&&Number.isFinite(i.amount.original_value)&&i.amount.original_value>=0&&typeof i.amount?.original_unit==='string')):[];
}
export function recordedRecipeProposals(store:WorkspaceStore,taskId:string){
 const plan=store.researchPlan(taskId),state=store.agentJournal.read(taskId);if(!plan)return [];
 return (state?.attempts??[]).filter(a=>a.method==='recipe_proposal'&&a.state==='completed'&&a.planRevision===plan.planRevision&&a.resultRef)
  .map(a=>{const receipt=store.agentJournal.readResult(taskId,a.resultRef!);return JSON.parse(receipt.content?.find((c:any)=>c.type==='text')?.text??'null');})
  .filter(r=>r?.status==='draft_unverified'&&typeof r.text==='string');
}
/** Latest receipt per name, distinct composition/process; preserve all raw receipts for audit. */
export function acceptedRecipeProposals(store:WorkspaceStore,taskId:string){
 const latest=new Map(recordedRecipeProposals(store,taskId).map(p=>[p.name,p]));
 const variants=new Set<string>(),accepted=[];
 for(const p of latest.values()){
  const key=JSON.stringify({source:p.baselineSha256,materials:p.materials?.map((m:any)=>[m.component,m.proposedAmount,m.unit]),preparation:p.preparation});
  if(variants.has(key))continue;variants.add(key);accepted.push(p);
 }
 return accepted.slice(0,requestedRecipeCount(store.researchPlan(taskId)?.originalRequest??''));
}
const cell=(v:unknown)=>String(v??'未记录').replaceAll('|','\\|').replace(/[\r\n]/g,' ');
/** The host owns source quantities and provenance; the model supplies only explicit proposed changes. */
export function buildRecipeProposal(store:WorkspaceStore,taskId:string,input:unknown){
 const q=recipeProposalInput.parse(input),plan=store.researchPlan(taskId),binding=store.research.binding(taskId);
 if(!plan||!binding||!recipeProposalFollowup(plan.originalRequest))throw Error('RECIPE_PROPOSAL_TASK_REQUIRED');
 const read=recipeSnapshots(store,taskId);if(binding.snapshotIds.some(id=>!read.some(s=>s.id===id)))throw Error('READ_FROZEN_RECIPES_FIRST');
 const baselines=proposalBaselines(store,taskId),baseline=q.baselineSnapshotId?baselines.find(s=>s.id===q.baselineSnapshotId):baselines.length===1?baselines[0]:null;
 if(!baseline)throw Error('RECIPE_BASELINE_NOT_UNIQUE_OR_INCOMPLETE: use an exact complete baselineSnapshotId from current sources');
 const ingredients=rows(baseline,'ingredients'),evidence=rows(baseline,'readEvidence');
 if(new Set(q.changes.map(c=>c.component)).size!==q.changes.length)throw Error('DUPLICATE_COMPONENT_CHANGE');
 for(const change of q.changes){const i=ingredients[change.component-1];if(!i||change.unit!==i.amount.original_unit)throw Error('PROPOSAL_COMPONENT_OR_ORIGINAL_UNIT_MISMATCH');}
 const materials=ingredients.map((i,index)=>{const change=q.changes.find(c=>c.component===index+1),source=recipeMaterialLabel(baseline,i.material_id);
  const pages=(i.evidence_ids??[]).map((id:string)=>evidence.find(e=>e.id===id)?.locator?.pdf_page).filter((p:unknown)=>p!==undefined);
  return {component:index+1,material:source,originalAmount:i.amount.original_value,proposedAmount:change?.amount??i.amount.original_value,unit:i.amount.original_unit,modelReason:change?.reason??null,changeReason:!change||change.amount===i.amount.original_value?'沿用原值，作为待复核的小试基线':'建议'+(change.amount>i.amount.original_value?'增加':'减少')+'该组分用量；先比较分散、成膜及目标性能，不预设收益',evidencePages:pages};});
 const table=['| 组分 | 来源原值 | 建议用量（待验证） | 原单位 | 调整说明 | 来源页码 |','|---|---:|---:|---|---|---|',
  ...materials.map(m=>'| '+[m.material,m.originalAmount,m.proposedAmount,m.unit,m.changeReason,m.evidencePages.map((p:unknown)=>'PDF p.'+p).join(', ')||'未记录'].map(cell).join(' | ')+' |')].join('\n');
 const list=(items:string[])=>items.map((v,i)=>`${i+1}. ${v.replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, '')}`).join('\n');
 const sourceProcess=rows(baseline,'processes').slice(0,30).map((p,i)=>`${i+1}. ${cell(p.display_name_zh??p.operation_type)}：${cell(p.source_text)} · 原文参数: ${cell(JSON.stringify(p.parameters??{}))}`).join('\n');
 const compositionNote=/辐射制冷涂料|radiative cooling paint/i.test(baseline.title)?'\n\n**配比说明**：PVC 是颜料体积浓度。颜料体积不变时，增加干态粘结剂体积会降低 PVC；乳液体积不能直接当作干态粘结剂体积。缺少固含量和密度时，不能给出准确的 PVC 值或据此保证性能。':'';
 const text=`### ${cell(q.name)} · 建议方案（未执行、未验证）\n\n基线：${cell(baseline.title)} · ${baseline.reviewStatus}\n\n${table}\n\n这是基于已读组分的初步小试建议。原文用量来自冻结来源；“建议用量”和以下工艺、理由由模型提出，尚需实验验证。体积与质量未互换，也未计算缺少固含量/密度依据的比例。\n\n${compositionNote}\n\n**建议工艺**\n\n${list(q.preparation.map(v=>preparationText[v]))}\n\n**原文工艺参考（原文用量不能替代调整后的建议表）**\n\n${sourceProcess}\n\n**待确认条件**\n\n${list(q.gaps)}\n\n**验证项目**\n\n${list(q.checks.map(v=>verificationText[v]))}\n\n来源 SHA-256: \`${baseline.sha256}\`。其他已读候选：${read.filter(s=>s.id!==baseline.id).map(s=>cell(s.title)+'（'+s.reviewStatus+'）').join('；')||'无'}。不完整候选不作为可直接配制的基线。`;
 return {status:'draft_unverified',name:q.name,baselineSnapshotId:baseline.id,baselineSha256:baseline.sha256,materials,preparation:q.preparation,checks:q.checks,text};
}
/** Small current-state hint; no implicit statistical method or missing source quantities. */
export function recipeProposalGuidance(store:WorkspaceStore,taskId:string,allowed:(s:ResearchSnapshot)=>boolean=()=>true){
 const plan=store.researchPlan(taskId);if(!plan||!recipeProposalFollowup(plan.originalRequest))return null;
 const baselines=proposalBaselines(store,taskId).filter(allowed),binding=store.research.binding(taskId),read=new Set(recipeSnapshots(store,taskId).map(s=>s.id)),sourcesRead=!!binding?.snapshotIds.length&&binding.snapshotIds.every(id=>read.has(id));
 return {sourcesRead,readCall:sourcesRead?null:{action:'read_current_recipes'},baselines:baselines.map(s=>({snapshotId:s.id,title:s.title,ingredients:recipeBundle(s).rows.ingredients})),
  preparationOptions:preparationOption.options,verificationOptions:verificationOption.options,proposalCall:{tool:'recipe_proposal',required:['name','changes','preparation','checks','gaps'],baselineSnapshotId:baselines.length===1?'omit: one complete baseline':baselines.map(s=>s.id)},
  language:store.research.binding(taskId)?.locale==='zh'?'Write name, reasons and gaps in Chinese; copy English preparation/checks option IDs exactly. Chemical names and units may be English.':'Use the user language.',
  policy:'Do not invent fixed missing particle sizes, PVC values, cooling guarantees, or pass/fail thresholds for verification. Missing particle size, density and solids require confirmation, not an arbitrary assumed value. Read frozen sources once, then call recipe_proposal to record a proposed draft. Changes use one-based component numbers and exact original units; never label proposed values as original data. Omit baselineSnapshotId only when exactly one complete baseline exists. Preserve missing fields and review labels. Select preparation/checks enum IDs only, never free-text numerical procedures. This bounded draft follows the source process route; novel routes require a separate plan. No simulation, completed experiment or performance guarantee.',
  ...(baselines.some(s=>/辐射制冷涂料|radiative cooling paint/i.test(s.title))?{domainChecks:'Electrostatic repellent dispersion in this source uses sodium polyacrylate; do not reinterpret it as applying an external electric field. PVC means pigment volume concentration, NOT polymer concentration. At fixed pigment volume reducing dry binder increases PVC. Emulsion mL is not dry polymer volume: density and solids are missing. Solar reflectance and atmospheric-window IR emissivity are different measurements. No guaranteed cooling, fixed nanoparticle size or monotonic benefit may be inferred from these recipes.',references:['https://www.sciencedirect.com/science/article/abs/pii/S0360132324013039','https://pubs.acs.org/doi/10.1021/acsomega.4c07223']}:{} )};
}
