import { z } from 'zod';import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { offlineBundleSchema } from '../packages/atomistic/src/offline-bundle.js';
import * as c from '../packages/contracts/src/atomistic-validation.js';
await mkdir('schemas/m66',{recursive:true});
for(const [name,schema] of Object.entries({OfflineBundle:offlineBundleSchema,ExtensionManifest:c.extensionManifestSchema,PackageRequest:c.packageRequestSchema,PackageStatus:c.packageStatusSchema,ScientificHoldout:c.holdoutSchema,ScientificEvaluationRequest:c.evaluationRequestSchema,ScientificPrediction:c.predictionSchema,ScientificEvaluationReport:c.evaluationReportSchema,ScientificEvaluationStatus:c.evaluationStatusSchema,ScientificQualityMatrix:c.qualityMatrixSchema})){
 const text=JSON.stringify({...z.toJSONSchema(schema,{target:'draft-2020-12'}),$id:`https://materialsx.local/schemas/m6.6-v1/${name}.json`,'x-runtime-refinements':'Actual identity, unit/atom mapping, reference provenance, matched theory/energy references, independent overlap review, per-domain quotas and project ownership must be verified; reports never grant production approval.'},null,2)+'\n';const path=`schemas/m66/${name}.json`;if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==text)throw Error(`Schema drift ${name}`);}else await writeFile(path,text);
}
console.log('M6.6 package/holdout/evaluation/matrix contracts checked/exported');
