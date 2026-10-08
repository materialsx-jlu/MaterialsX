<script setup lang="ts">
import type {TaskExecution} from '../../../../../packages/contracts/src/task-execution.js';
const props=defineProps<{state:TaskExecution;locale:'zh'|'en'}>();
const t=(zh:string,en:string)=>props.locale==='zh'?zh:en;
const status=(value:string)=>({bound:t('已绑定，按需读取','Bound; read on demand'),'metadata-only':t('仅元数据','Metadata only'),'not-authorized':t('未授权','Not authorized'),stale:t('已变更','Changed'),unreadable:t('不可读','Unreadable')}[value]??value);
</script>
<template>
 <section v-if="state.deliveryAssessment" class="delivery" data-testid="delivery-assessment">
  <strong>{{t('交付核对','Delivery check')}} · {{state.deliveryAssessment.technical==='complete'?t('已完成','Complete'):state.deliveryAssessment.technical==='partial'?t('部分交付','Partial delivery'):t('未完成','Incomplete')}}</strong>
  <p>{{t('科学结论待复核；文件与工具验收不代表实验验证。','Scientific review is pending; file and tool checks do not establish experimental validation.')}}</p>
  <p v-if="state.deliveryAssessment.verified.length">{{t('已核实','Verified')}}：{{state.deliveryAssessment.verified.join(' · ')}}</p>
  <p v-if="state.deliveryAssessment.missing.length">{{t('缺少产物','Missing outputs')}}：{{state.deliveryAssessment.missing.join(' · ')}}</p>
  <ul v-if="state.deliveryAssessment.issues.length"><li v-for="issue in state.deliveryAssessment.issues" :key="issue">{{issue}}</li></ul>
 </section>
 <details v-if="state.workingContext" data-testid="working-context">
  <summary>{{t('本轮引用与证据','Inputs and evidence')}} · {{state.workingContext.references.length}} · {{t('上下文版本','Context revision')}} {{state.workingContext.revision}}</summary>
  <p>{{t('仅引用本项目、本对话与当前账户的记录。历史回执不作为本轮完成凭证。','References belong to this project, conversation and account. Historical receipts do not complete current steps.')}}</p>
  <ul v-if="state.workingContext.ambiguities.length"><li v-for="issue in state.workingContext.ambiguities" :key="issue">{{issue}}</li></ul>
  <ul v-if="state.workingContext.notices.length"><li v-for="notice in state.workingContext.notices" :key="notice">{{notice}}</li></ul>
  <article v-for="r in state.workingContext.references" :key="r.kind+':'+r.id">
   <strong>{{r.label}}</strong><span>{{status(r.status)}}</span>
   <small>{{r.kind}} · {{r.id}} · {{r.version}}</small>
   <small>SHA-256 {{r.sha256}}</small>
   <small>{{r.range}} · {{r.exportScope==='local-only'?t('仅本地','Local only'):t('本轮批准外发','Approved export')}}</small>
   <ul v-if="r.readings.length"><li v-for="reading in r.readings" :key="reading.receiptId">{{reading.range}} · {{t('省略情况','Omissions')}}：{{reading.omitted}}</li></ul>
  </article>
  <p v-if="Object.values(state.workingContext.omitted).some(v=>v>0)">{{t('清单省略数：历史 / 引用 / 回执','Manifest omissions: history / references / receipts')}} {{state.workingContext.omitted.history}} / {{state.workingContext.omitted.references}} / {{state.workingContext.omitted.receipts}}</p>
  <p v-if="state.workingContext.history.length">{{t('关联任务','Related tasks')}}：{{state.workingContext.history.map(h=>h.taskId).join(' · ')}}</p>
  <small>{{t('上下文指纹','Context fingerprint')}}：{{state.workingContext.sha256}}</small>
 </details>
</template>
<style scoped>
.delivery,details{min-width:0;border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:12px;margin:12px 0;overflow-wrap:anywhere;color:var(--text)}
summary{cursor:pointer;font-weight:600}p,li{font-size:12px;line-height:1.6;color:var(--muted)}article{padding:10px 0;border-top:1px solid var(--line);min-width:0}span{margin-left:8px;font-size:12px;color:var(--muted)}small{display:block;color:var(--muted);font-size:11px;line-height:1.6}strong{font-size:13px}
</style>
