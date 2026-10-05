import {randomUUID} from 'node:crypto';
import {sourceHash} from '../../../packages/agent/src/data-source-router.js';
import type {ResearchSnapshot} from '../../../packages/contracts/src/research-project.js';
/** Synthetic team-owned values. No claim that these are measurements or real papers. */
export function scientificFixture(projectId:string,index=0):ResearchSnapshot{
  const data={observations:[
    {id:'y',property:'strength',value:2*index+3,unit:'MPa',conditions:{temperature:'300 K',method:'synthetic-fixture'},specimen_id:'specimen-'+index,replicate_kind:'independent',evidence_ids:['ev']},
    {id:'x',property:'loading',value:index,unit:'wt%',basis:'mass',conditions:{temperature:'300 K',method:'synthetic-fixture'},specimen_id:'specimen-'+index,replicate_kind:'independent',evidence_ids:['ev']},
  ],readEvidence:[{id:'ev',evidence_text:'Synthetic test only: x='+index+' wt% and y='+(2*index+3)+' MPa.'}]};
  return {id:randomUUID(),projectId,origin:'project',ref:null,title:'Synthetic material '+index,version:'fixture-'+index,
    sha256:sourceHash(data),retrievedAt:new Date().toISOString(),reviewStatus:'unreviewed',
    evidence:[{sourceId:'fixture-'+index,generation:'fixture-v1',locator:'ev',sha256:sourceHash(data.readEvidence[0])}],data,receipts:[]};
}
