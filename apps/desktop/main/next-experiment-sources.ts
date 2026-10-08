import {z} from 'zod';
import {join} from 'node:path';
import {readOwnedBytes} from '../../../packages/atomistic/src/artifact-io.js';
import type {WorkspaceStore} from './store.js';
import type {ScientificResearch} from './scientific-research.js';
import type {ExperimentResearch} from './experiment-research.js';
import type {FeedbackInput,ResearchStudy} from '../../../packages/contracts/src/next-experiment.js';
/** Resolves a scalar from an owned source. Never trusts a scalar invented in a feedback/tool argument. */
export async function resolveFeedbackSource(store:WorkspaceStore,scientific:ScientificResearch,experiments:ExperimentResearch,projectId:string,study:ResearchStudy,input:FeedbackInput){
  const empty={value:null as number|null,unit:study.input.response.unit,sourceSnapshotIds:[] as string[],sourceIdentity:null as string|null,conditions:study.input.measurementConditions,evidence:[] as Array<{snapshotId:string;sha256:string;locator:string}>};
  const source=input.source;if(!source)return empty;
  if(source.kind==='ua8'){
    if(study.input.response.metric==='reported')throw Error('STUDY_METRIC_REQUIRES_REPORTED_SOURCE');
    const run=experiments.overview(projectId).runs.find(r=>r.id===source.runId);if(!run||run.status!=='completed')throw Error('FEEDBACK_EXPERIMENT_NOT_OWNED_OR_CURRENT');
    const matches=(run.result.curves as any[]??[]).filter(c=>c.specimenId===source.specimenId);if(matches.length!==1)throw Error('FEEDBACK_SPECIMEN_NOT_UNIQUE');const curve=matches[0]!;
    if(curve.acquisition!=='measured')throw Error('DIGITIZED_CURVE_IS_NOT_REAL_MEASUREMENT');
    const ids=run.inputHashes.filter(h=>h.sha256===curve.inputSha256).map(h=>h.id);if(ids.length!==1)throw Error('FEEDBACK_INPUT_ID_NOT_UNIQUE');const dataset=store.research.experimentDatasets(projectId).find(d=>d.id===ids[0])!;
    const root=store.getProject(projectId)!.path;
    await readOwnedBytes(root,join(root,dataset.original.path),dataset.original.sha256,8*1024*1024);
    for(const a of run.artifacts)await experiments.preview(projectId,run.id,a.path);
    const value=z.number().finite().parse(study.input.response.metric==='fitSlopeMPa'?curve.fit.slopeMPa:curve.observedPeakStressMPa);
    return {...empty,value,unit:'MPa',conditions:z.string().parse(curve.conditions),sourceSnapshotIds:ids,sourceIdentity:'ua8:'+curve.inputSha256,evidence:[{snapshotId:ids[0]!,sha256:curve.inputSha256,locator:run.id+'/'+curve.specimenId}]};
  }
  if(study.input.response.metric!=='reported')throw Error('STUDY_METRIC_REQUIRES_UA8_SOURCE');
  scientific.assertCurrent(projectId,source.snapshotId);scientific.assertAccess(projectId,source.snapshotId);
  await scientific.verifySources(projectId,[source.snapshotId],null);
  const s=store.research.snapshot(projectId,source.snapshotId),matches=(s.data.observations as any[]??[]).filter(o=>o.id===source.observationId);
  if(matches.length!==1)throw Error('FEEDBACK_OBSERVATION_NOT_UNIQUE');const o=matches[0]!;
  if(o.property!==study.input.response.property)throw Error('FEEDBACK_RESPONSE_PROPERTY_MISMATCH');
  if(!s.evidence.length)throw Error('FEEDBACK_SOURCE_EVIDENCE_REQUIRED');
  const conditions=typeof o.conditions==='string'?o.conditions:JSON.stringify(o.conditions);
  if(o.factors&&Object.entries(input.actualFactors).some(([k,v])=>o.factors[k]!==v))throw Error('FEEDBACK_FACTOR_SOURCE_MISMATCH');
  return {...empty,value:z.number().finite().parse(o.value),unit:z.string().min(1).parse(o.unit),conditions:z.string().min(1).parse(conditions),sourceSnapshotIds:[s.id],sourceIdentity:'reported:'+s.sha256+':'+o.id,
    evidence:s.evidence.map(e=>({snapshotId:s.id,sha256:e.sha256??s.sha256,locator:e.locator??s.title}))};
}
