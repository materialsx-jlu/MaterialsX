import { mkdirSync,existsSync,lstatSync,readFileSync,readdirSync,writeFileSync,renameSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { userSkillDraftSchema,type PotentialCatalog } from '../../contracts/src/potential-hub.js';
import type { SkillSummary } from '../../contracts/src/desktop.js';
import { planUserSkill } from './skill-draft.js';
import { digest } from './selection.js';
const recordSchema=z.strictObject({version:z.literal('m6.9-v1'),revision:z.number().int().positive(),enabled:z.boolean(),sha256:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime(),draft:userSkillDraftSchema});
export type UserSkillRecord=z.infer<typeof recordSchema>;
/** Instructions-only, local application directory. No scripts, dependencies, arbitrary paths or builtin overwrites. */
export class UserSkillService{
 readonly root:string;
 constructor(userData:string,private builtins:()=>readonly string[],private catalog:()=>PotentialCatalog){this.root=join(userData,'skills');mkdirSync(this.root,{recursive:true});this.safeDirectory(this.root);}
 private safeDirectory(path:string){const s=lstatSync(path);if(s.isSymbolicLink()||!s.isDirectory())throw Error('UNSAFE_SKILL_DIRECTORY');}
 private file(path:string){const s=lstatSync(path);if(s.isSymbolicLink()||!s.isFile()||s.size>256*1024)throw Error('UNSAFE_SKILL_FILE');return readFileSync(path,'utf8');}
 private content(d:z.infer<typeof userSkillDraftSchema>){return `---\nname: ${d.name}\ndescription: ${JSON.stringify(d.description.en+' '+d.description.zh)}\n---\n\n# ${d.name}\n\n## 中文\n${d.instructions.zh}\n\n## English\n${d.instructions.en}\n\n## Examples / 使用例子\n${d.examples.map(e=>`- ${e.zh}\n- ${e.en}`).join('\n')}\n\n## Dependencies\nPotential IDs: ${d.potentialIds.join(', ')||'none'}\nTools: ${d.requiredTools.join(', ')||'none'}\n\nInstructions are not execution authorization. Use registered MaterialsX tools and approved scope. Never fabricate calculations, evidence or installation status.\n`;}
 preview(input:unknown){const {draft}=planUserSkill(input,this.builtins(),this.catalog());if((draft.description.en+draft.description.zh).length>1023||/[<>]/.test(draft.description.en+draft.description.zh))throw Error("SKILL_DESCRIPTION_INVALID");const text=this.content(draft);if(Buffer.byteLength(text)>64*1024)throw Error('SKILL_SIZE_LIMIT');return {draft,text,sha256:digest(text),executable:false};}
 list():UserSkillRecord[]{const out:UserSkillRecord[]=[];for(const name of readdirSync(this.root)){if(!/^[a-z][a-z0-9-]{0,63}$/.test(name)||this.builtins().includes(name))continue;try{const dir=join(this.root,name);this.safeDirectory(dir);const r=recordSchema.parse(JSON.parse(this.file(join(dir,'materialsx.json'))));if(r.draft.name!==name||digest(this.file(join(dir,'SKILL.md')))!==r.sha256)continue;planUserSkill(r.draft,this.builtins(),this.catalog());out.push(r);}catch{}}return out;}
 save(input:unknown,expectedRevision:number|null){const p=this.preview(input),previous=this.list().find(r=>r.draft.name===p.draft.name);if((previous?.revision??null)!==expectedRevision)throw Error('SKILL_REVISION_CONFLICT');const dest=join(this.root,p.draft.name);if(existsSync(dest)&&!previous)throw Error('SKILL_DIRECTORY_ALREADY_EXISTS');const now=new Date().toISOString(),record=recordSchema.parse({version:'m6.9-v1',revision:(previous?.revision??0)+1,enabled:previous?.enabled??true,sha256:p.sha256,createdAt:previous?.createdAt??now,updatedAt:now,draft:p.draft});
 mkdirSync(dest,{recursive:true});this.safeDirectory(dest);const revisions=join(dest,'versions');mkdirSync(revisions,{recursive:true});this.safeDirectory(revisions);const versionPath=join(revisions,record.revision+'.json');writeFileSync(versionPath,JSON.stringify({record,text:p.text},null,2)+'\n',{flag:'wx',mode:0o600});
 for(const [name,text] of [['SKILL.md',p.text],['materialsx.json',JSON.stringify(record,null,2)+'\n']]){const temp=join(dest,name+'.tmp');if(existsSync(temp))throw Error('SKILL_WRITE_BUSY');writeFileSync(temp,text!,{flag:'wx',mode:0o600});renameSync(temp,join(dest,name!));}return record;
 }
 setEnabled(name:string,enabled:boolean){const record=this.get(name);record.enabled=enabled;record.updatedAt=new Date().toISOString();const dir=join(this.root,name);this.safeDirectory(dir);const tmp=join(dir,'materialsx.json.tmp');writeFileSync(tmp,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});renameSync(tmp,join(dir,'materialsx.json'));return record;}
 get(name:string){const r=this.list().find(r=>r.draft.name===name);if(!r)throw Error('USER_SKILL_NOT_FOUND');return r;}
 remove(name:string,revision:number){const r=this.get(name);if(r.revision!==revision)throw Error('SKILL_REVISION_CONFLICT');this.safeDirectory(join(this.root,name));rmSync(join(this.root,name),{recursive:true});}
 paths(){return this.list().filter(r=>r.enabled).map(r=>join(this.root,r.draft.name,'SKILL.md'));}
 text(name:string){const r=this.get(name);if(!r.enabled)throw Error('USER_SKILL_DISABLED');return this.file(join(this.root,name,'SKILL.md'));}
 summaries():SkillSummary[]{return this.list().map(r=>({name:r.draft.name,description:r.draft.description.en,descriptionEn:r.draft.description.en,descriptionZh:r.draft.description.zh,category:'user',categoryLabelZh:'我的 Skills',categoryLabelEn:'My Skills',source:'MaterialsX user Skill',examples:r.draft.examples,license:'User-owned',enabled:r.enabled,availability:'ready',applicablePotentialIds:r.draft.potentialIds}));}
}
