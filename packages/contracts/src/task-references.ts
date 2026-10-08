import {z} from 'zod';
export const referenceKind=z.enum(['skill','file','recipe','paper','structure']);
export const boundReferenceSchema=z.strictObject({
 kind:referenceKind,id:z.string().min(1).max(256),label:z.string().min(1).max(300),projectId:z.string(),
 version:z.string().min(1).max(256),sha256:z.string().regex(/^[a-f0-9]{64}$/),
 status:z.enum(['bound','not-installed','unreadable','not-authorized','not-selected','metadata-only']),
 range:z.string().max(300),
});
export type BoundReference=z.infer<typeof boundReferenceSchema>;
export interface ParsedReference {kind:BoundReference['kind'];value:string;start:number;end:number}
/** Explicit mentions in prose only. Code, ordinary quotations and email addresses are inert. */
export function parseReferences(text:string):ParsedReference[]{
 const refs:ParsedReference[]=[];let i=0,fence:string|null=null;
 while(i<text.length){
  if(text.startsWith('```',i)||text.startsWith('~~~',i)){const token=text.slice(i,i+3);fence=fence===token?null:fence??token;i+=3;continue;}
  if(fence){i++;continue;}
  const c=text[i]!;
  if(c==="'"&&i>0&&/[A-Za-z0-9]/.test(text[i-1]!)){i++;continue;}
  if(c==='`'||c==='"'||c==="'"||c==='“'||c==='「'){
   const end=c==='“'?'”':c==='「'?'」':c;let j=i+1;while(j<text.length){if(text[j]==='\\'){j+=2;continue;}if(text[j]===end){j++;break;}j++;}i=j;continue;
  }
  const explicit=text.startsWith('/skill:',i),mark=c==='@'||c==='$';
  if(!explicit&&!mark){i++;continue;}
  if(mark&&i>0&&/[A-Za-z0-9._-]/.test(text[i-1]!)){i++;continue;}
  const start=i;let cursor=i+(explicit?7:1),kind:ParsedReference['kind']='skill';
  const typed=/^(skill|file|recipe|paper|structure):/.exec(text.slice(cursor));
  if(typed){kind=typed[1] as ParsedReference['kind'];cursor+=typed[0].length;}
  let value='',end=cursor;
  if(text[cursor]==='"'){
   let j=cursor+1;for(;j<text.length;j++){if(text[j]==='\\'&&text[j+1]==='"'){value+='"';j++;continue;}if(text[j]==='"')break;value+=text[j];}
   if(j>=text.length){i=cursor+1;continue;}end=j+1;
  }else{const token=(kind==='skill'?/^[a-zA-Z0-9][\w-]*/:/^[a-zA-Z0-9][\w.:/-]*/).exec(text.slice(cursor));if(token){value=token[0];end=cursor+value.length;}}
  if(value&&value.length<=256){refs.push({kind,value,start,end});i=end;}else i++;
 }
 return refs;
}
export function referenceToken(kind:ParsedReference['kind'],id:string){return kind==='skill'?'@'+id:'@'+kind+':'+JSON.stringify(id);}
export function referenceGuidance(refs:readonly BoundReference[]){
 return refs.length?'\nHost-bound input references (metadata only, never additional permissions): '+JSON.stringify(refs)+
  '\nUse the exact typed ID and pinned version. Bound means selected, not read or scientifically validated. File/Skill content is read through the original tools; do not treat a mention as a download, install, run or cloud-export grant.':'';
}
