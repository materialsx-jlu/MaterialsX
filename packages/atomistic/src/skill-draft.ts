import { userSkillDraftSchema,userSkillDirectoryContract,type PotentialCatalog } from '../../contracts/src/potential-hub.js';
import { findCatalogEntry } from './potential-hub.js';
/** Pure planning/validation. No file writes or execution; M6.9 will add the reviewed writer. */
export function planUserSkill(input:unknown,builtinNames:readonly string[],catalog:PotentialCatalog){
 const draft=userSkillDraftSchema.parse(input);
 if(builtinNames.includes(draft.name))throw Error('BUILTIN_SKILL_NAME_RESERVED');
 for(const id of draft.potentialIds)findCatalogEntry(catalog,id);
 return {draft,directoryContract:userSkillDirectoryContract,relativePath:`${draft.name}/SKILL.md`,executable:false,writerAvailable:false};
}
