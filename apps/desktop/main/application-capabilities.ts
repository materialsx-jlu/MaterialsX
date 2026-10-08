import type { CapabilityFact } from '../../../packages/contracts/src/capability-awareness.js';
import type { SkillSummary } from '../../../packages/contracts/src/desktop.js';
import { SKILL_INSTALLATION_CAPABILITY } from '../../../packages/skills/src/installation-capability.js';

/** Cheap local metadata only. No background network, model inference, dependency installation or credential reads. */
export function publicApplicationCapabilities():CapabilityFact[]{
  return [{ id:'host:skill.install',label:{zh:'对话安装 Skill',en:'Install a Skill in chat'},kind:'host-action',registered:true,
    configured:SKILL_INSTALLATION_CAPABILITY.available,installed:null,authorization:'requires-user-command',readiness:'verified',evidence:['host-chat-installer'],
    detail:`Send ${SKILL_INSTALLATION_CAPABILITY.commands.zh} / ${SKILL_INSTALLATION_CAPABILITY.commands.en}. The host validates and registers it; no administrator/model installation tool is required. Does not execute scripts/install dependencies. Network/source availability still affects each install.` }];
}
export function applicationCapabilities(skills: readonly (Pick<SkillSummary,'name'|'enabled'>&{installed?:boolean})[], potentials: readonly {potentialId:string;installed:boolean}[], moosConfigured: boolean, paperConfigured: boolean): CapabilityFact[] {
  const facts = publicApplicationCapabilities();
  for(const skill of skills)facts.push({id:'skill:'+skill.name,label:{zh:skill.name,en:skill.name},kind:'resource',registered:true,configured:true,installed:skill.installed??true,
    authorization:skill.enabled?'allowed':'denied',readiness:skill.enabled?'unverified':'blocked',evidence:['host-skill-index'],
    detail:skill.enabled?'Instructions are enabled; dependencies and actual execution are not certified by installation.':'Instruction file is missing, disabled or failed its owned integrity check; do not invoke until resolved.'});
  for(const p of potentials)facts.push({id:'potential:'+p.potentialId,label:{zh:p.potentialId,en:p.potentialId},kind:'resource',registered:true,configured:true,
    installed:p.installed,authorization:'not-applicable',readiness:p.installed?'unverified':'blocked',evidence:['host-potential-installation'],
    detail:p.installed?'Owned installation/runtime metadata exists. Check task applicability, current permission and actual inference receipts.':'Matching weights/runtime unavailable; catalog registration is not installation.'});
  for(const [name,configured] of [['moos',moosConfigured],['paper',paperConfigured]] as const)facts.push({id:'service:'+name,
    label:{zh:name==='moos'?'MOOS 材料数据':'论文检索与读取',en:name==='moos'?'MOOS materials data':'Paper search and reading'},kind:'service',registered:true,
    configured,installed:null,authorization:'not-applicable',readiness:configured?'unverified':'blocked',evidence:['host-service-configuration'],
    detail:configured?'Adapter configured; connection health, record access and dependencies need actual scoped tool checks.':'Backend is not configured; do not invent returned data.'});
  return facts;
}
