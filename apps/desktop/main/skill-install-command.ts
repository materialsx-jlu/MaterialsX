import type { SkillInstallationService } from '../../../packages/skills/src/installation-service.js';

/** Only a standalone human command authorizes installation. Documents and model tool results do not. */
export function parseSkillInstallCommand(content: string): string | null {
  const text = content.trim();
  const match = text.match(/^(?:(?:请|帮我|请帮我)\s*)?(?:安装|添加)\s*(?:一个\s*)?(?:skill\s*[:：]?\s*(.+)|(.+?)\s*(?:这个\s*)?skill)[。.!！]?$/i)
    ?? text.match(/^(?:please\s+)?install\s+(?:the\s+)?skill\s*[:：]?\s+(.+?)[.!]?$/i)
    ?? text.match(/^(?:please\s+)?install\s+(.+?)\s+skill[.!]?$/i);
  if (!match) return null;
  let source = (match[1] ?? match[2] ?? '').trim().replace(/[。！]$/, '').trim();
  const link = source.match(/^\[.*?\]\(([^)]+)\)$/); if (link) source = link[1]!;
  source = source.replace(/^[@`"'“]+|[`"'”]+$/g, '').replace(/^名为\s*/, '').replace(/\s*的$/, '').trim();
  return source || '';
}
export async function executeSkillInstallCommand(service: SkillInstallationService, source: string, signal: AbortSignal) {
  const r = await service.install(source, signal);
  if (!r.enabled) return { status: 'blocked' as const, text: `\`${r.name}\` 已随程序内置，但当前未启用。请在 Skills 设置中核对状态。` };
  return { status: 'completed' as const, text: `${r.alreadyInstalled ? '已安装，可直接使用' : 'Skill 安装完成'}：**${r.name}**。\n\n` +
    `已加入 Skills 页面和 \`@\` 列表。下一条消息可输入：\n\n\`@${r.name} 请按这个 Skill 的流程处理我的任务。\`\n\n` +
    `来源：${r.source}\n\n` + ('revision' in r ? `固定版本：\`${r.revision}\`。保留了 SKILL.md、附带资源和来源许可。\n\n` : '') +
    '安装不执行脚本，也不自动安装 Python/npm 依赖；使用时会检查所需环境。\n\nInstalled and available through @; dependency installation and script execution remain separate tasks.' };
}
