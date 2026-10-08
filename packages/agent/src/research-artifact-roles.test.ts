import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindArtifactRoles,scientificArtifactRole} from './research-artifact-roles.js';
test('published backend roles replace model-invented filenames while keeping explicit user file requirements',()=>{
  const steps=[{method:'research_method_run',expectedArtifacts:['report/mean.json','report/mean.txt','requested.json']},{method:'engine.execute',expectedArtifacts:['other.svg']}] as any;
  const acceptance={requiredArtifacts:['report/mean.json','report/mean.txt','requested.json','other.svg']} as any;
  bindArtifactRoles(steps,acceptance,'Save the requested result as requested.json');
  assert.deepEqual(steps[0].expectedArtifacts,['JSON','报告','requested.json']);
  assert.deepEqual(steps[1].expectedArtifacts,['other.svg']);
  assert.deepEqual(acceptance.requiredArtifacts,['JSON','报告','requested.json','other.svg']);
  assert.equal(scientificArtifactRole('report/mean.json'),null);
  assert.deepEqual(scientificArtifactRole('质量 JSON'),{quality:true,extension:'.json'});
});
