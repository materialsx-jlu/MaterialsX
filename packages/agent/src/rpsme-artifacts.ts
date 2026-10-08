import {z} from 'zod';
import {dirname} from 'node:path';
import type {TaskExecution} from '../../contracts/src/task-execution.js';
import {hashOwnedFile} from '../../atomistic/src/artifact-io.js';
const artifact=z.object({label:z.enum(['RPSME JSON','中文摘要','校验报告']),path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().nonnegative()});
const receipt=z.object({source:z.object({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}),scientificStatus:z.literal('needs_review'),artifacts:z.array(artifact).length(3)});
/** Only a successful owned shared-workflow receipt can resolve these logical artifact roles. */
export async function verifiedRpsmeArtifacts(root:string,approvedPdf:string,state:TaskExecution,readResult:(ref:string)=>unknown,stepId?:string){
  const attempt=state.attempts.filter(a=>a.method==='materials_rpsme_extract'&&a.state==='completed'&&a.planRevision===state.planRevision&&(!stepId||a.stepId===stepId)).at(-1);
  if(!attempt?.resultRef)throw Error('RPSME_WORKFLOW_RECEIPT_MISSING');
  const result=readResult(attempt.resultRef) as {content?:Array<{type:string;text?:string}>};
  const parts=result?.content?.filter(p=>p.type==='text');
  if(parts?.length!==1||!parts[0]?.text)throw Error('RPSME_WORKFLOW_RECEIPT_INVALID');
  const value=receipt.parse(JSON.parse(parts[0].text));
  if(new Set(value.artifacts.map(a=>a.label)).size!==3)throw Error('RPSME_ARTIFACT_ROLES_INVALID');
  await hashOwnedFile(dirname(approvedPdf),approvedPdf,value.source.sha256,100*1024*1024);
  await hashOwnedFile(root,value.source.path,value.source.sha256,100*1024*1024);
  for(const a of value.artifacts){const actual=await hashOwnedFile(root,a.path,a.sha256,10*1024*1024);if(actual.bytes!==a.bytes)throw Error('RPSME_ARTIFACT_SIZE_CHANGED');}
  return value.artifacts;
}
