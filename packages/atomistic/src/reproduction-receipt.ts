import {approvedPackages} from './approved-packages.js';
import {reproductionReceiptSchema} from '../../contracts/src/potential-distribution.js';
import {canonical,hash} from './discovery-io.js';
import {executionPins} from './catalog-updates.js';
/** A receipt is a checksum/provenance record, not a publisher signature or permission to execute. */
export function inspectReproductionReceipt(root:string,input:unknown){
 const receipt=reproductionReceiptSchema.parse(input),p=receipt.payload;
 if(hash(canonical(p))!==receipt.payloadSha256||hash(JSON.stringify(p.structure,null,2)+'\n')!==p.plan.structureSha256)throw Error('REPRODUCTION_RECEIPT_CHANGED');
 const e=approvedPackages(root).find(e=>e.potentialId===p.plan.potentialId);const pin=executionPins(root).find(e=>e.id===p.plan.potentialId)??(e?{weightSha256:e.sha256,dependencyLockSha256:e.dependencyLockSha256,sourceRevision:e.sourceRevision}:undefined);
 const compatible=!!pin&&pin.weightSha256===p.plan.potentialSha256&&pin.dependencyLockSha256===p.environment.dependencyLockSha256&&(p.environment.sourceRevision===null||pin.sourceRevision===p.environment.sourceRevision);
 return {runId:p.runId,potentialId:p.plan.potentialId,task:p.plan.task.kind,compatible,originalArtifactsVerified:false,executionAuthorized:false,bitwiseReproductionGuaranteed:false,legacySourceRevisionUnknown:p.environment.sourceRevision===null,payloadSha256:receipt.payloadSha256};
}
