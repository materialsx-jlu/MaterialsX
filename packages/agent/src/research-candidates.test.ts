import test from 'node:test';
import assert from 'node:assert/strict';
import {ResearchCandidates} from './research-candidates.js';
import type {MoosRef} from '../../contracts/src/research-project.js';
const ref:MoosRef={connectionId:'moos-local',sourceId:1,packageImportId:2,experimentId:3,generation:4,packageSha256:'a'.repeat(64),projectionSha256:'b'.repeat(64),reviewScope:'include-unreviewed',reviewStatus:'pending_review'};
test('short MOOS candidate handles preserve exact pinned references and reject other tasks or fabricated handles',()=>{
  const candidates=new ResearchCandidates(),id=candidates.issue('project','task',ref);
  assert.deepEqual(candidates.resolve('project','task',id),ref);
  const copy=candidates.resolve('project','task',id);copy.generation=99;
  assert.equal(candidates.resolve('project','task',id).generation,4);
  assert.throws(()=>candidates.resolve('other','task',id),/NOT_IN_TASK/);
  assert.throws(()=>candidates.resolve('project','other',id),/NOT_IN_TASK/);
  assert.throws(()=>candidates.resolve('project','task','moos-invented'),/NOT_IN_TASK/);
  assert.notEqual(candidates.issue('project','task',{...ref,generation:5}),id);
  candidates.clear();assert.throws(()=>candidates.resolve('project','task',id),/search again/);
});
test('selected snapshot handles freeze UUID, version and hash without exposing a fabricated MOOS reference',()=>{
 const c=new ResearchCandidates(),snapshot={id:'snapshot-uuid',version:'2',sha256:'c'.repeat(64)},handle=c.issueSnapshot('project','task',snapshot);
 assert.match(handle,/^moos-[a-f0-9]{24}$/);assert.deepEqual(c.resolveTarget('project','task',handle),{kind:'snapshot',snapshotId:snapshot.id,version:'2',sha256:snapshot.sha256});
 assert.throws(()=>c.resolve('project','task',handle),/PROJECT_SNAPSHOT/);assert.throws(()=>c.resolveTarget('other','task',handle),/NOT_IN_TASK/);
 assert.notEqual(c.issueSnapshot('project','task',{...snapshot,version:'3'}),handle);
});
