<script setup lang="ts">
import {computed} from 'vue';
import type {TaskExecution} from '../../../../../packages/contracts/src/task-execution.js';
import {recoveryLabels} from '../../../../../packages/contracts/src/recovery.js';
const props=withDefaults(defineProps<{state:TaskExecution;locale?:'zh'|'en'}>(),{locale:'zh'});
const t=(zh:string,en:string)=>props.locale==='zh'?zh:en;
const failures=computed(()=>props.state.attempts.filter(a=>a.failure).slice(-4));
</script>
<template>
 <details v-if="state.recovery||failures.length" class="recovery" data-testid="recovery-details">
  <summary>{{t('恢复记录','Recovery history')}} · {{state.recovery?.total??0}} {{t('次响应纠正','response corrections')}}</summary>
  <p>{{t('记录保留历史故障，不代表当前任务仍失败。纠正沿用原预算；只读查询和计划版本不能重置上限。','Historical failures do not imply the current task failed. Corrections retain the original budget; reads and revisions do not reset limits.')}}</p>
  <p v-if="state.recovery">{{recoveryLabels[state.recovery.lastFault.kind][locale]}} · {{t('当前阶段','Current stage')}} {{state.recovery.corrections}} / 2 · {{t('全任务','Total task')}} {{state.recovery.total}} / 8</p>
  <ul><li v-for="a in failures" :key="a.id"><strong>{{recoveryLabels[a.failure!.kind][locale]}}</strong> · {{a.method}}<br>
   {{t('原回执','Original receipt')}} {{a.id}}<span v-if="a.nativeReceipt?.exitCode!=null"> · {{t('退出码','Exit code')}} {{a.nativeReceipt.exitCode}}</span>
   <span v-if="a.jobIds.length"> · {{t('原作业','Original jobs')}} {{a.jobIds.join(', ')}}</span>
  </li></ul>
  <p>{{t('在途作业先查询；未知操作先核对回执。已生成的文件和来源证据不会自动删除。','Query pending jobs and reconcile unknown operations first. Existing files and source evidence are retained.')}}</p>
 </details>
</template>
<style scoped>
.recovery{margin:12px 0;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--panel-2);color:var(--text);overflow-wrap:anywhere}summary{cursor:pointer;font-weight:600}p,li{font-size:12px;line-height:1.6;color:var(--muted)}ul{padding-left:20px}strong{color:var(--text)}li{margin:8px 0}
</style>
