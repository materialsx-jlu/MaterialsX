import {DOMParser} from '@xmldom/xmldom';
import {createHash} from 'node:crypto';
import {arxivIdentity,paperSchema,type Paper, paperSearchSchema} from '../../../contracts/src/papers.js';
import type {z} from 'zod';
export const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const glossary:Record<string,string>={'机器学习势':'machine learning interatomic potentials','热塑性复合材料':'thermoplastic composites','复合材料':'composites','辐射制冷':'radiative cooling','高分子':'polymers','钙钛矿':'perovskite','锂电池':'lithium battery','晶体':'crystal','弹性模量':'elastic modulus'};
export function queryExpression(q:z.output<typeof paperSearchSchema>){
  let english=q.queryEnglish??q.query;for(const [zh,en]of Object.entries(glossary))english=english.replaceAll(zh,en);
  if(/[\u3400-\u9fff]/.test(english))throw Error('QUERY_ENGLISH_REQUIRED: 请补充英文关键词 / Supply English keywords');
  if(/sk-[A-Za-z0-9]|\/Users\/|[\w.+-]+@[\w.-]+\.[A-Za-z]{2}/.test(english))throw Error('PRIVATE_QUERY_REJECTED');
  // Plain public keywords, never raw executable arXiv query syntax from the model.
  const quote=(v:string)=>'"'+v.replace(/["\\\r\n]/g,' ').trim()+'"';
  let expression=english.trim().split(/\s+/).filter(Boolean).slice(0,16).map(t=>'all:'+quote(t)).join(' AND ');
  if(q.category)expression+=' AND cat:'+q.category;if(q.author)expression+=' AND au:'+quote(q.author);
  if(q.from||q.to)expression+=` AND submittedDate:[${(q.from??'1991-01-01').replaceAll('-','')}0000 TO ${(q.to??new Date().toISOString().slice(0,10)).replaceAll('-','')}2359]`;
  return expression;
}
export function arxivQuery(q:z.output<typeof paperSearchSchema>):string{
  const url=new URL('https://export.arxiv.org/api/query');url.searchParams.set('search_query',queryExpression(q));url.searchParams.set('start',String(q.page*q.limit));url.searchParams.set('max_results',String(q.limit));
  url.searchParams.set('sortBy',q.sort==='submitted'?'submittedDate':q.sort==='updated'?'lastUpdatedDate':'relevance');url.searchParams.set('sortOrder','descending');return url.href;
}
export function parseAtom(xml:string,retrievedAt=new Date().toISOString()):{items:Paper[];total:number}{
  if(xml.length>4*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('UNSAFE_ATOM_XML');
  let invalid=false;const document=new DOMParser({errorHandler:{warning:()=>{invalid=true;},error:()=>{invalid=true;},fatalError:()=>{invalid=true;}}}).parseFromString(xml,'text/xml');
  if(invalid||document.documentElement.localName!=='feed')throw Error('INVALID_ATOM_XML');
  const nodes=(parent:Element,name:string)=>Array.from(parent.getElementsByTagNameNS('*',name));
  const text=(parent:Element,name:string)=>nodes(parent,name)[0]?.textContent?.trim().replace(/\s+/g,' ')??'';
  const total=Number(text(document.documentElement,'totalResults'));if(!Number.isSafeInteger(total)||total<0)throw Error('INVALID_ATOM_TOTAL');
  const entries=nodes(document.documentElement,'entry');if(entries.length>50)throw Error('ATOM_PAGE_LIMIT');
  const items=entries.map(entry=>{
    const identity=text(entry,'id').replace(/^https?:\/\/arxiv.org\/abs\//,'');arxivIdentity.parse(identity);
    const value={schemaVersion:'paper-v1' as const,paperId:'arxiv:'+identity,arxivId:identity,titleOriginal:text(entry,'title'),abstractOriginal:text(entry,'summary'),
      authors:nodes(entry,'author').map(a=>text(a,'name')),categories:nodes(entry,'category').map(a=>a.getAttribute('term')??''),publishedAt:text(entry,'published'),updatedAt:text(entry,'updated'),
      doi:text(entry,'doi')||null,journalRef:text(entry,'journal_ref')||null,abstractUrl:'https://arxiv.org/abs/'+identity,pdfUrl:'https://arxiv.org/pdf/'+identity,
      retrievedAt,license:'unknown' as const,peerReview:'not-verified' as const,crossref:null};
    if(!Number.isFinite(Date.parse(value.publishedAt))||!Number.isFinite(Date.parse(value.updatedAt)))throw Error('INVALID_ATOM_DATE');
    return paperSchema.parse({...value,metadataSha256:sha(JSON.stringify({...value,retrievedAt:undefined,crossref:undefined}))});
  });return {items,total};
}
