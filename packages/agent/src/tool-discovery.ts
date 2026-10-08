import type {Permission} from '../../contracts/src/agent.js';
import type {CapabilityFact,CapabilitySnapshot} from '../../contracts/src/capability-awareness.js';
import {rankDocuments} from '../../search/src/lexical.js';
import {toolMetadata} from './tool-discovery-metadata.js';
export interface DiscoverableTool {name:string;description:string;parameters:Record<string,unknown>;permissions:readonly Permission[]}
export function rankedTools<T extends Pick<DiscoverableTool,'name'|'description'>>(tools:readonly T[],query:string){
 return rankDocuments(tools,query,t=>({id:t.name,text:[t.description,...Object.values(toolMetadata(t.name)??{}).flatMap(v=>typeof v==='string'?[v]:Object.values(v))]}));
}
export function initialToolNames(tools:readonly Pick<DiscoverableTool,'name'|'description'>[],request:string,methods:readonly string[]=[]){
 return new Set([...rankedTools(tools,request).slice(0,6).map(r=>r.value.name),'skill_search','read_skill',
  ...tools.filter(t=>t.name==='read_material_file').map(t=>t.name),...methods.slice(0,3)]);
}
export function capabilityState(f:CapabilityFact|undefined){
 if(!f)return 'unverified';
 if(!f.registered)return 'not-found';
 if(f.authorization==='denied')return 'not-authorized';
 if(f.installed===false)return 'not-installed';
 if(f.configured===false)return 'not-configured';
 return f.readiness==='verified'?'verified':f.readiness==='blocked'?'blocked':'unverified';
}
/** Runtime registry and current facts are the authority. An annotation is never a tool registration. */
export function discoverTools(tools:readonly DiscoverableTool[],permissions:readonly Permission[],query:string,snapshot?:CapabilitySnapshot|null,includeSchema=false){
 const allowed=tools.filter(t=>t.permissions.every(p=>permissions.includes(p))&&snapshot?.facts.find(f=>f.id==='tool:'+t.name)?.authorization!=='denied');
 const requested=tools.find(t=>t.name===query.trim()),exact=allowed.find(t=>t.name===query.trim());
 const ranked=rankedTools(allowed,query),matches=requested?(exact?[{value:exact}]:[]):ranked.slice(0,includeSchema?3:8);
 const results=matches.map(({value:t})=>{
  const fact=snapshot?.facts.find(f=>f.id==='tool:'+t.name),meta=toolMetadata(t.name);
  const dependency=t.name==='research_data'?snapshot?.facts.find(f=>f.id==='service:moos'):undefined;
  const state=dependency?.configured===false?'not-configured':capabilityState(fact);
  return {name:t.name,...(meta?{purpose:meta.purpose,input:meta.input,output:meta.output,examples:meta.examples}:{}),
   description:t.description.slice(0,700),permissions:t.permissions,state,
   readinessScope:dependency?.configured===false?dependency.detail:fact?.detail??'Registered adapter only; actual task readiness and scientific applicability require scoped checks.',
   schemaAvailable:true,...(includeSchema?{parameters:t.parameters}:{schemaHint:'Use find_tools with the exact name and includeSchema=true.'})};
 });
 const denied=tools.filter(t=>!allowed.includes(t)).filter(t=>!snapshot?.facts.some(f=>f.id==='tool:'+t.name)).map(t=>({id:'tool:'+t.name,label:{zh:t.name,en:t.name},state:'not-authorized',detail:'Current tool grant does not allow this capability.'}));
 const unavailable=rankDocuments(snapshot?.facts.filter(f=>f.authorization==='denied'||f.installed===false||f.configured===false)??[],query,
  f=>({id:f.id,names:[f.id.replace(/^[^:]+:/,''),f.label.zh,f.label.en],text:[f.detail,toolMetadata(f.id.slice(5))?.aliases??'']})).slice(0,8-results.length)
  .map(({value:f})=>({id:f.id,label:f.label,state:capabilityState(f),detail:f.detail}));
 unavailable.push(...rankDocuments(denied,query,f=>({id:f.id,names:[f.id.slice(5)],text:[toolMetadata(f.id.slice(5))?.aliases??'']})).slice(0,Math.max(0,8-results.length-unavailable.length)).map(r=>r.value));
 return {tools:results,unavailable,outcome:results.length?'matches':unavailable.length?'unavailable':'not-found',matched:requested?results.length:ranked.length,partial:!requested&&ranked.length>results.length,executionAuthority:false,
  ranking:'local-terms-and-synonyms',policy:'Candidates only. Exact schemas come from the original registry. Check permissions, actual inputs and applicability before invoking; discovery does not execute or install.'};
}
