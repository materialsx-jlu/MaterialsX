import { AgentError, type PermissionGrant } from "../../contracts/src/agent.js";
/** Conservative explicit limits only; material targets are never interpreted as budgets. */
export function requestedGrant(
  grant: PermissionGrant,
  text: string,
): PermissionGrant {
  const result = structuredClone(grant);
  const time = text.match(
    /(?:限时|时间上限|最长|不超过|最多|within|time\s*limit\s*[:=]?|at\s*most)\s*(\d+(?:\.\d+)?)\s*(秒|分钟|小时|seconds?|minutes?|hours?|s\b|min\b|h\b)/i,
  );
  if (time) {
    const unit = time[2]!.toLowerCase();
    const scale = /小时|hour|^h$/.test(unit)
      ? 3600
      : /分钟|minute|^min$/.test(unit)
        ? 60
        : 1;
    const seconds = Math.floor(Number(time[1]) * scale);
    if (seconds <= 0)
      throw new AgentError("PERMISSION_DENIED", "时间上限不足，未启动任务");
    result.maxSeconds = Math.min(result.maxSeconds, seconds);
  }
  const credits = text.match(
    /(?:预算|积分上限|最多|不超过|budget\s*[:=]?|at\s*most)\s*(\d+(?:\.\d{1,4})?)\s*(?:积分|credits?)/i,
  );
  if (credits) {
    const value = Number(credits[1]);
    if (value <= 0)
      throw new AgentError("PERMISSION_DENIED", "本轮没有可用消费额度");
    if (result.maxCredits !== null)
      result.maxCredits = String(Math.min(Number(result.maxCredits), value));
  }
  if (/不要联网|禁止联网|不允许联网|no\s+internet|offline\s+only/i.test(text))
    result.permissions = result.permissions.filter((p) => p !== "network");
  if (
    /不(?:要|允许)执行(?:脚本|命令)|do\s+not\s+(?:run|execute)\s+(?:commands|scripts)/i.test(
      text,
    )
  )
    result.permissions = result.permissions.filter((p) => p !== "terminal");
  if (/不(?:要|允许)写(?:入|文件)|do\s+not\s+write\s+files/i.test(text))
    result.permissions = result.permissions.filter((p) => p !== "patch");
  if (/只(?:给|要|需).{0,6}(?:文字|口头|建议)|仅(?:回答|解释)|(?:text|advice)[ -]only|only (?:give|provide) (?:text|advice)/i.test(text))
    result.permissions = result.permissions.filter(p => !['terminal','patch','science'].includes(p));
  if (/不(?:要|需|允许)?(?:运行|执行|做)?(?:模拟|仿真|计算)|do not (?:run|perform) (?:simulations?|calculations?)/i.test(text))
    result.permissions = result.permissions.filter(p => p !== 'science');
  return result;
}
