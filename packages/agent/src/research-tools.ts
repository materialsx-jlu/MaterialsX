import {researchDirectToolNames} from "../../contracts/src/cloud-tool-names.js";
import {initialToolNames} from './tool-discovery.js';
import {toolMetadata} from './tool-discovery-metadata.js';
import type {Permission} from '../../contracts/src/agent.js';
/** Discovery/execution adapters share one list and one permission contract; this is not an executor. */
export const directResearchTools=new Set<string>(researchDirectToolNames);
const permissions:Record<string,readonly Permission[]>={skill_capabilities:['read'],materials_rpsme_extract:['read','patch'],research_data:['read','search'],recipe_proposal:['read'],research_delivery:['read','patch'],
  paper_search:['search','network'],paper_get:['read','network'],paper_fetch:['read','network','patch'],paper_read:['read','patch'],paper_export:['read','patch'],
  official_document:['read','network'],environment_check:['read'],environment_repair:['read','patch'],skill_draft:['patch'],skill_resource:['read','patch'],potential_discover:['search','network']};
permissions.research_subtask=['read','search'];permissions.research_browser=['read','network','patch'];
permissions.campaign_job=['read','patch','terminal','science'];
permissions.method_package_search=['read'];permissions.research_quality=['read','patch'];permissions.research_methods=['read','science'];permissions.research_method_run=['read','patch','science'];
permissions.next_experiment_data=['read'];permissions.next_experiment_design=['read','patch','science'];
permissions.experiment_data=['read'];permissions.experiment_analyze=['read','patch','science'];
export function materialToolPermissions(name:string):readonly Permission[]{return permissions[name]??(name.endsWith('_search')?['search']:['science']);}
/** Existing prerequisites may run inside their primary planned step; this never executes or completes it. */
export const methodSupportTools:Readonly<Record<string,readonly string[]>>={
  materials_science:['read_skill'],
  research_method_run:['method_package_search','research_methods','research_data'],
  research_quality:['research_data'],
  research_delivery:['research_data'],
  experiment_analyze:['experiment_data'],
  next_experiment_design:['next_experiment_data'],
};
export function supportsPlannedMethod(method:string,tool:string){
  return method===tool||method==='engine.execute'||tool==='read_skill'||(methodSupportTools[method]?.includes(tool)??false);
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
  if(!/\bMOOS\b/i.test(text)&&/materials_science|机器学习势|\bmlip\b/i.test(text)&&/弛豫|单点|relax|singlepoint/i.test(text))return false;
  if(tensileTask(text)&&!/\bMOOS\b/i.test(text))return false;
  if(/(?:@|\/skill:)materials-research-workbench\b/.test(text))return true;
  if(/(?:@|\/skill:)materials-literature-rpsme-json\b/.test(text)&&! /CSV|SVG|对照表|比较|comparison|compare/i.test(text))return false;
  return (/\bMOOS\b/i.test(text)||hasSnapshots)&&/CSV|SVG|Markdown|表格|报告|概览图|report|deliverables/i.test(text);
}

/** Compatibility view for callers without definitions. Actual dispatch ranks the live registry. */
export function initialResearchTools(request:string,methods:readonly string[]=[]):Set<string>{
 const tools=[...directResearchTools].map(name=>({name,description:toolMetadata(name)?.aliases??name}));
 return initialToolNames(tools,request,methods);
}
