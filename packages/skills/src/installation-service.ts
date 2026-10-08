import { mkdir, readdir, lstat, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { installedSkillSchema, skillName, skillFilePath, type InstalledSkill } from '../../contracts/src/skill-installation.js';
import type { SkillSummary } from '../../contracts/src/desktop.js';
import { readOwnedBytes } from '../../atomistic/src/artifact-io.js';
import { GitHubSkillSource, localSkillPackage } from './skill-sources.js';
import { sha256, validatePackage, type SkillPackage } from './skill-package.js';

export const INSTALLED_SKILL_SOURCE = 'MaterialsX installed Skill';
export class SkillInstallationService {
  readonly root: string;
  private changing = false;
  private records: InstalledSkill[] = [];
  constructor(userData: string, private reserved: () => readonly SkillSummary[], private github = new GitHubSkillSource(), private changed: () => void = () => {}) {
    this.root = join(userData, 'installed-skills');
  }
  private async directory(path: string) {
    const s = await lstat(path); if (s.isSymbolicLink() || !s.isDirectory()) throw Error('UNSAFE_SKILL_DIRECTORY');
  }
  async restore() {
    await mkdir(this.root, { recursive: true, mode: 0o700 }); await this.directory(this.root);
    const records: InstalledSkill[] = [];
    for (const entry of await readdir(this.root)) {
      if (!skillName.safeParse(entry).success || this.reserved().some(s => s.name === entry)) continue;
      try {
        const path = join(this.root, entry); await this.directory(path);
        const r = installedSkillSchema.parse(JSON.parse((await readOwnedBytes(path, join(path, 'installation.json'), null, 256 * 1024)).toString('utf8')));
        if (r.name !== entry) continue;
        await readOwnedBytes(path, join(path, 'SKILL.md'), r.files.find(f => f.path === 'SKILL.md')!.sha256, 60000);
        records.push(r);
      } catch { /* Modified or unsafe installations are not advertised. */ }
    }
    this.records = records;
  }
  list() { return structuredClone(this.records); }
  private usable(r: InstalledSkill) {
    try {
      for (const path of [this.root, join(this.root,r.name)]) { const s=lstatSync(path);if(s.isSymbolicLink()||!s.isDirectory())return false; }
      const path=join(this.root,r.name,'SKILL.md'),s=lstatSync(path);
      return !s.isSymbolicLink()&&s.isFile()&&s.size<=60000&&sha256(readFileSync(path))===r.files.find(f=>f.path==='SKILL.md')!.sha256;
    } catch { return false; }
  }
  paths() { return this.records.filter(r => r.enabled && this.usable(r)).map(r => join(this.root, r.name, 'SKILL.md')); }
  summaries(): SkillSummary[] {
    return this.records.map(r => ({ name: r.name, description: r.description.en, descriptionZh: r.description.zh, descriptionEn: r.description.en,
      source: INSTALLED_SKILL_SOURCE, category: 'installed', categoryLabelZh: '已安装扩展', categoryLabelEn: 'Installed extensions',
      license: r.license ?? (r.files.some(f => /^LICENSE/.test(f.path)) ? 'See bundled upstream license' : 'License not declared'),
      enabled: r.enabled && this.usable(r), availability: 'ready', examples: [{ zh: `@${r.name} 请按这个 Skill 的流程处理我的任务，先检查输入和依赖。`,
        en: `@${r.name} Follow this Skill for my task; check inputs and dependencies first.` }] }));
  }
  get(name: string) { const r = this.records.find(r => r.name === name); if (!r) throw Error('SKILL_NOT_INSTALLED'); return structuredClone(r); }
  async bytes(name: string, path = 'SKILL.md') {
    const r = this.get(name); if (!r.enabled) throw Error('SKILL_DISABLED'); skillFilePath.parse(path);
    const file = r.files.find(f => f.path === path); if (!file) throw Error('SKILL_RESOURCE_NOT_FOUND');
    return readOwnedBytes(join(this.root, name), join(this.root, name, path), file.sha256, 2 * 1024 * 1024, true);
  }
  async text(name: string) { return new TextDecoder('utf-8', { fatal: true }).decode(await this.bytes(name)); }
  async install(sourceOrName: string, signal: AbortSignal) {
    const source = sourceOrName.trim();
    if (this.changing) throw Error('另一个 Skill 正在安装，请稍后重试。');
    this.changing = true;
    try {
      if (skillName.safeParse(source).success) {
        const bundled = this.reserved().find(s => s.name === source);
        if (bundled) return { name: source, alreadyInstalled: true, enabled: bundled.enabled, source: bundled.source };
        const existing = this.records.find(s => s.name === source);
        if (existing) {
          for(const f of existing.files)await readOwnedBytes(join(this.root,source),join(this.root,source,f.path),f.sha256,2*1024*1024,true);
          if (!existing.enabled) await this.enable(source, true); return { name: source, alreadyInstalled: true, enabled: true, source: existing.source };
        }
      }
      let pkg: SkillPackage;
      if (isAbsolute(source)) pkg = await localSkillPackage(source, signal);
      else if (source.startsWith('https://')) pkg = await this.github.load(source, null, signal);
      else if (skillName.safeParse(source).success) {
        // Named installation searches known official catalogs only, never an arbitrary look-alike repository.
        const matches: SkillPackage[] = [];
        for (const repo of ['anthropics/skills', 'k-dense-ai/scientific-agent-skills']) {
          try { matches.push(await this.github.load(`https://github.com/${repo}`, source, signal)); }
          catch (e) { if (!(e instanceof Error && /未找到所需名称/.test(e.message))) throw e; }
        }
        if (matches.length !== 1) throw Error(matches.length ? '多个来源包含同名 Skill，请提供具体 GitHub 目录地址。' : '已知来源没有这个 Skill。请提供具体 GitHub 目录地址或本地绝对路径。');
        pkg = matches[0]!;
      } else throw Error('请提供 Skill 名称、GitHub 目录地址或本地绝对路径。');
      signal.throwIfAborted();
      return await this.writePackage(pkg, signal);
    } finally { this.changing = false; }
  }
  private async writePackage(pkg: SkillPackage, signal: AbortSignal) {
    const metadata = validatePackage(pkg);
    if (this.reserved().some(s => s.name === metadata.name)) throw Error('这个名称属于内置或自建 Skill，不能覆盖。');
    const previous = this.records.find(r => r.name === metadata.name);
    if (previous) {
      if (previous.sha256 !== metadata.sha256) throw Error('同名 Skill 已安装且内容不同。请先在扩展管理中移除旧版，不会自动覆盖。');
      // Verify files, not just a stale cached manifest, before claiming an idempotent install.
      for (const f of previous.files) await readOwnedBytes(join(this.root, previous.name), join(this.root, previous.name, f.path), f.sha256, 2 * 1024 * 1024, true);
      if (!previous.enabled) await this.enable(previous.name, true);
      return { name: metadata.name, alreadyInstalled: true, enabled: true, source: previous.source };
    }
    await this.directory(this.root);
    const stage = join(this.root, '.install-' + randomUUID()), dest = join(this.root, metadata.name);
    await mkdir(stage, { mode: 0o700 });
    try {
      for (const [path, bytes] of pkg.files) { signal.throwIfAborted(); const target = join(stage, path); await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, bytes, { flag: 'wx', mode: 0o600 }); }
      const record = installedSkillSchema.parse({ ...metadata, version: 'skill-install-v1', source: pkg.source, revision: pkg.revision,
        enabled: true, installedAt: new Date().toISOString() });
      await writeFile(join(stage, 'installation.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      try { await lstat(dest); throw Error('Skill 安装目录已存在，不能覆盖。'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      signal.throwIfAborted(); await rename(stage, dest); this.records.push(record); this.changed();
      return { name: record.name, alreadyInstalled: false, enabled: true, source: record.source, revision: record.revision,
        sha256: record.sha256, files: record.files.length, directory: dest, dependenciesInstalled: false, scriptsExecuted: false };
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  async enable(name: string, enabled: boolean) {
    const r = this.get(name); r.enabled = enabled; const dir = join(this.root, name); await this.directory(dir);
    if(enabled)for(const f of r.files)await readOwnedBytes(dir,join(dir,f.path),f.sha256,2*1024*1024,true);
    const temp = join(dir, '.record-' + randomUUID());
    await writeFile(temp, JSON.stringify(r, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temp, join(dir, 'installation.json')); this.records = this.records.map(old => old.name === name ? r : old); this.changed();
  }
  async remove(name: string) {
    this.get(name); await this.directory(join(this.root, name));
    // Recoverable removal: packages are kept under a private trash directory.
    const trash = join(this.root, '.trash'); await mkdir(trash, { recursive: true, mode: 0o700 }); await this.directory(trash);
    await rename(join(this.root, name), join(trash, name + '-' + randomUUID()));
    this.records = this.records.filter(r => r.name !== name); this.changed();
  }
}
