import {computed,ref,watch,type Ref} from 'vue';
import type {SkillSummary} from '../../../../../packages/contracts/src/desktop.js';
import type {SkillMentionRange} from './skill-mention';
import {suggestReferences,previewReferences,type ReferenceCandidate} from './reference-candidates';
type Attachment={id:string;name:string;sha256:string;bytes:number;totalLines:number;format?:string;pageCount?:number|null;ocrUnverifiedPages?:number[]};
/** Only reads existing local summaries. It never searches the network or selects/grants a resource. */
export function useComposerReferences(skills:Ref<SkillSummary[]>,project:Ref<string|null>,conversation:Ref<string|null>,attachments:Ref<Attachment[]>,draft:Ref<string>,mention:Ref<SkillMentionRange|null>){
 const resources=ref<ReferenceCandidate[]>([]);let revision=0;
 async function refresh(){
  const id=project.value,request=++revision;resources.value=[];if(!id)return;
  const results=await Promise.allSettled([window.materialsx.getResearchProject(id),window.materialsx.listPapers(id),window.materialsx.listAtomicStructures(id),conversation.value?window.materialsx.getScientificScope(conversation.value):Promise.resolve(null)]);
  if(request!==revision||project.value!==id)return;
  const [research,papers,structures,scope]=results;const rows:ReferenceCandidate[]=[];
  if(research.status==='fulfilled')for(const r of research.value.snapshots){const selected=research.value.project.selected.includes(r.id)&&!research.value.project.withdrawn.includes(r.id);
   rows.push({kind:'recipe',id:r.id,label:r.title,description:'配方与工艺 / Recipe and process · '+r.reviewStatus,status:selected?'已选入本项目 / Selected':'未选入范围 / Not selected',version:r.version,sha256:r.sha256,range:'摘要；详情通过 research_data 读取 / Summary; use research_data'});}
  if(papers.status==='fulfilled')for(const r of papers.value)rows.push({kind:'paper',id:r.paper.paperId,label:r.paper.titleOriginal,description:'论文 / Paper · '+r.status,
   status:r.reading?'已读取部分或全部文本 / Text read':'仅元数据，未阅读 / Metadata only',version:r.paper.arxivId,sha256:r.file?.sha256??r.paper.metadataSha256,range:r.reading?'文本页 / Text pages: '+r.reading.readPages.join(','):'元数据 / Metadata'});
  if(structures.status==='fulfilled')for(const r of structures.value)rows.push({kind:'structure',id:r.id,label:r.atoms.length+' 原子 / atoms · '+r.id.slice(0,8),
   description:'原子结构 / Atomic structure · '+[...new Set(r.atoms.map(a=>a.element))].join(', '),status:scope.status==='fulfilled'&&scope.value?.structureId===r.id?'已有本轮科学授权 / Scoped':'尚未授权计算 / Compute not authorized',
   version:'发送时固定结构版本 / Pin on submit',range:'摘要；坐标与计算须独立授权 / Summary; separate compute grant'});
  resources.value=rows;
 }
 watch([project,conversation],()=>{void refresh();},{immediate:true});
 const candidates=computed<ReferenceCandidate[]>(()=>[
  ...skills.value.map(s=>({kind:'skill' as const,id:s.name,label:s.name,description:(s.descriptionZh??s.description)+' · '+(s.descriptionEn??s.description),
   status:s.availability==='planned'?'未安装 / Not installed':!s.enabled?'未启用 / Disabled':'说明可读；依赖另检 / Instructions available; check dependencies',version:'发送时固定说明版本 / Pin on submit',range:'read_skill 按行读取 / Read lines on demand'})),
  ...attachments.value.map(f=>({kind:'file' as const,id:f.id,label:f.name,description:'已选研究附件 / Selected research file · '+f.bytes+' bytes',status:'固定快照 / Frozen snapshot',version:f.sha256,sha256:f.sha256,range:f.totalLines+' 行'+(f.pageCount?' · '+f.pageCount+' 页':'')+'；按范围读取 / lines; read by range'})),...resources.value]);
 return {skillSuggestions:computed(()=>suggestReferences(candidates.value,mention.value?.query??'')),boundReferences:computed(()=>previewReferences(draft.value,candidates.value)),refreshReferences:refresh};
}
