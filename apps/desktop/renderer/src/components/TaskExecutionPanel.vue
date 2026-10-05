<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import type { TaskExecution, ExecutionEvent } from '../../../../../packages/contracts/src/task-execution.js';
const props=withDefaults(defineProps<{taskId:string;locale?:'zh'|'en';planRevision?:number}>(),{locale:'zh'});
const state=ref<TaskExecution|null>(null),events=ref<ExecutionEvent[]>([]),error=ref(''),busy=ref(false);
const t=(zh:string,en:string)=>props.locale==='zh'?zh:en;
const english:Record<string,string>={waiting:'Waiting for computation',running:'Running',pending:'Pending',completed:'Completed',completed_with_limitations:'Execution ended; review required',failed:'Failed',blocked:'Needs conditions',unknown:'Unknown receipt',stale:'Stale',cancelled:'Cancelled',interrupted:'Interrupted',handed_off:'Handed off'};
const label=(s:string)=>props.locale==='en'?english[s]??s:labels[s]??s;
const labels:Record<string,string>={waiting:'等待计算完成',running:'执行中',pending:'待执行',completed:'已完成',completed_with_limitations:'执行结束，待科学复核',failed:'失败',blocked:'等待条件',unknown:'待核对',stale:'已失效',cancelled:'已取消',interrupted:'已中断',handed_off:'已交接'};
const kind:Record<string,string>={request:'模型请求',tool:'工具',step:'步骤',plan:'计划',revision:'修订',cancel:'取消',terminal:'任务结束'};
async function refresh(){const id=props.taskId;try{const [s,e]=await Promise.all([window.materialsx.getTaskExecution(id),window.materialsx.getExecutionEvents(id)]);if(id!==props.taskId)return;state.value=s;events.value=e.slice(-20);}catch(e){error.value=String(e);}}
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
 <h3>{{t('执行记录','Execution journal')}}</h3>
 <p>{{label(state.state)}} · {{t('计划版本','Plan revision')}} {{state.planRevision}} · {{state.requests.length}} {{t('次模型请求','model requests')}} · {{state.attempts.length}} 次工具调用</p>
 <p v-if="state.waiting" class="muted">{{t('计算等待期限','Computation wait deadline')}} {{new Date(state.waiting.until).toLocaleString()}} · {{t('剩余模型执行时间','Remaining model execution time')}} {{Math.round(state.waiting.remainingActiveMs/1000)}} s</p>
 <p class="muted">{{state.reason}} · {{t('原任务截止','Original deadline')}} {{new Date(state.deadline).toLocaleTimeString()}}</p>
 <div class="steps"><div v-for="s in state.steps" :key="s.id"><strong>{{s.id}}</strong><span>{{label(s.state)}}</span><small v-if="s.reason">{{s.reason}}</small></div></div>
 <div class="actions">
 <button :disabled="busy" @click="refresh">{{t('刷新记录','Refresh')}}</button>
 <button :disabled="busy || state.state==='running'" @click="action('reconcile')">{{t('核对任务回执','Reconcile receipts')}}</button>
 <template v-if="!['running','completed_with_limitations','handed_off'].includes(state.state) && state.accountRef==='local'">
 <button :disabled="busy" @click="action('resume')">{{t('恢复原引擎','Resume original engine')}}</button>
 <button :disabled="busy" @click="action(state.engine==='pi'?'codex':'pi')">交接到 {{state.engine==='pi'?'Codex':'Pi'}}</button>
 </template>
 </div>
 <p v-if="error" role="alert">{{error}}</p>
 <details><summary>{{t('请求计时','Request timings')}}</summary><ul><li v-for="r in state.requests.slice(-8)" :key="r.id">{{r.phase}} · {{r.firstTokenAt===null?'首个片段未收到':`首个片段 ${((r.firstTokenAt-r.startedAt)/1000).toFixed(2)} 秒`}} · {{r.endedAt===null?'进行中':`耗时 ${((r.endedAt-r.startedAt)/1000).toFixed(2)} 秒`}} · {{r.compacted?'已压缩历史':'原上下文'}}</li></ul></details>
 <details><summary>{{t('最近执行事件','Recent execution events')}}</summary><ol><li v-for="e in events" :key="e.sequence">{{e.sequence}} · {{kind[e.type]}} · {{e.id}} · {{label(e.state)}}<small>{{e.detail}}</small></li></ol></details>
 <p class="muted">{{t('恢复沿用原预算。未确认的操作不会重新提交；执行完成仍需核验材料结论。','Recovery retains the original budget. Unknown operations are not resubmitted. Scientific conclusions still require review.')}}</p>
</section>
</template>
<style scoped>
.execution{color:var(--text);border:1px solid var(--line);border-radius:12px;padding:16px;overflow-wrap:anywhere;min-width:0}
h3{margin:0 0 12px}.muted,small{color:var(--muted);font-size:12px}.steps{display:grid;gap:8px}.steps>div{display:flex;flex-wrap:wrap;gap:12px;padding:8px;background:var(--panel-2);border-bottom:1px solid var(--line)}small{display:block}.steps small{flex-basis:100%}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}button{border:1px solid var(--line);background:var(--panel);color:var(--text);padding:8px 12px;border-radius:8px;cursor:pointer}button:disabled{opacity:.5;cursor:default}li{margin:8px 0}p{line-height:1.6}
</style>
