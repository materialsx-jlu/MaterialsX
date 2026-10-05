import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {scientificFixture} from '../../../tests/fixtures/agent/ua7-source.js';
import {assessScientificQuality,leakageGroup} from './scientific-quality.js';
import {sourceHash} from './data-source-router.js';
import type {ScientificClaim} from '../../contracts/src/scientific-quality.js';
const projectId=randomUUID();
test('field and quantitative claims cannot invent IDs, relabel provenance, change original units or skip evidence',()=>{
  const s=scientificFixture(projectId),claim:ScientificClaim={id:'c',text:'Synthetic source reports 3 MPa',kind:'reported',quantity:{value:3,unit:'MPa'},refs:[{snapshotId:s.id,rowId:'y',section:'observations',field:'value',evidenceIds:['ev']}]};
  assert.equal(assessScientificQuality(projectId,null,[s],[claim]).decision,'usable-with-limitations');
  for(const changed of [
    {...claim,kind:'predicted' as const},{...claim,quantity:{value:3000000,unit:'Pa'}},
    {...claim,refs:[{...claim.refs[0]!,rowId:'invented'}]},
    {...claim,refs:[{...claim.refs[0]!,evidenceIds:['invented']}]},
    {...claim,refs:[{...claim.refs[0]!,field:'source_text' as const}]},
  ])assert.equal(assessScientificQuality(projectId,null,[s],[changed]).decision,'blocked');
  assert(assessScientificQuality(projectId,null,[s],[claim]).checks.some(c=>c.code.startsWith('CLAIM_SEMANTICS')&&c.status==='warning'));
});
test('changed versions, duplicate reports, uncertainty and composition basis remain distinct from scientific validation',()=>{
  const s=scientificFixture(projectId),rows=s.data.observations as any[];
  rows.push({...rows[0],id:'copied'});rows[0].uncertainty={kind:'error',value:1,unit:'Pa'};
  s.data.ingredients=[{id:'ingredient',amount:10,unit:'%',evidence_ids:['ev']}];s.sha256=sourceHash(s.data);
  const report=assessScientificQuality(projectId,null,[s]);assert.equal(report.scientificStatus,'needs_review');
  for(const code of ['DUPLICATE_REPORT','UNCERTAINTY_DEFINITION','COMPOSITION_BASIS'])assert(report.checks.some(c=>c.code===code&&c.status==='warning'));
  assert.equal(assessScientificQuality(projectId,null,[s],[],new Set([s.id])).decision,'stale');
  assert.equal(assessScientificQuality(projectId,null,[{...s,sha256:'a'.repeat(64)}]).decision,'blocked');
  const conflicting=scientificFixture(projectId,1);(conflicting.data.observations as any[])[0].value=99;conflicting.sha256=sourceHash(conflicting.data);
  assert(assessScientificQuality(projectId,null,[s,conflicting]).checks.some(c=>c.code==='REPORTED_DISAGREEMENT'));
});
test('MOOS source identity cannot be overridden by a projected study field to bypass leakage grouping',()=>{
  const s=scientificFixture(projectId);s.ref={connectionId:'moos-local',sourceId:7,experimentId:1,packageImportId:1,generation:1,packageSha256:'a'.repeat(64),projectionSha256:'b'.repeat(64),reviewScope:'include-unreviewed',reviewStatus:'unreviewed'};
  assert.equal(leakageGroup(s,{study_id:'invented A'}),leakageGroup(s,{study_id:'invented B'}));
});
