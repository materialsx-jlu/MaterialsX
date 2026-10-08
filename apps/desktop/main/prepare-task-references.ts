import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {bindTaskReferences} from './task-reference-binding.js';
import {canonical,hash} from '../../../packages/atomistic/src/discovery-io.js';
import type {WorkspaceStore} from './store.js';
import type {SkillSummary} from '../../../packages/contracts/src/desktop.js';
import type {CloudAsset} from '../../../packages/pi-adapter/src/platform-session.js';
import type {ScientificScope} from '../../../packages/contracts/src/potential-physics.js';
import type {AtomisticRuntime} from '../../../packages/atomistic/src/runtime.js';
import type {PaperRecord} from '../../../packages/contracts/src/papers.js';
export async function prepareTaskReferences(content:string,projectId:string,options:{
 store:WorkspaceStore;files:CloudAsset[];skills:SkillSummary[];scope?:ScientificScope;platform:boolean;root:string;
 installedText:(name:string)=>Promise<string>;userText:(name:string)=>string;atomistic:AtomisticRuntime;papers:()=>PaperRecord[];
}){
 const skills:CloudAsset[]=[];
 const bindings=await bindTaskReferences(content,projectId,{...options,
  hash:text=>createHash('sha256').update(text).digest('hex'),
  skillText:async name=>{
   const entry=options.skills.find(s=>s.name===name)!;
   const text=entry.source==='MaterialsX installed Skill'?await options.installedText(name):entry.source==='MaterialsX user Skill'?options.userText(name):
    readFileSync(join(options.root,'vendor',entry.source.startsWith('MaterialsX')?'materialsx-default-skills':'kdense-scientific-agent-skills','skills',name,'SKILL.md'),'utf8');
   if(Buffer.byteLength(JSON.stringify(text))>60000)throw Error('SKILL_REFERENCE_SIZE_LIMIT: '+name);
   skills.push({id:name,name,text,sha256:createHash('sha256').update(text).digest('hex')});return text;
  },
  recipe:id=>{const r=options.store.research.snapshot(projectId,id),p=options.store.research.project(projectId);
   if(p.withdrawn.includes(id)||options.store.research.sourceNotices(projectId).some(n=>n.snapshotId===id))throw Error('RECIPE_REFERENCE_WITHDRAWN_OR_CHANGED');
   return {id:r.id,title:r.title,version:r.version,sha256:r.sha256,selected:p.selected.includes(id)};},
  paper:id=>{const p=options.papers().find(p=>p.paper.paperId===id);if(!p)throw Error('PAPER_REFERENCE_NOT_OWNED: '+id);
   return {id,title:p.paper.titleOriginal,version:p.paper.arxivId,sha256:p.file?.sha256??p.paper.metadataSha256,
    range:p.reading?'已读取文本页 / Read text pages: '+p.reading.readPages.join(',')+'; images not reviewed':'metadata-only'};},
  structure:id=>{const s=options.atomistic.listStructures(projectId).find(s=>s.id===id);if(!s)throw Error('STRUCTURE_REFERENCE_NOT_OWNED: '+id);
   return {id,title:s.atoms.length+' atoms / 原子',sha256:hash(canonical(s)),authorized:options.scope?.projectId===projectId&&options.scope.structureId===id};},
 });
 return {bindings,selection:{files:options.files,skills}};
}
