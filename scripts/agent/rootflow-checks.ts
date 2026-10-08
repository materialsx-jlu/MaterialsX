// Deterministic output checks shared by product and same-tool native reference.
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {readOwnedBytes} from '../../packages/atomistic/src/artifact-io.js';
import {hash} from '../../packages/atomistic/src/discovery-io.js';
import {receiptClaimData} from '../../packages/agent/src/answer-assessment.js';
import {rootflowSource as source,rootflowSourceText as dataText} from './rootflow-fixtures.js';
import type {RootflowCase} from './rootflow-cases.js';
export async function rootflowChecks(test:RootflowCase,projectPath:string,text:string,execution:any,plan:any,snapshot:any,store:any,run:any){
 const readFile=async(path:string,_encoding:string)=>(await readOwnedBytes(projectPath,path,null,1024*1024)).toString('utf8');
 const checks:Record<string,boolean>={};const toolNames:string[]=execution?.attempts.filter((a:any)=>a.state==='completed').map((a:any)=>a.method)??[];let output:unknown=null;
      if(test.kind==='advice'){checks.relevant=/水性|waterborne/i.test(text)&&/制冷|辐射|radiative/i.test(text);checks.missingConditions=/基材|膜厚|成本|条件|目标|substrate|thickness|cost|conditions?|target/i.test(text);checks.singleNativeRequest=snapshot?.requests.length===1;checks.noInterpretationRequest=!execution?.requests.some((r:any)=>r.phase==='interpret');checks.noExecutionClaim=!execution?.attempts.length;}
      if(test.kind==='inquiry'){
        checks.noToolExecution=!execution?.attempts.length;checks.singleNativeRequest=snapshot?.requests.length===1;
        checks.noOutputObligation=plan?.acceptance.requiredArtifacts.length===0;checks.noFiles=(await readdir(projectPath)).length===0;
        checks.relevant=(test.id.startsWith('file-inquiry')||'family' in test&&test.family==='file-inquiry')?/report\.json/.test(text):supportedSkillInquiry(text);
      }
      if(test.kind==='skill'){
        const r=JSON.parse(await readFile(join(projectPath,'recipe.json'),'utf8'));output=r;
        checks.skillRead=toolNames.includes('read_skill');checks.sourceRead=toolNames.includes('read_material_file');
        checks.exactWetAndSolids=r.targetWetMassG===250&&r.solidMassG===125&&r.solidMassFraction===0.5;
        checks.componentsPreserved=r.components?.length===4&&r.components.every((c:any,i:number)=>c.name===source.components[i]!.name&&c.amountG===source.components[i]!.amountG*2.5&&c.solidFraction===source.components[i]!.solidFraction);
        checks.reviewRequired=r.scientificStatus==='needs_review';checks.reportPresent=(await readFile(join(projectPath,'README.md'),'utf8')).length>30;
      }
      if(test.kind==='proposals'){
        const r=JSON.parse(await readFile(join(projectPath,'proposals.json'),'utf8'));output=r;
        checks.skillRead=toolNames.includes('read_skill');checks.sourceRead=toolNames.includes('read_material_file');
        checks.threeProposals=r.proposals?.length===3&&new Set(r.proposals.map((p:any)=>p.name)).size===3;
        checks.distinctVariants=new Set(r.proposals?.map((p:any)=>JSON.stringify(p.components?.map((c:any)=>c.proposedAmountG)))).size===3;
        checks.sourcePreserved=r.sourceSha256===hash(dataText)&&r.proposals?.every((p:any)=>p.components?.length===4&&p.components.every((c:any,i:number)=>c.name===source.components[i]!.name&&c.originalAmountG===source.components[i]!.amountG&&Number.isFinite(c.proposedAmountG)&&c.proposedAmountG>=0));
        checks.qualified=r.scientificStatus==='needs_review'&&r.proposals?.every((p:any)=>p.evidenceType==='synthetic_fixture'&&p.assumptions?.length&&p.process?.length);
        checks.reportPresent=(await readFile(join(projectPath,'proposals.md'),'utf8')).length>100;
      }
      if(test.kind==='repair'){
        const r=JSON.parse(await readFile(join(projectPath,'repaired.json'),'utf8'));output=r;checks.exactResult=r.totalWetMassG===100&&r.solidMassG===50&&r.scientificStatus==='needs_review';
        checks.originalPreserved=await readFile(join(projectPath,'source.json'),'utf8')===dataText;
        checks.failureObserved=!!execution?.attempts.some((a:any)=>a.state==='failed'||JSON.stringify(receiptClaimData(a.resultRef?store!.agentJournal.readResult(run.id,a.resultRef):null)).includes('KeyError'));
        checks.shellCompleted=toolNames.some(n=>['bash','exec_command'].includes(n));
      }
      if(test.kind==='missing'){checks.sourceRead=toolNames.includes('read_material_file');checks.missingDensity=/密度/.test(text)&&/不能|无法|不足|缺少|缺失/.test(text);checks.massFraction=/\b50(?:\.0+)?\s*(?:wt\s*)?%/.test(text.replace(/\\(?:mathrm|text)\{([^{}]*)\}/g,'$1').replace(/\\(?:[,!; ]|%)/g,m=>m.includes('%')?'%':''));}

 return {checks,output};
}

/** Capability support is distinct from whether the current inquiry authorizes an installation. */
export function supportedSkillInquiry(text:string){
 const instructions=/安装\s*Skill|Install\s+Skill/i.test(text);
 // Bounded narrative assertion, not scientific semantic qualification. Inspect direct
 // capability assertions rather than substrings inside explanations or quotations.
 const clauses=text.split(/[。！？\n；;，,]|但是|但|\bbut\b/i).map(s=>s.replace(/^[\s*#>\-]+/,'').trim());
 const subject='(?:(?:MaterialsX(?:应用|系统)?|本应用|本系统|我们|我|当前|目前)\\s*)?';
 const support=clauses.some(s=>new RegExp('^'+subject+'(?:可以|支持|能够|supports?\\s+(?:Skill\\s+)?install|can\\s+install)','i').test(s));
 const refusal=new RegExp('^'+subject+'(?:(?:不可以|不能|无法|不支持)\\s*(?:自行|自己|自动)?\\s*(?:安装|$)|(?:cannot|can\'t|does not support)\\s+(?:Skill\\s+)?install)','i');
 const denial=clauses.some(s=>refusal.test(s));
 return support&&instructions&&!denial;
}
