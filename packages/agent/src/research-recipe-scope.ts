import {moosRecipeLookup} from './research-intent.js';
const waterborne=/水性|水基|waterborne|water[-\s]based|aqueous/i;
const coating=/涂料|涂层|\bpaints?\b|\bcoatings?\b/i;
const radiative=/辐射制冷|辐射冷却|radiative\s+cooling|\bPDRC\b/i;
/** Conservative metadata gates for explicitly requested recipe categories, never scientific qualification. */
export function recipeScope(request:string){
 if(!moosRecipeLookup(request)||!waterborne.test(request)||!coating.test(request))return null;
 return {requirements:['waterborne','coating',...(radiative.test(request)?['radiative-cooling']:[])],
  suggestedQuery:radiative.test(request)?'水性辐射制冷涂料':'水性涂料',
  qualification:'Metadata relevance only; quantities, evidence, missing conditions and review status remain separate checks.'};
}
export function recipeScopeMatches(request:string,identity:{title?:string;label?:string;family?:string}){
 const scope=recipeScope(request);if(!scope)return true;
 const text=[identity.title,identity.label,identity.family].filter(Boolean).join(' ');
 return waterborne.test(text)&&coating.test(text)&&(!scope.requirements.includes('radiative-cooling')||radiative.test(text));
}
