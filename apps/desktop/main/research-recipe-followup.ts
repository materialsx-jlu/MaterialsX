import {acceptedRecipeProposals} from './research-recipe-proposal.js';
import type {WorkspaceStore} from './store.js';
import {recipeSnapshots} from './research-recipe-view.js';
import {recipeProposalFollowup,requestedRecipeCount} from '../../../packages/agent/src/research-intent.js';
export function recipeProposalIssue(store:WorkspaceStore,taskId:string){
  const plan=store.researchPlan(taskId),binding=store.research.binding(taskId);
  if(!plan||!binding||!recipeProposalFollowup(plan.originalRequest))return null;
  if(!binding.snapshotIds.length)return 'Incomplete source retrieval: 没有本轮授权的上述配方来源；请补充来源，不能编造配方事实。';
  const read=new Set(recipeSnapshots(store,taskId).map(s=>s.id)),missing=binding.snapshotIds.filter(id=>!read.has(id));
  const proposals=acceptedRecipeProposals(store,taskId),required=requestedRecipeCount(plan.originalRequest);
  const count=proposals.length;
  return missing.length?'Incomplete source retrieval: 建议前必须读取本轮冻结的配方组分、工艺和证据。Use research_data {"action":"read_current_recipes"}. Missing snapshotIds: '+JSON.stringify(missing):count<required?'Incomplete source retrieval: 来源已读取；需用 recipe_proposal 记录 '+required+' 个具名建议，当前 '+count+' 个。Use the current recipeProposal guidance; send name, changes, preparation, checks and gaps. Do not search again or claim a draft was saved without its receipt.':null;
}
