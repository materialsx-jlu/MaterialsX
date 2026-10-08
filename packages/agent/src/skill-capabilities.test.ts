import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withCurrentGuidance } from './current-guidance.js';
import { MATERIALS_RESEARCH_INSTRUCTIONS } from './research-instructions.js';
import { executionMode } from './research-planning.js';
import { initialResearchTools } from './research-tools.js';
import { SkillInstallationService } from '../../skills/src/installation-service.js';
import { PiLocalSessionService } from '../../pi-adapter/src/local-session.js';
import { createInstalledSkillTools } from '../../pi-adapter/src/installed-skill-tools.js';
import { parseSkillInstallCommand } from '../../../apps/desktop/main/skill-install-command.js';
import { skillInstallationHelp } from '../../skills/src/installation-capability.js';

test('old native base instructions and false history cannot replace current host guidance on resume', () => {
  const history = [{ type: 'message', role: 'developer', content: 'Old MaterialsX base instructions' },
    { type: 'message', role: 'assistant', content: 'Cannot install; skill_installer is not authorized.' },
    { type: 'message', role: 'user', content: '你可以自己安装 skill吗' }];
  const request = { input: history, tools: [{ name: 'skill_capabilities' }] };
  const updated = withCurrentGuidance(request);
  assert.equal(updated.input.length, 4); assert.deepEqual(updated.input.slice(0, 3), history);
  assert(updated.input.at(-1)!.content.includes(MATERIALS_RESEARCH_INSTRUCTIONS));
  assert.deepEqual(withCurrentGuidance(updated), updated);
  assert.equal(request.input.length, 3); assert.deepEqual(updated.tools, request.tools);
  const fresh = { input: [{ role: 'developer', content: MATERIALS_RESEARCH_INSTRUCTIONS }, ...history.slice(1)] };
  assert.deepEqual(withCurrentGuidance(fresh), fresh, 'Fresh threads do not duplicate the guidance');
  const parts = { input: [{ role: 'developer', content: [{ type: 'input_text', text: MATERIALS_RESEARCH_INSTRUCTIONS }] }] };
  assert.deepEqual(withCurrentGuidance(parts), parts);
});
test('capability questions are read-only direct tasks; installation still requires a separate human command', () => {
  for (const question of ['你可以自己安装 skill吗', 'MaterialsX 能不能添加技能？', 'Can you install skills?', 'How can I install a skill?']) {
    assert.equal(executionMode(question), 'direct', question);
    assert.equal(parseSkillInstallCommand(question), null);
    assert(initialResearchTools(question).has('skill_capabilities'));
    const answer = skillInstallationHelp(question); assert.match(answer, /frontend-design/); assert.doesNotMatch(answer, /skill_installer|not authorized|不可以/);
  }
  assert.equal(parseSkillInstallCommand('安装 Skill frontend-design'), 'frontend-design');
  assert.equal(executionMode('为涂料设计实验并使用 skill 分析性能'), 'direct', 'The original loop must inspect capabilities before committing a calculation');
});
test('current host capability receipt is available through read-only engine grants and reflects changed extensions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mx-capability-'));
  const project = join(dir, 'project'), source = join(dir, 'source');
  let sessions: PiLocalSessionService | undefined;
  try {
    await mkdir(project); await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '---\nname: capability-fixture\ndescription: Capability receipt fixture\n---\nRead inputs.\n');
    const service = new SkillInstallationService(join(dir, 'state'), () => []); await service.restore();
    sessions = new PiLocalSessionService(dir, join(dir, 'agent'), () => createInstalledSkillTools(service, project), () => service.paths());
    const tools = await sessions.hostTools(project, 'fixture', ['read']);
    const tool = tools.find(t => t.name === 'skill_capabilities')!; assert(tool);
    const signal = new AbortController().signal;
    const get = async () => JSON.parse((await tool.execute({}, signal)).content[0]!.text);
    const before = await get(); assert.equal(before.installation.available, true);
    assert.equal(before.installation.requiresModelTool, false); assert.equal(before.installation.requiresAdministrator, false);
    assert.deepEqual(before.installed, []); assert.deepEqual(await readdir(service.root), [], 'Inquiry creates no installation');
    assert(!(await sessions.hostTools(project, 'fixture', [])).some(t => t.name === 'skill_capabilities'));
    await service.install(source, signal); assert.deepEqual((await get()).installed, [{ name: 'capability-fixture', enabled: true }]);
    await service.enable('capability-fixture', false); assert.equal((await get()).installed[0].enabled, false);
    await service.enable('capability-fixture', true); await writeFile(join(service.root, 'capability-fixture', 'SKILL.md'), 'tampered');
    assert.equal((await get()).installed[0].enabled, false, 'Modified instructions are not advertised as enabled');
    await assert.rejects(tool.execute({ install: 'unexpected' }, signal));
  } finally { sessions?.dispose(); await rm(dir, { recursive: true, force: true }); }
});
