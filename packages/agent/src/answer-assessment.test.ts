import test from 'node:test';
import assert from 'node:assert/strict';
import {assessAnswer} from './answer-assessment.js';
import {capabilitySnapshot} from './capability-awareness.js';
import {harness} from './task-supervisor.fixture.js';
import {publicApplicationCapabilities} from '../../../apps/desktop/main/application-capabilities.js';

test('Skill installation answers distinguish a fabricated tool requirement from an explicit negation',()=>{
 const h=harness(),snapshot=capabilitySnapshot(null,publicApplicationCapabilities());
 for(const text of ['安装 Skill 不需要调用 skill_installer。','MaterialsX does not require skill_installer.','MaterialsX supports installing Skills through a user command.'])
  assert.equal(assessAnswer(text,[],snapshot,h.control.snapshot(),h.results.get).status,'needs_review',text);
 for(const text of ['安装需要调用 skill_installer。','MaterialsX requires skill_installer.','MaterialsX must use skill_installer.','skill_installer 在当前任务中未被授权。'])
  assert.equal(assessAnswer(text,[],snapshot,h.control.snapshot(),h.results.get).status,'blocked',text);
});
