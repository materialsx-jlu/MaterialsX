import test from 'node:test';
import assert from 'node:assert/strict';
import {supportedSkillInquiry} from '../../../../scripts/agent/rootflow-checks.js';
test('Skill inquiry distinguishes supported installation from tool and current-turn authorization',()=>{
 assert.equal(supportedSkillInquiry('可以。支持安装 Skill。输入：安装 Skill frontend-design。不需要模型拥有 skill_installer 工具，也不需要管理员授权；本轮禁止安装，没有执行。'),true);
 assert.equal(supportedSkillInquiry('MaterialsX can install Skills. Request: Install Skill frontend-design. This inquiry does not authorize installation.'),true);
 assert.equal(supportedSkillInquiry('不可以。无法安装 Skill，skill_installer 未授权。请管理员安装 Skill。'),false);
 assert.equal(supportedSkillInquiry('MaterialsX cannot install Skills. Ask an administrator to Install Skill frontend-design.'),false);
 assert.equal(supportedSkillInquiry('可以安装 Skill，但本轮没有安装。'),true);
 assert.equal(supportedSkillInquiry('可以支持。输入：安装 Skill frontend-design。不能把缺少该工具理解为“不支持安装”。'),true);
 assert.equal(supportedSkillInquiry('当前状态为“不支持安装”。请管理员安装 Skill。'),false);
 assert.equal(supportedSkillInquiry('可以。安装 Skill frontend-design。模型工具列表中没有安装工具，不等于应用不支持安装。'),true);
 assert.equal(supportedSkillInquiry('MaterialsX supports Skill installation. Install Skill frontend-design. Missing a model tool does not mean MaterialsX cannot install Skills.'),true);
 assert.equal(supportedSkillInquiry('MaterialsX can install Skills, but cannot install Skills in this environment. Install Skill frontend-design.'),false);
 assert.equal(supportedSkillInquiry('你可以请管理员安装 Skill。我们不支持安装。'),false);
 assert.equal(supportedSkillInquiry('不可以。请管理员安装 Skill。'),false);
});
