import { answerClaimSchema, type AnswerClaim, type AnswerAssessment, type CapabilitySnapshot } from '../../contracts/src/capability-awareness.js';
import type { TaskExecution } from '../../contracts/src/task-execution.js';
import {answerPathIssues} from './answer-paths.js';
import { digest } from './execution-context.js';

export function receiptClaimData(value: any): unknown {
  const text = typeof value === 'string' ? value : value?.content?.length === 1 && value.content[0]?.type === 'text' ? value.content[0].text : null;
  if(typeof text==='string'){try{return JSON.parse(text);}catch{/* Plain text remains the original evidence. */}}
  return value;
}

function pointer(value: any, path: string) {
  if (path === '') return value;
  if (!path.startsWith('/') || path.split('/').length > 16) throw Error('Invalid receipt JSON pointer');
  for (const key of path.slice(1).split('/').map(p => p.replace(/~1/g,'/').replace(/~0/g,'~'))) {
    if (['__proto__','constructor','prototype'].includes(key) || !value || typeof value !== 'object' || !Object.hasOwn(value,key)) throw Error('Receipt field is absent');
    value = value[key];
  }
  return value;
}
/** Exact claims use current owned facts/receipts. This does not certify free-form scientific reasoning. */
export function assessAnswer(text: string, claims: AnswerClaim[], snapshot: CapabilitySnapshot | null, state: TaskExecution, readResult: (ref: string) => unknown,projectPath?:string): AnswerAssessment {
  const issues: string[] = [];
  for (const raw of claims) {
    const claim = answerClaimSchema.parse(raw);
    if (claim.kind === 'capability') {
      const fact = snapshot?.facts.find(f => f.id === claim.id);
      if (!fact || snapshot!.revision !== claim.revision) issues.push('Capability claim uses an absent fact or old revision: '+claim.id);
      else if (fact[claim.dimension] !== claim.value) issues.push('Capability claim contradicts current host state: '+claim.id+'.'+claim.dimension);
    } else {
      const receipt = state.attempts.find(a => a.id === claim.receiptId && a.state === 'completed' && a.planRevision === state.planRevision);
      if (!receipt?.resultRef) { issues.push('Claim has no current successful owned receipt: '+claim.receiptId); continue; }
      try {
        const data=receiptClaimData(readResult(receipt.resultRef));
        const fields=claim.kind==='measurement'?[[claim.valuePointer,claim.value],[claim.unitPointer,claim.unit],[claim.sourcePointer,claim.source]] as const:[[claim.pointer,claim.value]] as const;
        for(const [path,value] of fields)if(pointer(data,path)!==value)issues.push('Receipt field/value/unit/source mismatch: '+claim.receiptId+path);
      } catch { issues.push('Receipt field is unavailable: '+claim.receiptId); }
    }
  }
  // Narrow contradictions are machine-checkable even without a structured claim. Do not classify arbitrary prose as proof.
  if(projectPath)issues.push(...answerPathIssues(text,projectPath,state));
  const normalized = text.normalize('NFKC').replace(/[\u2010-\u2015]/g,'-');
  for (const f of snapshot?.facts ?? []) {
    if (f.kind !== 'resource' || !f.id.startsWith('skill:')) continue;
    const name = f.id.slice(6).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const deniedInstall = new RegExp(`(?:${name}[^\n。]{0,30}(?:未安装|没有安装|not (?:currently )?installed)|(?:未安装|没有安装)[^\n。]{0,12}${name})`,'i');
    if (f.installed === true && deniedInstall.test(normalized)) issues.push('Answer denies an installed Skill: '+f.id);
    const enabled = new RegExp(`${name}[^\n。]{0,20}(?:已启用|is enabled|installed and enabled)`,'i');
    if (f.authorization === 'denied' && enabled.test(normalized)) issues.push('Answer claims a disabled/unavailable Skill is enabled: '+f.id);
  }
  if (snapshot?.facts.some(f => f.id === 'host:skill.install' && f.configured) &&
    /skill_installer[^\n。]{0,60}(?:未授权|未被授权|not authorized)|(?:(?<!不)需要|(?<!not )(?<!n't )\brequires?\b|(?<!not )\bmust use\b)[^\n。]{0,30}skill_installer/i.test(normalized))
    issues.push('Answer invents a skill_installer permission requirement');
  if (state.attempts.some(a => ['running','unknown'].includes(a.state)) && /(?:全部|所有).{0,8}(?:完成|成功)|all.{0,15}(?:completed|succeeded)/i.test(normalized))
    issues.push('Answer claims completion while an owned operation remains unresolved');
  if(normalized.split(/[。\n]/).some(sentence=>!/(?:未|不能|不可|不应|没有|not |no |do not |cannot ).{0,30}(?:验证|validated|guaranteed)/i.test(sentence)&&/(?:已经|已)(?:通过实验)?验证(?:性能|制冷|有效)|experimentally validated performance|guaranteed cooling performance/i.test(sentence))&&
    state.attempts.some(a=>a.method==='recipe_proposal'&&a.state==='completed'))issues.push('候选配方没有实验验证回执 / Candidate recipe has no experimental validation receipt');
  return { schemaVersion:'answer-assessment-v1',answerHash:digest(text),planRevision:state.planRevision,capabilityRevision:snapshot?.revision??0,
    knowledgeRevision:state.awareness?.knowledgeRevision??0,status:issues.length?'blocked':claims.length?'claims_verified':'needs_review',claims,
    issues:issues.slice(0,64),scope:'structured-claims-and-known-contradictions; narrative-and-scientific-validity-require-review' };
}
