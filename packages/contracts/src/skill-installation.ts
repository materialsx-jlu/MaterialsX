import { z } from 'zod';

export const skillName = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
  .refine(n => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(n));
export const skillFilePath = z.string().min(1).max(512).refine(p =>
  !p.includes('\\') && !p.startsWith('/') && p.split('/').every(x => x && x !== '.' && x !== '..' &&
    !/[\x00-\x1f:<>|"*?]/.test(x) && !/[. ]$/.test(x) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x)) &&
  !/(^|\/)(\.env(?:\..*)?|.*\.(pem|key|p12|pfx)|id_rsa|id_ed25519|auth\.json|credentials\.json|\.git)(\/|$)/i.test(p));
export const installedSkillSchema = z.strictObject({
  version: z.literal('skill-install-v1'), name: skillName,
  description: z.strictObject({ zh: z.string().min(1).max(4096), en: z.string().min(1).max(4096) }),
  source: z.string().min(1).max(2048), revision: z.string().min(1).max(256),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), enabled: z.boolean(), installedAt: z.iso.datetime(),
  license: z.string().max(256).nullable(),
  files: z.array(z.strictObject({ path: skillFilePath, bytes: z.number().int().min(0).max(2 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(256),
}).refine(r => r.files.some(f => f.path === 'SKILL.md') && new Set(r.files.map(f => f.path)).size === r.files.length);
export type InstalledSkill = z.infer<typeof installedSkillSchema>;
