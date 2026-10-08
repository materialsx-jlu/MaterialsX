import test from 'node:test';
import assert from 'node:assert/strict';
import {skillCapabilityQuestion,skillInstallationHelp} from './installation-capability.js';
import {parseSkillInstallCommand} from '../../../apps/desktop/main/skill-install-command.js';
test('bulk installation capability questions with a trailing URL are answered from current host facts',()=>{
  const query='可以安装这里面 所有 SKILL吗 https://github.com/HKUSTDial/Supervisor-Skills';
  assert(skillCapabilityQuestion(query));assert.equal(parseSkillInstallCommand(query),null);
  assert.match(skillInstallationHelp(query),/尚不支持.*一键安装/);assert.match(skillInstallationHelp(query),/没有安装任何/);
  assert(skillCapabilityQuestion('Can you install all Skills from https://github.com/example/repository?'));
  assert.match(skillInstallationHelp('Can you install all Skills?'),/bulk installation.*not supported/);
  assert(!skillCapabilityQuestion('安装 Skill frontend-design'));
});
