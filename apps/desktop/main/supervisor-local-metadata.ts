import { sep, join } from 'node:path';
import type { SkillSummary } from '../../../packages/contracts/src/desktop.js';
import type { InstalledSkill } from '../../../packages/contracts/src/skill-installation.js';

type Entry = { zh: string; en: string; example: string };
export function labelLocalSupervisorSkills(root: string, summaries: SkillSummary[], records: InstalledSkill[], metadata: Record<string, Entry>): SkillSummary[] {
  const sourceRoot = join(root, 'runtime/supervisor-skills-local-packages') + sep;
  const localNames = new Set(records.filter(record => record.source.startsWith(sourceRoot)).map(record => record.name));
  return summaries.map(skill => {
    const entry = localNames.has(skill.name) ? metadata[skill.name] : null;
    return entry ? {
      ...skill,
      category: 'supervisor-local', categoryLabelZh: '科研全流程 · 本机测试', categoryLabelEn: 'Research workflow · local test',
      description: entry.en, descriptionZh: entry.zh, descriptionEn: entry.en,
      license: 'CC BY-NC-SA 4.0 (repository; per-Skill terms to verify)',
      examples: [{ zh: `@${skill.name} ${entry.example}`, en: `@${skill.name} Help me apply this workflow to my research task.` }],
    } : skill;
  });
}
