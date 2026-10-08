import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import type {TaskExecution} from '../../contracts/src/task-execution.js';
/** Check actual file links. Web citations are left to source-specific scientific review. */
export function answerPathIssues(text:string,root:string,state:TaskExecution){
 const issues:string[]=[];
 const artifacts=state.steps.filter(s=>s.state==='completed').flatMap(s=>s.artifacts??[]);
 const targets=[...text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`/g,'').matchAll(/\[[^\]\n]+\]\((<[^>\n]+>|[^)\n]+)\)/g)].map(m=>m[1]!.replace(/^<|>$/g,''));
 for(const raw of new Set(targets)){
  if(/^(?:https?:|mailto:|codex:|app:|#)/i.test(raw))continue;
  if(!/^(?:\/|\.\.?\/|file:)|\.(?:json|csv|md|txt|pdf|xyz|cif|png|svg|html|log)(?::\d+)?(?:#.*)?$/i.test(raw))continue;
  try{
   if(raw.startsWith('file:'))throw Error('Use a workspace file path');
   const value=decodeURI(raw).replace(/#.*$/,'').replace(/:\d+$/,''),base=realpathSync(root),path=realpathSync(resolve(base,value)),rel=relative(base,path),stat=statSync(path);
   if(isAbsolute(rel)||rel==='..'||rel.startsWith('../')||!stat.isFile())throw Error('File is missing or outside current project');
   const artifact=artifacts.find(a=>a.path===rel);
   if(artifact&&(stat.size!==artifact.bytes||stat.size>64*1024*1024||createHash('sha256').update(readFileSync(path)).digest('hex')!==artifact.sha256))throw Error('Verified artifact changed');
  }catch{issues.push('交付文件不可访问或已变更 / Delivery file unavailable or changed: '+raw.slice(0,500));}
 }
 return issues;
}

export function verifiedArtifactIssues(root:string,state:TaskExecution){
 const issues:string[]=[];
 for(const a of state.steps.filter(s=>s.state==='completed').flatMap(s=>s.artifacts??[])){
  if(a.planRevision!==state.planRevision)continue;
  try{
   const base=realpathSync(root),path=realpathSync(resolve(base,a.path)),rel=relative(base,path),stat=statSync(path);
   if(isAbsolute(rel)||rel==='..'||rel.startsWith('../')||!stat.isFile()||stat.size!==a.bytes||stat.size>64*1024*1024||
    createHash('sha256').update(readFileSync(path)).digest('hex')!==a.sha256)throw Error('changed');
  }catch{issues.push('已验收文件缺失或已变更 / Verified file missing or changed: '+a.path);}
 }
 return issues;
}
