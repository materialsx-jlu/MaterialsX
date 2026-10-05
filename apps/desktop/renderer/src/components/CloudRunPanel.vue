<script setup lang="ts">
import {creditSubunits,creditDisplay} from "../../../../../packages/contracts/src/platform.js";
import { computed, onUnmounted, ref, watch } from "vue";
import type { PlatformRunSnapshot } from "../../../../../packages/pi-adapter/src/platform-session.js";
const props=defineProps<{conversationId:string|null;sending:boolean}>();
const run=ref<PlatformRunSnapshot|null>(null);
let timer:ReturnType<typeof setInterval>|undefined;
async function refresh(){const id=props.conversationId;if(!id){run.value=null;return}try{const v=await window.materialsx.getCloudRun(id);if(props.conversationId===id)run.value=v}catch{run.value=null}}
watch(()=>[props.conversationId,props.sending],()=>{clearInterval(timer);void refresh();if(props.sending)timer=setInterval(()=>void refresh(),3000)},{immediate:true});
onUnmounted(()=>clearInterval(timer));
const usage=computed(()=>{
 const records=run.value?.requests??[];
 if(!records.length)return "用量待确认";
 if(records.some(r=>r.usage?.inputTokens==null||r.usage?.outputTokens==null))return "部分用量未知，待核对";
 return `输入 ${records.reduce((n,r)=>n+r.usage!.inputTokens!,0)} / 输出 ${records.reduce((n,r)=>n+r.usage!.outputTokens!,0)} tokens`;
});
const billing=computed(()=>{const records=run.value?.requests??[];if(!run.value||run.value.task.billingMode==="alpha-test")return "技术测试不向用户收费";const charge=records.filter(r=>r.chargedCredits!==null).reduce((n,r)=>n+creditSubunits(r.chargedCredits!),0n);const held=records.filter(r=>r.settlement==="reserved"||r.settlement==="reconciliation_pending").reduce((n,r)=>n+creditSubunits(r.reservedCredits),0n);return `已结算 ${creditDisplay(charge)} / 当前预留 ${creditDisplay(held)} ${run.value?.task.billingMode==="paid-credits"?"积分":"test-credit"}；任务上限 ${run.value.task.budget.maxCredits}`});
const settlement:Record<string,string>={reconciliation_pending:"保留预留，待核对",reserved:"预留中",settled:"已结算",released:"已释放",not_billed:"已记录用量，不收费"};
const label:Record<string,string>={created:"已创建",running:"执行中",completed:"已完成",cancelled:"已请求停止",interrupted:"已中断",failed:"失败"};
</script>
<template>
  <details v-if="run" class="cloud-run-panel">
    <summary>最近云端调用 · {{ label[run.task.state] }} · {{ usage }}</summary>
    <p>{{new Date(run.task.createdAt).toLocaleString('zh-CN')}} · 任务 {{ run.task.id }} · {{ run.requests.length }}/{{ run.task.budget.maxRequests }} 次请求。{{ billing }}；采购成本未确认。科学质量尚未验收。</p>
    <p v-for="request in run.requests" :key="request.id">{{ request.id }} · {{ request.execution }} · {{ settlement[request.settlement] }} · 预留 {{request.reservedCredits}} / 扣减 {{request.chargedCredits??'待确认'}} · 价格 {{request.salesPriceVersionId??'未启用'}} · 普通输入 {{request.usage?.uncachedInputTokens??'未知'}} · 输出 {{request.usage?.outputTokens??'未知'}} · 缓存 {{ request.usage?.cachedInputTokens ?? '未知' }} · 推理 {{ request.usage?.reasoningTokens ?? '未知' }}</p>
  </details>
</template>
<style scoped>
.cloud-run-panel{color:var(--dim);font-size:12px;padding:8px 10px;margin-bottom:6px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
summary{cursor:pointer}p{line-height:1.6;overflow-wrap:anywhere;margin:6px 0}
</style>
