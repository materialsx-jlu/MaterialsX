import {parseReferences,referenceToken,type ParsedReference} from '../../../../../packages/contracts/src/task-references.js';
import {rankDocuments} from '../../../../../packages/search/src/lexical.js';
export interface ReferenceCandidate {kind:ParsedReference['kind'];id:string;label:string;description:string;status:string;version:string;range:string;sha256?:string}
export function suggestReferences(values:ReferenceCandidate[],query:string){
 const typed=/^(skill|file|recipe|paper|structure):(.*)$/s.exec(query),kind=typed?.[1],term=(typed?.[2]??query).replace(/^"/,'');
 return rankDocuments(values.filter(v=>!kind||v.kind===kind),term,v=>({id:v.id,names:[v.label],text:[v.description,v.kind]}))
  .slice(0,8).map(({value:v})=>({...v,name:referenceToken(v.kind,v.id).slice(1),descriptionZh:v.description}));
}
export function previewReferences(text:string,values:ReferenceCandidate[]){
 return parseReferences(text).slice(0,16).map(ref=>{
  const matches=values.filter(v=>v.kind===ref.kind&&(v.id===ref.value||v.kind==='file'&&v.label===ref.value));
  return matches.length===1?matches[0]!:{kind:ref.kind,id:ref.value,label:ref.value,status:'未找到或不属于当前范围 / Not found or outside scope',version:'—',range:'请在列表选择真实资源 / Select an actual resource',description:''};
 });
}
