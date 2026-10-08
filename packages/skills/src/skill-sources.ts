import { lstat, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { readOwnedBytes } from '../../atomistic/src/artifact-io.js';
import { skillFilePath } from '../../contracts/src/skill-installation.js';
import { MAX_PACKAGE_BYTES, sha256, type SkillPackage } from './skill-package.js';

const excluded = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv']);
export async function localSkillPackage(source: string, signal: AbortSignal): Promise<SkillPackage> {
  if (!isAbsolute(source)) throw Error('请提供 Skill 文件夹或 SKILL.md 的绝对路径。');
  const initial = await lstat(source);
  if (initial.isSymbolicLink()) throw Error('不支持符号链接 Skill 来源。');
  if (initial.isFile() && basename(source) !== 'SKILL.md') throw Error('请指定 SKILL.md 或它所在的文件夹。');
  const root = await realpath(initial.isDirectory() ? source : dirname(source));
  const files = new Map<string, Buffer>(); let bytes = 0;
  async function visit(dir: string) {
    signal.throwIfAborted();
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const path = join(dir, entry.name), rel = relative(root, path).split('\\').join('/');
      skillFilePath.parse(rel);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        if (files.size >= 256) throw Error('Skill 文件数量超过 256。');
        const data = await readOwnedBytes(root, path, null, 2 * 1024 * 1024, true); bytes += data.length;
        if (bytes > MAX_PACKAGE_BYTES) throw Error('Skill 文件包超过 20 MiB。');
        files.set(rel, data);
      } else throw Error('Skill 不支持符号链接、设备文件或子模块。');
    }
  }
  await visit(root);
  return { source: root, revision: sha256(JSON.stringify([...files].map(([p, b]) => [p, sha256(b)]))), files };
}

type GitHubSource = { owner: string; repo: string; ref: string | null; directory: string };
export function githubSkillSource(source: string): GitHubSource {
  if (/(?:\/|^)\.\.(?:\/|$)/.test(decodeURIComponent(source))) throw Error('GitHub Skill 地址不能包含路径穿越。');
  const u = new URL(source);
  if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.username || u.password || u.search || u.hash)
    throw Error('网络来源需使用 https://github.com/... 的 Skill 目录地址。');
  const parts = u.pathname.replace(/\/$/, '').slice(1).split('/').map(p => decodeURIComponent(p));
  const [owner, repo, kind, ref, ...tail] = parts;
  if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo) || (kind && !['tree', 'blob'].includes(kind)))
    throw Error('GitHub Skill 地址无效。');
  if (kind && (!ref || !/^[\w.-]+$/.test(ref))) throw Error('请使用不含斜杠的分支、标签或提交 SHA 地址。');
  if (kind === 'blob' && tail.at(-1) !== 'SKILL.md') throw Error('GitHub 文件地址必须指向 SKILL.md。');
  if (kind === 'blob') tail.pop();
  const directory = tail.join('/'); if (directory) skillFilePath.parse(directory);
  return { owner, repo: repo.replace(/\.git$/, ''), ref: ref ?? null, directory };
}
export class GitHubSkillSource {
  constructor(private request: typeof fetch = fetch) {}
  private async bytes(url: string, limit: number, signal: AbortSignal) {
    const response = await this.request(url, { signal, redirect: 'error', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MaterialsX-Skills' } });
    if (!response.ok) throw Error(response.status === 403 || response.status === 429 ? 'GitHub 请求限流，请稍后重试或下载后从本地安装。' : `GitHub 来源读取失败（HTTP ${response.status}）。`);
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw Error('Skill 来源响应过大。'); }
    const reader = response.body?.getReader(); if (!reader) throw Error('GitHub 返回空响应。');
    const chunks: Buffer[] = []; let count = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; count += value.length;
      if (count > limit) throw Error('Skill 来源响应过大。'); chunks.push(Buffer.from(value)); }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    return Buffer.concat(chunks);
  }
  private async json(url: string, signal: AbortSignal) { return JSON.parse((await this.bytes(url, 8 * 1024 * 1024, signal)).toString('utf8')); }
  async load(source: string, name: string | null, signal: AbortSignal): Promise<SkillPackage> {
    const parsed = githubSkillSource(source), base = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
    const ref = parsed.ref ?? (await this.json(base, signal)).default_branch;
    if (typeof ref !== 'string') throw Error('GitHub 默认分支无法读取。');
    const commit = await this.json(`${base}/commits/${encodeURIComponent(ref)}`, signal);
    const revision = commit.sha as string;
    if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('GitHub 未返回可固定的提交 SHA。');
    const tree = await this.json(`${base}/git/trees/${revision}?recursive=1`, signal);
    if (tree.truncated || !Array.isArray(tree.tree)) throw Error('GitHub 仓库目录过大，请从本地安装单个 Skill。');
    const entries = tree.tree as Array<{ path: string; type: string; mode: string; size?: number }>;
    let directory = parsed.directory;
    if (!directory && !entries.some(e => e.path === 'SKILL.md')) {
      const candidates = entries.filter(e => e.path.endsWith('/SKILL.md') && (!name || e.path.split('/').at(-2) === name));
      if (candidates.length !== 1) throw Error(`请选择一个具体 Skill 目录${candidates.length ? '：' + candidates.slice(0, 8).map(e => e.path).join('，') : '；未找到所需名称'}。`);
      directory = candidates[0]!.path.slice(0, -'/SKILL.md'.length);
    }
    const prefix = directory ? directory + '/' : '';
    const selected = entries.filter(e => e.path.startsWith(prefix) && e.type !== 'tree');
    if (selected.length > 255) throw Error('Skill 文件数量超过 256，请从本地安装精简包。');
    const files = new Map<string, Buffer>(); let size = 0;
    for (const e of selected) {
      const path = e.path.slice(prefix.length); skillFilePath.parse(path);
      if (e.type !== 'blob' || !['100644', '100755'].includes(e.mode)) throw Error('Skill 不支持符号链接或 Git 子模块。');
      if ((e.size ?? 0) > 2 * 1024 * 1024) throw Error('Skill 单文件超过 2 MiB。');
      const data = await this.bytes(`https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${revision}/${e.path.split('/').map(encodeURIComponent).join('/')}`, 2 * 1024 * 1024, signal);
      size += data.length; if (size > MAX_PACKAGE_BYTES) throw Error('Skill 文件包超过 20 MiB。'); files.set(path, data);
    }
    // Retain upstream license text alongside resources; never relabel third-party rights.
    if (directory && !files.has('LICENSE')) {
      const license = entries.find(e => /^(LICENSE|LICENSE\.md|LICENSE\.txt)$/i.test(e.path) && e.type === 'blob' && e.mode === '100644');
      if (license) files.set('LICENSE.source', await this.bytes(`https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${revision}/${license.path}`, 256 * 1024, signal));
    }
    return { source: `https://github.com/${parsed.owner}/${parsed.repo}/tree/${revision}${directory ? '/' + directory : ''}`, revision, files };
  }
}
