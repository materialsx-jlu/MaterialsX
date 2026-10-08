import {boundReferenceSchema,parseReferences,type BoundReference} from '../../../packages/contracts/src/task-references.js';
import type {SkillSummary} from '../../../packages/contracts/src/desktop.js';
import type {CloudAsset} from '../../../packages/pi-adapter/src/platform-session.js';
/** Resolves against already approved owned objects. Never reads an arbitrary mention path or grants access. */
export async function bindTaskReferences(content:string,projectId:string,options:{
 files:CloudAsset[];skills:SkillSummary[];skillText:(name:string)=>Promise<string>;hash:(text:string)=>string;
 recipe:(id:string)=>{id:string;title:string;version:string;sha256:string;selected:boolean};
 paper:(id:string)=>{id:string;title:string;version:string;sha256:string;range:string};
 structure:(id:string)=>{id:string;title:string;sha256:string;authorized:boolean};platform:boolean;
}){
 const refs:BoundReference[]=[];const seen=new Set<string>();
 for(const ref of parseReferences(content)){
  const key=ref.kind+':'+ref.value;if(seen.has(key))continue;seen.add(key);
  if(ref.kind==='skill'){
   const s=options.skills.find(s=>s.name===ref.value);
   if(!s||s.availability==='planned'||!s.enabled)throw Error('SKILL_REFERENCE_UNAVAILABLE: '+ref.value+' / Skill 未安装、未启用或不可读；引用不会自动安装');
   const text=await options.skillText(s.name),hash=options.hash(text);
   refs.push({kind:'skill',id:s.name,label:s.name,projectId,version:hash,sha256:hash,status:'bound',range:'说明按 read_skill 的实际行范围读取 / Instructions read on demand'});
  }else if(ref.kind==='file'){
   const matches=options.files.filter(f=>f.id===ref.value||f.name===ref.value);
   if(matches.length!==1)throw Error('FILE_REFERENCE_NOT_APPROVED_OR_AMBIGUOUS: '+ref.value+' / 请用附件入口选择项目文件，再选择唯一文件');
   const f=matches[0]!;refs.push({kind:'file',id:f.id,label:f.name,projectId,version:f.sha256,sha256:f.sha256,status:'bound',range:'固定文本快照 / Frozen UTF-8 snapshot; '+Buffer.byteLength(f.text)+' bytes'});
  }else if(ref.kind==='recipe'){
   if(options.platform)throw Error('MOOS_REFERENCE_EXPORT_NOT_AUTHORIZED: MOOS 引用仍需独立数据外发授权 / Cloud export is not enabled');
   const r=options.recipe(ref.value);if(!r.selected)throw Error('RECIPE_REFERENCE_NOT_SELECTED: 请先在研究数据页选入本项目研究范围');
   refs.push({kind:'recipe',id:r.id,label:r.title,projectId,version:r.version,sha256:r.sha256,status:'bound',range:'来源摘要；详情需 research_data 实际读取 / Summary; read actual source details'});
  }else if(ref.kind==='paper'){
   const p=options.paper(ref.value);refs.push({kind:'paper',id:p.id,label:p.title,projectId,version:p.version,sha256:p.sha256,status:p.range==='metadata-only'?'metadata-only':'bound',range:p.range});
  }else{
   const s=options.structure(ref.value);refs.push({kind:'structure',id:s.id,label:s.title,projectId,version:s.sha256,sha256:s.sha256,status:s.authorized?'bound':'not-authorized',range:'结构摘要；坐标与计算须既有科学授权 / Summary; coordinates and computation require existing scope'});
  }
  if(refs.length>16)throw Error('REFERENCE_LIMIT: 一轮最多 16 项显式引用 / At most 16 references');
 }
 return refs.map(r=>boundReferenceSchema.parse(r)).filter((r,i,all)=>all.findIndex(x=>x.kind===r.kind&&x.id===r.id)===i);
}
