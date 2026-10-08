<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';
import WorkingContextDetails from './WorkingContextDetails.vue';
import RecoveryDetails from './RecoveryDetails.vue';
import type { TaskExecution, ExecutionEvent } from '../../../../../packages/contracts/src/task-execution.js';
const props=withDefaults(defineProps<{taskId:string;locale?:'zh'|'en';planRevision?:number}>(),{locale:'zh'});
const state=ref<TaskExecution|null>(null),events=ref<ExecutionEvent[]>([]),error=ref(''),busy=ref(false),loading=ref(false);
const exhausted=computed(()=>state.value?.recovery?.lastFault.kind==='budget' &&
 (state.value.recovery.corrections>=2||state.value.recovery.total>=8||state.value.attempts.filter(a=>a.errorFingerprint!==null).length>=3));
const t=(zh:string,en:string)=>props.locale==='zh'?zh:en;
const english:Record<string,string>={waiting:'Waiting for computation',running:'Running',pending:'Pending',completed:'Completed',completed_with_limitations:'Execution complete',failed:'Failed',blocked:'Needs conditions',unknown:'Unknown receipt',stale:'Stale',cancelled:'Cancelled',interrupted:'Interrupted',handed_off:'Handed off'};
const label=(s:string)=>props.locale==='en'?english[s]??s:labels[s]??s;
const labels:Record<string,string>={waiting:'等待计算完成',running:'执行中',pending:'待执行',completed:'已完成',completed_with_limitations:'执行完成',failed:'失败',blocked:'等待条件',unknown:'待核对',stale:'已失效',cancelled:'已取消',interrupted:'已中断',handed_off:'已交接'};
const kind:Record<string,string>={request:'模型请求',tool:'工具',step:'步骤',plan:'计划',revision:'修订',cancel:'取消',terminal:'任务结束'};
async function refresh(){const id=props.taskId;loading.value=true;try{const [s,e]=await Promise.all([window.materialsx.getTaskExecution(id),window.materialsx.getExecutionEvents(id)]);if(id!==props.taskId)return;state.value=s;events.value=e.slice(-20);error.value='';}catch(e){if(id===props.taskId)error.value=e instanceof Error?e.message:String(e);}finally{if(id===props.taskId)loading.value=false;}}
async function action(which:'reconcile'|'resume'|'pi'|'codex'){
 busy.value=true;error.value='';try{
 if(which==='reconcile')await window.materialsx.reconcileAgentTask(props.taskId);
 else if(which==='resume')await window.materialsx.resumeAgentTask(props.taskId);
 else await window.materialsx.handoffAgentTask(props.taskId,which);
 }catch(e){error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;await refresh();}
}
watch(()=>[props.taskId,props.planRevision],()=>{state.value=null;events.value=[];error.value='';void refresh();},{immediate:true});
const timer=setInterval(()=>{if(state.value?.state==='running')void refresh();},1500);onUnmounted(()=>clearInterval(timer));
</script>
<template>
<section v-if="state" class="execution" data-testid="task-execution">
 <header class="execution-heading"><div><span class="eyebrow">{{t('本次运行','Current run')}}</span>
   <h3>{{t('执行状态','Execution status')}}</h3></div>
   <span class="state-badge" :data-state="state.state">{{label(state.state)}}</span></header>
 <p v-if="state.reason" class="state-reason">{{state.reason}}</p>
 <div class="run-stats">
   <div><span>{{t('模型请求','Model requests')}}</span><strong>{{state.requests.length}}</strong></div>
   <div><span>{{t('工具调用','Tool calls')}}</span><strong>{{state.attempts.length}}</strong></div>
   <div><span>{{t('计划版本','Plan revision')}}</span><strong>{{state.planRevision}}</strong></div>
 </div>
 <p v-if="state.waiting" class="wait-note">{{t('计算等待至','Computation wait until')}} {{new Date(state.waiting.until).toLocaleString()}} · {{t('剩余执行时间','Remaining execution time')}} {{Math.round(state.waiting.remainingActiveMs/1000)}} s</p>
 <RecoveryDetails :state="state" :locale="locale"/>
 <WorkingContextDetails :state="state" :locale="locale"/>
 <div v-if="state.answerAssessment" class="answer-check" data-testid="answer-assessment">
  <strong>{{t('回答核对','Answer check')}}</strong>
  <span>{{state.answerAssessment.status==='blocked'?t('与证据冲突','Conflicts with evidence'):state.answerAssessment.status==='claims_verified'?t('事实声明已核对','Declared facts checked'):t('待复核','Review required')}}</span>
  <p class="muted">{{t('事实核对不代表科学结论已验证。','Checking declared facts does not validate scientific conclusions.')}}</p>
  <ul v-if="state.answerAssessment.issues.length"><li v-for="issue in state.answerAssessment.issues" :key="issue">{{issue}}</li></ul>
 </div>
 <div v-if="state.steps.length" class="step-status"><h4>{{t('步骤进度','Step progress')}}</h4>
   <div class="steps"><div v-for="s in state.steps" :key="s.id"><strong>{{s.id}}</strong><span>{{label(s.state)}}</span><small v-if="s.reason">{{s.reason}}</small></div></div>
 </div>
 <div class="actions">
 <button type="button" :disabled="busy" @click="refresh">{{t('刷新状态','Refresh')}}</button>
 <button type="button" :disabled="busy || state.state==='running'" @click="action('reconcile')">{{t('核对回执','Reconcile receipts')}}</button>
 <template v-if="!['running','completed_with_limitations','handed_off'].includes(state.state) && state.accountRef==='local'">
 <button type="button" :disabled="busy||exhausted" @click="action('resume')">{{t('恢复原引擎','Resume original engine')}}</button>
 <button type="button" :disabled="busy||exhausted" @click="action(state.engine==='pi'?'codex':'pi')">{{t('交接到','Handoff to')}} {{state.engine==='pi'?'Codex':'Pi'}}</button>
 </template>
 </div>
 <p v-if="exhausted" role="status">{{t('本任务的恢复次数已用尽。请查看原回执与产物；恢复或交接不会重置预算。','This task reached its recovery limit. Review the original receipts and outputs; resume and handoff do not reset the budget.')}}</p>
 <p v-if="error" role="alert">{{error}}</p>
 <details><summary>{{t('运行详情','Run details')}}</summary>
   <p class="muted">{{t('任务截止','Task deadline')}} {{new Date(state.deadline).toLocaleString()}}</p>
   <p v-if="state.awareness" class="muted">{{t('能力状态版本','Capability revision')}} {{state.awareness.capabilities?.revision??0}} · {{t('事实版本','Fact revision')}} {{state.awareness.knowledgeRevision}}</p>
   <p class="muted">{{t('恢复沿用原预算。待核对的操作不会自动重试。','Recovery uses the original budget. Unconfirmed operations are not retried automatically.')}}</p>
 </details>
 <details><summary>{{t('请求计时','Request timings')}}</summary><ul><li v-for="r in state.requests.slice(-8)" :key="r.id">{{r.phase}} · {{r.firstTokenAt===null?t('尚未收到首个片段','No first response yet'):t('首个片段','First response')+' '+((r.firstTokenAt-r.startedAt)/1000).toFixed(2)+' s'}} · {{r.endedAt===null?t('进行中','In progress'):t('耗时','Duration')+' '+((r.endedAt-r.startedAt)/1000).toFixed(2)+' s'}}</li></ul></details>
 <details><summary>{{t('最近执行事件','Recent execution events')}}</summary><ol><li v-for="e in events" :key="e.sequence">{{e.sequence}} · {{props.locale==='zh'?(kind[e.type]??e.type):e.type}} · {{e.id}} · {{label(e.state)}}<small>{{e.detail}}</small></li></ol></details>
</section>
<section v-else class="execution empty-execution" role="status">
 <strong>{{loading?t('正在读取执行记录…','Loading execution record…'):t('暂无执行记录','No execution record')}}</strong>
 <p v-if="error" role="alert">{{error}}</p>
</section>
</template>
<style scoped>
.empty-execution{color:var(--muted)}.empty-execution strong{font-size:13px}.empty-execution p{margin:8px 0 0}
.execution{min-width:0;padding:20px 22px;border:1px solid var(--line);border-radius:14px;background:var(--catalog-surface);color:var(--text);font-size:12px;line-height:1.65;overflow-wrap:anywhere}.execution *{box-sizing:border-box}.execution-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.eyebrow{color:var(--muted);font-size:11px;font-weight:650}.execution h3{margin:3px 0 0;font-size:15px}.state-badge{padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--muted);font-size:11px;font-weight:650}.state-badge[data-state="failed"]{color:var(--danger)}.state-badge[data-state="blocked"]{color:var(--warn)}.state-badge[data-state="completed"]{color:var(--accent)}.state-reason{margin:14px 0;color:var(--text);font-size:13px}.muted,small{color:var(--muted);font-size:11px}.run-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:16px 0}.run-stats>div{display:grid;gap:3px;padding:12px;border:1px solid var(--line-soft);border-radius:9px;background:var(--panel)}.run-stats span{color:var(--muted);font-size:11px}.run-stats strong{font-size:18px;font-variant-numeric:tabular-nums}.wait-note,.answer-check{padding:12px 14px;border:1px solid var(--line);border-radius:9px;background:var(--panel)}.answer-check{margin:14px 0}.answer-check span{margin-left:8px;color:var(--muted)}.answer-check p{margin:5px 0 0}.step-status h4{margin:18px 0 8px;font-size:12px}.steps{display:grid;gap:7px}.steps>div{display:flex;flex-wrap:wrap;gap:8px 12px;padding:10px 12px;border:1px solid var(--line-soft);border-radius:8px;background:var(--panel)}.steps span{margin-left:auto;color:var(--muted)}.steps small{flex-basis:100%}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.actions button{border:1px solid var(--line);background:var(--panel);color:var(--text);padding:8px 11px;border-radius:8px;font:inherit;font-size:12px;cursor:pointer}.actions button:hover:not(:disabled){background:var(--panel-2)}.actions button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.actions button:disabled{opacity:.5;cursor:default}details{padding:11px 0;border-top:1px solid var(--line-soft)}summary{cursor:pointer;font-size:12px;font-weight:600}li{margin:7px 0}ol,ul{padding-left:20px}[role="alert"]{color:var(--danger)}@media(max-width:650px){.execution{padding:16px}.run-stats{gap:6px}.run-stats>div{padding:9px}}
</style>
