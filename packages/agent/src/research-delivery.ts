import {createHash,randomUUID} from 'node:crypto';
import {mkdir,lstat,realpath,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {readOwnedBytes} from '../../atomistic/src/artifact-io.js';
import type {ResearchBinding,ResearchSnapshot,DeliveryRecord} from '../../contracts/src/research-project.js';
import {validateDeliveryScience} from './delivery-science.js';
import {sourceHash} from './data-source-router.js';
export interface ResearchRow {snapshotId:string;section:string;id:string;property:string;value:unknown;unit:string|null;conditions:unknown;evidenceIds:string[]}
const cell=(v:unknown)=>typeof v==='object'?JSON.stringify(v):String(v??'');
const xml=(v:unknown)=>cell(v).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
const csv=(v:unknown)=>'"'+(typeof v==='string'?cell(v).replace(/^[\s]*[=+@-]/,m=>"'"+m):cell(v)).replace(/"/g,'""')+'"';
export function researchRows(snapshots:ResearchSnapshot[],kind:ResearchBinding['delivery']['kind'],result:any):ResearchRow[]{
  if(kind==='simulation-gaps')return (result.studies??[]).flatMap((s:any)=>(s.declaration.missing_fields??[]).map((field:unknown)=>({snapshotId:s.snapshotId,section:'missing-input',id:s.studyId,property:cell(field),value:null,unit:null,conditions:{executionPerformed:false},evidenceIds:[]})));
  const rows:ResearchRow[]=[];
  for(const s of snapshots){
    const keys=kind==='recipe-process'?['recipes','ingredients','processes','observations']:['observations'];
    for(const key of keys)for(const r of (s.data[key] as any[]??[])){
      if(kind==='comparison' && result.selections && !result.selections.some((p:any)=>p.snapshotId===s.id&&p.observationId===r.id))continue;
      rows.push({snapshotId:s.id,section:key,id:String(r.id),property:String(r.property??r.material_name??r.display_name_zh??r.recipe_type??r.operation_type??r.id),
        value:r.value??r.amount??r.source_text??r.basis??r.parameters??null,unit:r.unit??null,conditions:r.conditions??r.parameters??{},evidenceIds:r.evidence_ids??[]});
    }
  }
  if(rows.length>500)throw Error('DELIVERY_ROW_LIMIT');return rows;
}
export function assessDelivery(binding:ResearchBinding,snapshots:ResearchSnapshot[],rows:ResearchRow[],result:any):Pick<DeliveryRecord,'checks'|'limitations'|'status'>{
  const assessment=validateDeliveryScience(binding,snapshots,rows,result);
  assessment.checks.unshift({id:'data',status:rows.length?'pass':'fail',detail:'Actual selected rows; empty output does not pass'});
  if(!rows.length)assessment.status='blocked';return assessment;
}
function chart(rows:ResearchRow[],kind:string,locale:'zh'|'en'){
  // Independent rows deliberately have no shared scale when comparability is unknown.
  const entries=rows.slice(0,40),h=100+entries.length*44;
  const label=(r:ResearchRow)=>{const text=r.property+' · '+cell(r.value).slice(0,70)+' '+(r.unit??'')+' · '+r.id;return text.length>72?text.slice(0,71)+'…':text;};
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${h}" viewBox="0 0 960 ${h}"><rect width="960" height="${h}" fill="#f8fafc"/><g fill="#1e293b" font-family="sans-serif"><text x="24" y="32" font-size="18">${locale==='zh'?'来源数据概览（待科研复核）':'Source data overview (needs scientific review)'}</text><text x="24" y="58" font-size="12">${xml(kind)} · ${entries.length}/${rows.length} · ${locale==='zh'?'逐项原值，不进行排名或因果推断':'Original values; no ranking or causal claims'}</text>${entries.map((r,i)=>`<rect x="20" y="${78+i*44}" width="920" height="38" rx="6" fill="${i%2?'#f1f5f9':'#e2e8f0'}"/><text x="30" y="${102+i*44}" font-size="12">${xml(label(r))}</text>`).join('')}</g></svg>`;
}
/** Generated artifacts are source presentations, not a new simulation/statistical engine. */
export async function writeResearchDelivery(root:string,binding:ResearchBinding,planRevision:number,snapshots:ResearchSnapshot[],result:any,image?:{bytes:Buffer;sha256:string;rightsBasis:string},stepIds:string[]=[]):Promise<DeliveryRecord>{
  const rows=researchRows(snapshots,binding.delivery.kind,result),assessment=assessDelivery(binding,snapshots,rows,result),id=randomUUID();
  const base=await realpath(root);let directory=base;
  for(const part of ['materials-output','research',binding.taskId,id]){directory=join(directory,part);await mkdir(directory,{recursive:true});if((await lstat(directory)).isSymbolicLink()||await realpath(directory)!==directory)throw Error('RESEARCH_OUTPUT_SYMLINK');}
  const createdAt=new Date().toISOString();
  const sources=snapshots.map(s=>({id:s.id,version:s.version,sha256:s.sha256,ref:s.ref,evidence:s.evidence,reviewStatus:s.reviewStatus,sourceStatus:s.data.sourceStatus}));
  const report=`# ${binding.locale==='zh'?'材料研究报告':'Materials research report'}\n\n${binding.materialSystem}\n\n${binding.conditions.join('; ')}\n\n${binding.locale==='zh'?'本报告展示来源记录，科学结论待复核。':'This report presents source records. Scientific conclusions require review.'}\n\n## ${binding.locale==='zh'?'验收与限制':'Acceptance and limitations'}\n\n${assessment.checks.map(c=>'- '+c.id+': '+c.status+' — '+c.detail).join('\n')}\n\n## ${binding.locale==='zh'?'数据及来源回链':'Data and source references'}\n\n\`\`\`json\n${JSON.stringify({rows,sources,sourceResult:result,contract:binding.delivery,image:image?{sha256:image.sha256,rightsBasis:image.rightsBasis,cloudExportAuthorized:false}:null},null,2)}\n\`\`\`\n`;
  const files:Array<{kind:DeliveryRecord['artifacts'][number]['kind'];name:string;body:string|Buffer}>=[
    {kind:'table',name:'table.csv',body:['snapshot,section,id,property,value,unit,conditions,evidence',...rows.map(r=>[r.snapshotId,r.section,r.id,r.property,r.value,r.unit,r.conditions,r.evidenceIds].map(csv).join(','))].join('\n')+'\n'},
    {kind:'chart',name:'chart.svg',body:chart(rows,binding.delivery.kind,binding.locale)}, {kind:'report',name:'report.md',body:report},
    ...(image?[{kind:'image' as const,name:'preview.jpg',body:image.bytes}]:[])];
  const artifacts:DeliveryRecord['artifacts']=[];
  for(const f of files){const path=join(directory,f.name);await writeFile(path,f.body,{flag:'wx',mode:0o600});const bytes=await readOwnedBytes(base,path,null,4*1024*1024);artifacts.push({kind:f.kind,path:relative(base,path),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});}
  for(const required of binding.delivery.required){const found=artifacts.some(a=>a.kind===required);assessment.checks.push({id:'artifact:'+required,status:found?'pass':'missing',detail:found?'Generated, read back and hashed':'Required artifact not generated'});if(!found)assessment.status='blocked';}
  if(!image&&binding.delivery.optional.includes('image')){assessment.limitations.push('no-image');if(!binding.delivery.allowedLimitations.includes('no-image'))assessment.status='blocked';}
  const reportArtifact=artifacts.find(a=>a.kind==='report')!;const reportPath=join(base,reportArtifact.path);
  await writeFile(reportPath,report+'\n## File acceptance / 文件验收\n\n'+assessment.checks.filter(c=>c.id.startsWith('artifact:')).map(c=>'- '+c.id+': '+c.status+' — '+c.detail).join('\n')+'\n\nFinal delivery status / 交付状态: '+assessment.status+'\n',{flag:'w',mode:0o600});
  const reportBytes=await readOwnedBytes(base,reportPath,null,4*1024*1024);reportArtifact.sha256=createHash('sha256').update(reportBytes).digest('hex');reportArtifact.bytes=reportBytes.length;
  return {id,taskId:binding.taskId,projectId:binding.projectId,planRevision,contractSha256:sourceHash(binding.delivery),snapshotIds:snapshots.map(s=>s.id),stepIds,createdAt,scientificStatus:'needs_review',...assessment,artifacts,sourceResult:result};
}
