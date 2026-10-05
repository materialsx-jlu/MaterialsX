import type {ResearchGoalPlan} from '../../contracts/src/research-goal.js';
export const receiptOnlyMethods=new Set(['research_methods','experiment_data','next_experiment_data']);
/** Published output contracts of existing fixed backends; never model-chosen filenames. */
export const methodArtifactRoles:Readonly<Record<string,readonly string[]>>={
  research_subtask:['子任务报告','子任务回执'],
  campaign_job:['计算 JSON','计算报告'],
  research_quality:['质量 JSON','质量报告'],
  research_method_run:['JSON','报告'],
  materials_rpsme_extract:['RPSME JSON','中文摘要','校验报告'],
  next_experiment_design:['实验方案 JSON','实验方案报告','候选表','实验顺序表','方案复算脚本'],
  experiment_analyze:['实验 JSON','实验报告','应力应变图','实验数据表','复算脚本'],
};
const requestedFile=(name:string,request:string)=>/\.(?:json|md|txt|csv|svg|pdf|png)$/i.test(name)&&request.includes(name);
export function bindArtifactRoles(steps:ResearchGoalPlan['steps'],acceptance:ResearchGoalPlan['acceptance'],request:string){
  const aliases=new Map<string,readonly string[]>();
  for(const step of steps){
    const roles=methodArtifactRoles[step.method];if(!roles)continue;
    for(const name of step.expectedArtifacts)if(!requestedFile(name,request))aliases.set(name,roles);
    // Explicit user filenames remain requirements. Never invent the backend's UUID path.
    step.expectedArtifacts=[...new Set([...roles,...step.expectedArtifacts.filter(name=>requestedFile(name,request))])];
  }
  acceptance.requiredArtifacts=[...new Set(acceptance.requiredArtifacts.flatMap(name=>{
    if(aliases.has(name))return aliases.get(name)!;
    const role=scientificArtifactRole(name);
    if(role&&steps.some(s=>s.method===(role.quality?'research_quality':'research_method_run')))
      return [role.quality?(role.extension==='.json'?'质量 JSON':'质量报告'):(role.extension==='.json'?'JSON':'报告')];
    return [name];
  }))];
}
export function scientificArtifactRole(name:string):{quality:boolean;extension:string}|null{
  const role=name.trim().toLowerCase();
  if(role==='质量 json')return {quality:true,extension:'.json'};
  if(['校验报告','质量报告','quality report'].includes(role))return {quality:true,extension:'.md'};
  if(['json','analysis json','统计 json','分析 json','结果 json','json报告'].includes(role))return {quality:false,extension:'.json'};
  if(['报告','中文报告','统计报告','分析报告','markdown报告','report','analysis report','markdown report'].includes(role))return {quality:false,extension:'.md'};
  return null;
}
