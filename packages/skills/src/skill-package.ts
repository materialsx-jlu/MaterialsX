import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { skillName, skillFilePath } from '../../contracts/src/skill-installation.js';

export const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
export type SkillPackage = { source: string; revision: string; files: Map<string, Buffer> };
export const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
export function validatePackage(pkg: SkillPackage) {
  if (pkg.files.size > 256 || !pkg.files.has('SKILL.md')) throw Error('Skill 目录必须包含 SKILL.md，且文件不得超过 256 个。');
  if (new Set([...pkg.files.keys()].map(p => p.toLowerCase())).size !== pkg.files.size || pkg.files.has('installation.json'))
    throw Error('Skill 文件包含大小写冲突或占用 installation.json。');
  let bytes = 0;
  for (const [path, data] of pkg.files) {
    skillFilePath.parse(path); bytes += data.length;
    if (data.length > 2 * 1024 * 1024 || bytes > MAX_PACKAGE_BYTES) throw Error('Skill 文件包超过限制：单文件 2 MiB，总计 20 MiB。');
  }
  const data = pkg.files.get('SKILL.md')!;
  if (data.length > 60000) throw Error('SKILL.md 超过 60000 字节，请拆分到 references。');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^\uFEFF/, '');
  const header = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!header) throw Error('SKILL.md 缺少 YAML 头部（name、description）。');
  const yaml = parseDocument(header[1]!, { uniqueKeys: true });
  if (yaml.errors.length) throw Error('SKILL.md 的 YAML 头部无效。');
  const meta = yaml.toJS({ maxAliasCount: 20 }) as Record<string, unknown>;
  if (!meta || typeof meta !== 'object' || typeof meta.description !== 'string' || !meta.description.trim())
    throw Error('SKILL.md 必须声明 name 和 description。');
  const name = skillName.parse(meta.name), original = meta.description.trim();
  const description = { zh: typeof meta.description_zh === 'string' ? meta.description_zh : `来源简介：${original}`,
    en: typeof meta.description_en === 'string' ? meta.description_en : original };
  if (Object.values(description).some(v => v.length > 4096) || original.length > 1023 || /[<>]/.test(original))
    throw Error('Skill 简介过长或包含无效标记。');
  const files = [...pkg.files].sort(([a], [b]) => a.localeCompare(b)).map(([path, data]) => ({ path, bytes: data.length, sha256: sha256(data) }));
  const digest = sha256(JSON.stringify({ name, files }));
  return { name, description, files, sha256: digest, license: typeof meta.license === 'string' ? meta.license.slice(0, 256) : null };
}
