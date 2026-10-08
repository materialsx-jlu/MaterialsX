import {recipeScopeMatches} from '../../../packages/agent/src/research-recipe-scope.js';
import type {ResearchSnapshot} from '../../../packages/contracts/src/research-project.js';
import type {WorkspaceStore} from './store.js';
import {moosRecipeLookup as recipeLookup,recipeProposalFollowup,requestedRecipeCount} from '../../../packages/agent/src/research-intent.js';
export {recipeLookup,requestedRecipeCount};
/** Only IDs from completed, current-plan tool receipts qualify, never model prose. */
export function recipeSnapshots(store:WorkspaceStore,taskId:string):ResearchSnapshot[]{
  const binding=store.research.binding(taskId),plan=store.researchPlan(taskId),state=store.agentJournal.read(taskId);
  if(!binding||!plan||!(recipeLookup(plan.originalRequest)||recipeProposalFollowup(plan.originalRequest)))return [];
  const sections=new Map<string,Set<string>>();
  for(const attempt of state?.attempts??[]){
    if(attempt.method!=='research_data'||attempt.state!=='completed'||attempt.planRevision!==plan.planRevision||!attempt.inputRef||!attempt.resultRef)continue;
    const input=store.agentJournal.readResult(taskId,attempt.inputRef).args;
    if(!['read','read_recipes','read_current_recipes'].includes(input?.action))continue;
    const receipt=store.agentJournal.readResult(taskId,attempt.resultRef),text=receipt.content?.find((c:any)=>c.type==='text')?.text;
    const result=JSON.parse(text??'null');
    for(const item of result?.snapshots??[result]){const id=item?.snapshotId??item?.id;
      if(typeof id==='string'&&binding.snapshotIds.includes(id)){const seen=sections.get(id)??new Set<string>();seen.add(item.section);sections.set(id,seen);}}
  }
  const unique=new Map<string,ResearchSnapshot>();
  for(const [id,seen] of sections){if(!seen.has('recipe')&&!['ingredients','processes','readEvidence'].every(k=>seen.has(k)))continue;const s=store.research.snapshot(binding.projectId,id);if(s.origin==='moos'&&recipeScopeMatches(plan.originalRequest,{label:s.title,...(s.data.sourceStatus as any[])?.[0]?.identity})&&rows(s,'ingredients').length&&rows(s,'processes').length&&rows(s,'readEvidence').length)unique.set(JSON.stringify([s.ref?.connectionId,s.ref?.sourceId,s.ref?.experimentId]),s);}
  return [...unique.values()];
}
const cell=(v:unknown)=>String(v??'未记录 / Not recorded').replaceAll('|','\\|').replace(/[\r\n]/g,' ');
const rows=(s:ResearchSnapshot,key:string):any[]=>Array.isArray(s.data[key])?s.data[key] as any[]:[];
export function recipeMaterialLabel(s:ResearchSnapshot,id:string){
  const node=rows(s,'nodes').find(n=>n.id===id),label=node?.label;
  return label&&label!==id?label:String(id??'未记录').replace(/^MAT-DOI[A-Z0-9]+-/,'').replaceAll('-',' ');
}
/** A source view, not a model-written scientific conclusion; no conversion or guessed missing fields. */
export function recipeSourceText(snapshots:ResearchSnapshot[],requested=1):string {
  return `已读取 ${snapshots.length} 个来源配方，要求 ${requested} 个。以下为文献实验候选，尚未执行；待复核或缺项记录需要核实后才能复现。\n\n`+snapshots.slice(0,requested).map((s,index)=>{
    const ingredients=rows(s,'ingredients'),processes=rows(s,'processes'),evidence=rows(s,'readEvidence');
    const locator=(ids:unknown)=>Array.isArray(ids)?ids.map(id=>{
      const e=evidence.find(e=>e.id===id),page=e?.locator?.pdf_page;
      return String(id)+(page!==undefined?' · PDF p.'+page:'');
    }).join('; '):'未记录 / Not recorded';
    const table=['材料 / Material | 原始用量 / Amount | 单位 / Unit | 来源角色 / Role | 证据 / Evidence','---|---:|---|---|---',
      ...ingredients.slice(0,30).map(i=>[recipeMaterialLabel(s,i.material_id),i.amount?.original_value,i.amount?.original_unit,i.role,locator(i.evidence_ids)].map(cell).join(' | ')).map(r=>'| '+r+' |')].join('\n');
    const steps=processes.slice(0,30).map((p,i)=>`${i+1}. ${cell(p.display_name_zh??p.operation_type)}：${cell(p.source_text)}\n   参数 / Parameters: ${cell(JSON.stringify(p.parameters??{}))} · ${cell(locator(p.evidence_ids))}`).join('\n');
    return `### 实验配方候选 ${index+1} · ${cell(s.title)}\n\n来源记录 / Source record · 审核状态: ${s.reviewStatus} · 实验: ${s.ref?.experimentId} · 版本: ${s.ref?.generation}\n\n${ingredients.length?table:'未记录组分 / Ingredients not recorded'}\n\n${processes.length?steps:'未记录工艺 / Process not recorded'}\n\n共读取 ${ingredients.length} 条组分、${processes.length} 个步骤、${evidence.length} 条证据。${ingredients.length>30||processes.length>30?'仅展示前 30 条，请在数据详情查看其余记录。':''}\n\n${ingredients.length<2?'**组分记录不完整：来源仅有一条组分，不能据此直接配制。**\n\n':''}此表直接呈现 MOOS 抽取字段，保留原单位和缺项。待复核记录不代表已验证配方；不补写乳液固含量、颗粒粒径或其他未记录条件。\n\n快照 SHA-256: \`${s.sha256}\``;
  }).join('\n\n');
}

/** Compact, bounded source bundle for one verified snapshot; no copied or inferred quantities. */
export function recipeBundle(s:ResearchSnapshot){
  const ingredients=rows(s,'ingredients').slice(0,30).map((i,index)=>({...i,component:index+1})),processes=rows(s,'processes').slice(0,30),recipes=rows(s,'recipes').slice(0,30);
  const ids=new Set([...ingredients,...processes,...recipes].flatMap(r=>r.evidence_ids??[]));
  const evidence=rows(s,'readEvidence').filter(e=>ids.has(e.id));
  return {id:s.id,title:s.title,version:s.version,sha256:s.sha256,reviewStatus:s.reviewStatus,section:'recipe',
    rows:{recipes,ingredients,processes,readEvidence:evidence},
    counts:{recipes:rows(s,'recipes').length,ingredients:rows(s,'ingredients').length,processes:rows(s,'processes').length,evidence:evidence.length},
    truncated:['recipes','ingredients','processes'].filter(k=>rows(s,k).length>30),
    qualification:'Source fields only. Missing quantities remain missing. Pending review is not validated; candidate recipes are not executed experiments.'};
}
