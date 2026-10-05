import type {Permission} from '../../contracts/src/agent.js';
/** Discovery/execution adapters share one list and one permission contract; this is not an executor. */
export const directResearchTools=new Set(['research_subtask','research_browser','materials_science','potential_search','skill_search','read_skill','research_data','research_delivery',
  'paper_search','paper_get','paper_fetch','paper_read','paper_export','official_document','environment_check','environment_repair','materials_rpsme_extract',
  'campaign_job','method_package_search','research_quality','research_methods','research_method_run','experiment_data','experiment_analyze','next_experiment_data','next_experiment_design']);
const permissions:Record<string,readonly Permission[]>={materials_rpsme_extract:['read','patch'],research_data:['read','search'],research_delivery:['read','patch'],
  paper_search:['search','network'],paper_get:['read','network'],paper_fetch:['read','network','patch'],paper_read:['read','patch'],paper_export:['read','patch'],
  official_document:['read','network'],environment_check:['read'],environment_repair:['read','patch'],skill_draft:['patch'],potential_discover:['search','network']};
permissions.research_subtask=['read','search'];permissions.research_browser=['read','network','patch'];
permissions.campaign_job=['read','patch','terminal','science'];
permissions.method_package_search=['read'];permissions.research_quality=['read','patch'];permissions.research_methods=['read','science'];permissions.research_method_run=['read','patch','science'];
permissions.next_experiment_data=['read'];permissions.next_experiment_design=['read','patch','science'];
permissions.experiment_data=['read'];permissions.experiment_analyze=['read','patch','science'];
export function materialToolPermissions(name:string):readonly Permission[]{return permissions[name]??(name.endsWith('_search')?['search']:['science']);}
/** Existing prerequisites may run inside their primary planned step; this never executes or completes it. */
export const methodSupportTools:Readonly<Record<string,readonly string[]>>={
  research_method_run:['method_package_search','research_methods','research_data'],
  research_quality:['research_data'],
  research_delivery:['research_data'],
  experiment_analyze:['experiment_data'],
  next_experiment_design:['next_experiment_data'],
};
export function supportsPlannedMethod(method:string,tool:string){
  return method===tool||method==='engine.execute'||(methodSupportTools[method]?.includes(tool)??false);
}
export function numericReportRequest(request:string):boolean{
  return /平均|均值|统计|拟合|回归|误差|mean|average|statistic|fit|regression|error/i.test(request)&&
    !/CSV|SVG|概览图|对照表|comparison table|materials-research-workbench/i.test(request);
}
export function nextExperimentTask(request:string){return /materials-next-experiment|下一轮.*实验|实验设计|实验方案|贝叶斯优化|主动学习|next.{0,15}experiment|experimental design|\bDOE\b|bayesian optimi|active learning/i.test(request);}
export function tensileTask(request:string){return /(?:@|\/skill:)materials-tensile-analysis\b|应力.{0,3}应变|stress.{0,3}strain|tensile|拉伸|力.{0,3}位移|force.{0,3}displacement/i.test(request);}
/** A PDF path is an input location, not a request for a MOOS comparison delivery. */
export function sourceDeliveryRequested(request:string,hasSnapshots:boolean,approvedPdf?:string):boolean{
  const text=approvedPdf?request.replaceAll(approvedPdf,'[local PDF]'):request;
  if(nextExperimentTask(text))return false;
  if(tensileTask(text)&&!/\bMOOS\b/i.test(text))return false;
  if(/(?:@|\/skill:)materials-research-workbench\b/.test(text))return true;
  if(/(?:@|\/skill:)materials-literature-rpsme-json\b/.test(text)&&! /CSV|SVG|对照表|比较|comparison|compare/i.test(text))return false;
  return (/\bMOOS\b/i.test(text)||hasSnapshots)&&/CSV|SVG|Markdown|表格|报告|概览图|report|deliverables/i.test(text);
}

/** Advertise the current domain; other registered tools remain available through discovery. */
export function initialResearchTools(request:string,methods:readonly string[]=[]):Set<string>{
  const names=new Set(['skill_search','read_skill',...methods]);
  if(/子任务|分工|delegate|subtask/i.test(request))names.add('research_subtask');
  if(/浏览器|网页|截图|读图|browser|screenshot|image inspection/i.test(request))names.add('research_browser');
  if(/长期计算|跨天|后台计算|campaign|long.?running|long.?job|materials-long-compute/i.test(request))names.add('campaign_job');
  if(/方法包|method.?package|materials-method-packages/i.test(request))names.add('method_package_search');
  if(nextExperimentTask(request))for(const name of ['next_experiment_data','next_experiment_design'])names.add(name);
  if(tensileTask(request))for(const name of ['experiment_data','experiment_analyze'])names.add(name);
  if(/paper|arxiv|bibtex|论文|文献|阅读.*pdf|paper_(?:search|fetch|read|export)/i.test(request))
    for(const name of ['paper_search','paper_get','paper_fetch','paper_read','paper_export','official_document','environment_check','environment_repair','materials_rpsme_extract'])names.add(name);
  if(/rpsme|\.pdf\b/i.test(request))for(const name of ['materials_rpsme_extract','environment_check','environment_repair'])names.add(name);
  if(/moos|配方|工艺|实测|数据|csv|比较|对比|质量|统计|拟合|recipe|process|measur|data|compar|quality|summari|fit|validat/i.test(request)||numericReportRequest(request))
    for(const name of ['research_data','research_delivery','method_package_search','research_quality','research_methods','research_method_run'])names.add(name);
  if((!tensileTask(request)||/原子|晶体|势|分子|atomic|potential|crystal/i.test(request))&&/势|原子|分子|结构|弛豫|动力学|晶体|potential|atomic|molecul|structure|relax|dynamics|crystal|energy|力|能量/i.test(request))
    for(const name of ['materials_science','potential_search'])names.add(name);
  if(numericReportRequest(request)&&!methods.includes('research_delivery'))names.delete('research_delivery');
  return names;
}
