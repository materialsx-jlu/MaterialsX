import { z } from 'zod';import {mkdir,readFile,writeFile} from 'node:fs/promises';
import * as contracts from '../packages/contracts/src/atomistic-selection.js';
import {legacyScienceParameters as scienceParameters} from '../packages/pi-adapter/src/science-bridge.js';
const schemas={SelectionRequest:contracts.selectionRequestSchema,CapabilityReceipt:contracts.capabilityReceiptSchema,SelectionAssessment:contracts.selectionAssessmentSchema,SelectionProposal:contracts.selectionProposalSchema,SelectedRun:contracts.selectedRunSchema,ScientificScope:contracts.scientificScopeSchema};
await mkdir('schemas/m64',{recursive:true});
for(const [name,schema]of Object.entries(schemas)){const text=JSON.stringify({...z.toJSONSchema(schema,{target:'draft-2020-12'}),$id:`https://materialsx.local/schemas/m6.4-v1/${name}.json`,'x-runtime-refinements':'Real checkpoint/structure/dependency identities, project ownership, hard exclusions, authorized scope and citations must be checked in the local runtime.'},null,2)+'\n';const path=`schemas/m64/${name}.json`;if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==text)throw Error(`Schema drift ${name}`);}else await writeFile(path,text);}
const parameters=JSON.stringify(scienceParameters,null,2)+'\n',path='services/control-plane/internal/gateway/science-parameters.json';if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==parameters)throw Error('Gateway science schema drift');}else await writeFile(path,parameters);
console.log('M6.4 selection/scope and frozen gateway tool schemas checked/exported');
