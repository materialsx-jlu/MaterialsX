import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSkills } from '@earendil-works/pi-coding-agent';
import { SkillInstallationService } from './installation-service.js';
import { GitHubSkillSource, githubSkillSource } from './skill-sources.js';
import { prepareSkillResources } from './skill-resources.js';
import { createInstalledSkillTools } from '../../pi-adapter/src/installed-skill-tools.js';
import { PiLocalSessionService } from '../../pi-adapter/src/local-session.js';
import { parseSkillInstallCommand, executeSkillInstallCommand } from '../../../apps/desktop/main/skill-install-command.js';
import { skillFilePath } from '../../contracts/src/skill-installation.js';

const signal = () => new AbortController().signal;
const skill = (name = 'fixture-analysis') => `---\nname: ${name}\ndescription: Analyze the user's CSV with the bundled helper.\ndescription_zh: 使用附带脚本分析用户的 CSV。\nlicense: MIT\n---\n\nRead scripts/check.py, then follow the approved project tool scope.\n`;
async function fixture(dir: string, name = 'fixture-analysis') {
  const source = join(dir, 'source'); await mkdir(join(source, 'scripts'), { recursive: true });
  await writeFile(join(source, 'SKILL.md'), skill(name)); await writeFile(join(source, 'scripts/check.py'), 'print("fixture helper")\n');
  await writeFile(join(source, 'scripts/__init__.py'), ''); await writeFile(join(source, 'LICENSE'), 'MIT fixture license'); return source;
}
test('explicit bilingual install commands are recognized without treating scientific conversation as installation', () => {
  for (const command of ['安装 Skill frontend-design', '请安装 frontend-design Skill', '帮我安装 @frontend-design SKILL', 'Install Skill frontend-design', 'Please install frontend-design skill', '请安装名为 frontend-design 的 Skill'])
    assert.equal(parseSkillInstallCommand(command), 'frontend-design', command);
  assert.equal(parseSkillInstallCommand('安装 Skill [例子](https://github.com/a/b/tree/main/skills/example)'), 'https://github.com/a/b/tree/main/skills/example');
  for (const request of ['如何安装 Skill？', '描述如何安装一个 skill', '分析材料结构', '请运行这个 skill', '请搜索有关安装 skill 的论文']) assert.equal(parseSkillInstallCommand(request), null);
});
test('real local package installs intact, persists, indexes in Pi and Codex, and stages runnable resources without executing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mx-skill-package-'));
  try {
    const source = await fixture(dir), project = join(dir, 'project'); await mkdir(project); let changed = 0;
    const service = new SkillInstallationService(join(dir, 'state'), () => [], undefined, () => changed++); await service.restore();
    const result = await executeSkillInstallCommand(service, source, signal()); assert.equal(result.status, 'completed'); assert.match(result.text, /安装完成/);
    assert.equal(changed, 1); assert.equal(service.list()[0]!.files.length, 4); assert.equal(await service.text('fixture-analysis'), skill());
    assert.equal(service.summaries()[0]!.descriptionZh, '使用附带脚本分析用户的 CSV。'); assert.equal(service.summaries()[0]!.examples.length, 1);
    assert.equal(loadSkills({ cwd: project, agentDir: join(dir, 'agent'), skillPaths: service.paths(), includeDefaults: false }).skills[0]!.name, 'fixture-analysis');
    const local = new PiLocalSessionService(dir, join(dir, 'agent'), () => createInstalledSkillTools(service, project), () => service.paths());
    try {
      const tools = await local.hostTools(project, 'conversation', ['read', 'patch']);
      const read = tools.find(t => t.name === 'read_skill')!; const output = await read.execute({ name: 'fixture-analysis' }, signal()); assert.match(output.content[0]!.text, /bundled helper/);
      assert(tools.some(t => t.name === 'skill_resource'));
      assert(!(await local.hostTools(project, 'conversation', ['read'])).some(t => t.name === 'skill_resource'));
    } finally { local.dispose(); }
    const staged = await prepareSkillResources(service, 'fixture-analysis', project, signal());
    assert.equal(staged.scriptsExecuted, false); assert.equal(staged.dependenciesInstalled, false);
    assert.equal(await readFile(join(staged.directory, 'scripts/check.py'), 'utf8'), 'print("fixture helper")\n');
    assert.equal((await prepareSkillResources(service, 'fixture-analysis', project, signal())).directory, staged.directory);
    const existing = await service.install(source, signal()); assert(existing.alreadyInstalled); assert.equal(changed, 1);
    const restored = new SkillInstallationService(join(dir, 'state'), () => []); await restored.restore(); assert.equal(restored.paths().length, 1);
    await restored.enable('fixture-analysis', false); assert.equal(restored.paths().length, 0); await assert.rejects(restored.text('fixture-analysis'), /DISABLED/);
    await restored.enable('fixture-analysis', true); await restored.remove('fixture-analysis'); assert.equal(restored.list().length, 0);
    assert.equal((await readdir(join(restored.root, '.trash'))).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('tamper, traversal, credentials, links, conflicting installs and cancellation cannot produce fake successful installation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mx-skill-reject-'));
  try {
    const source = await fixture(dir); const service = new SkillInstallationService(join(dir, 'state'), () => []); await service.restore();
    for (const path of ['../escape', '/absolute', '.env', 'scripts/.env.production', 'file.pem', 'scripts/a:stream', 'scripts/CON.py', 'a\\b', 'a/../b']) assert(!skillFilePath.safeParse(path).success, path);
    await writeFile(join(source, '.env'), 'fixture-secret'); await assert.rejects(service.install(source, signal())); assert.equal(service.list().length, 0); await rm(join(source, '.env'));
    await symlink(join(dir, 'outside'), join(source, 'scripts/link')); await assert.rejects(service.install(source, signal()), /符号链接/); await rm(join(source, 'scripts/link'));
    const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(service.install(source, cancelled.signal)); assert.equal(service.list().length, 0);
    await service.install(source, signal()); await writeFile(join(source, 'scripts/check.py'), 'changed'); await assert.rejects(service.install(source, signal()), /内容不同/);
    await writeFile(join(service.root, 'fixture-analysis', 'scripts/check.py'), 'tampered'); await assert.rejects(service.bytes('fixture-analysis', 'scripts/check.py'), /CHANGED/);
    await writeFile(join(service.root, 'fixture-analysis', 'SKILL.md'), 'tampered'); assert.equal(service.paths().length, 0); assert.equal(service.summaries()[0]!.enabled,false);
    await service.restore(); assert.equal(service.paths().length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('GitHub fetch pins real SHA, downloads only selected package resources and retains upstream license', async () => {
  const revision = 'a'.repeat(40), requested: string[] = [];
  const request = (async (url: string | URL | Request) => {
    const u = String(url); requested.push(u);
    if (u.endsWith('/commits/main')) return Response.json({ sha: revision });
    if (u.includes('/git/trees/')) return Response.json({ truncated: false, tree: [
      { path: 'skills/fixture-analysis/SKILL.md', type: 'blob', mode: '100644' },
      { path: 'skills/fixture-analysis/scripts/check.py', type: 'blob', mode: '100755' },
      { path: 'skills/unselected/SKILL.md', type: 'blob', mode: '100644' }, { path: 'LICENSE', type: 'blob', mode: '100644' }] });
    if (u.endsWith('/SKILL.md')) return new Response(skill()); if (u.endsWith('/LICENSE')) return new Response('original license');
    return new Response('print("fixture")');
  }) as typeof fetch;
  const pkg = await new GitHubSkillSource(request).load('https://github.com/test/skills/tree/main/skills/fixture-analysis', null, signal());
  assert.equal(pkg.revision, revision); assert.equal(pkg.files.size, 3); assert.equal(pkg.files.get('LICENSE.source')!.toString(), 'original license');
  assert(!requested.some(u => /unselected/.test(u))); assert(requested.filter(u => u.includes('raw.githubusercontent')).every(u => u.includes(revision)));
  for (const url of ['http://github.com/a/b', 'https://evil.example/a/b', 'https://github.com/a/b?key=secret', 'https://github.com/a/b/tree/main/../escape', 'https://github.com/a/b/blob/main/script.py'])
    assert.throws(() => githubSkillSource(url), Error, url);
});
test('a symlinked project destination cannot expose Skill resources outside the approved project', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mx-skill-stage-'));
  try {
    const source = await fixture(dir), project = join(dir, 'project'), outside = join(dir, 'outside'); await mkdir(project); await mkdir(outside);
    const service = new SkillInstallationService(join(dir, 'state'), () => []); await service.restore(); await service.install(source, signal());
    await symlink(outside, join(project, '.materialsx')); await assert.rejects(prepareSkillResources(service, 'fixture-analysis', project, signal()), /UNSAFE/);
    assert.deepEqual(await readdir(outside), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
