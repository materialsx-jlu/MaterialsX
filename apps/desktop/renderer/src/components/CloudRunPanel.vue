<script setup lang="ts">
import {summarizeCloudBilling} from '../utils/cloud-billing.js';
import {runStatusLabel, settlementLabel} from '../utils/run-labels.js';
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
 if(!records.length)return run.value?.task.requestCount===0?"尚未调用模型，未扣费":"用量待确认";
 if(records.some(r=>r.usage?.inputTokens==null||r.usage?.outputTokens==null))return "部分用量未知，待核对";
 return `输入 ${records.reduce((n,r)=>n+r.usage!.inputTokens!,0)} / 输出 ${records.reduce((n,r)=>n+r.usage!.outputTokens!,0)} tokens`;
});
const billing=computed(()=>{
 if(!run.value)return '';
 const {billable,charged,held,unit}=summarizeCloudBilling(run.value.task.billingMode,run.value.requests);
 if(!billable)return '技术测试不向用户收费';
 const maxCredits='maxCredits' in run.value.task.budget ? run.value.task.budget.maxCredits : undefined;
 return `已结算 ${charged} / 当前预留 ${held} ${unit}${maxCredits?`；旧任务上限 ${maxCredits}`:''}`;
});
</script>
<template>
  <details v-if="run" class="cloud-run-panel">
    <summary>
      <span class="run-heading">最近云端调用</span>
      <span class="run-state" :class="run.task.state">{{ runStatusLabel(run.task.state) }}</span>
      <span class="run-usage">{{ usage }}</span>
    </summary>
    <div class="run-content">
      <div class="run-facts">
        <span>{{ new Date(run.task.createdAt).toLocaleString('zh-CN') }}</span>
        <span>{{ run.requests.length }}{{ run.task.budget.maxRequests ? `/${run.task.budget.maxRequests}` : '（次数不限）' }} 次请求</span>
        <span>{{ billing }}</span>
      </div>
      <div class="run-id"><span>任务编号</span><code>{{ run.task.id }}</code></div>
      <p class="run-note">采购成本未确认 · 科学质量尚未验收</p>
      <div v-for="request in run.requests" :key="request.id" class="request-card">
        <div class="request-heading"><code>{{ request.id }}</code><span>{{ request.execution }} · {{ settlementLabel(request.settlement) }}</span></div>
        <div class="request-facts">
          <span>预留 {{ request.reservedCredits }}</span><span>扣减 {{ request.chargedCredits ?? '待确认' }}</span>
          <span>价格 {{ request.salesPriceVersionId ?? '未启用' }}</span>
          <span>普通输入 {{ request.usage?.uncachedInputTokens ?? '未知' }}</span><span>缓存 {{ request.usage?.cachedInputTokens ?? '未知' }}</span>
          <span>输出 {{ request.usage?.outputTokens ?? '未知' }}</span><span>推理 {{ request.usage?.reasoningTokens ?? '未知' }}</span>
          <span v-if="request.cacheDiscountApplied">缺少缓存明细，输入按优惠价结算</span>
        </div>
      </div>
    </div>
  </details>
</template>
<style scoped>
.cloud-run-panel{width:100%;max-width:820px;min-width:0;margin:0 auto 9px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--muted);font-size:11px}
summary{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;min-width:0;padding:9px 12px;cursor:pointer;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:'›';color:var(--dim);font-size:18px;line-height:12px;transition:transform .15s ease}
details[open] summary::before{transform:rotate(90deg)}
summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:9px}
.run-heading{color:var(--text);font-weight:600;white-space:nowrap}
.run-state{padding:2px 7px;border-radius:999px;background:var(--panel-3);white-space:nowrap}
.run-state.failed,.run-state.interrupted{color:var(--danger)}
.run-state.completed{color:var(--accent)}
.run-usage{min-width:0;overflow-wrap:anywhere}
.run-content{display:grid;gap:9px;min-width:0;padding:0 12px 11px;border-top:1px solid var(--line-soft)}
.run-facts,.request-facts{display:flex;flex-wrap:wrap;gap:5px 14px;padding-top:10px;line-height:1.5}
.run-facts span,.request-facts span{min-width:0;overflow-wrap:anywhere}
.run-id{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:start}
.run-id>span{white-space:nowrap;color:var(--dim)}
code{min-width:0;overflow-wrap:anywhere;word-break:break-word;color:var(--muted);font-size:10px}
.run-note{margin:0;color:var(--dim);line-height:1.5}
.request-card{min-width:0;padding:9px 10px;border:1px solid var(--line-soft);border-radius:8px;background:var(--panel-2)}
.request-heading{display:flex;flex-wrap:wrap;justify-content:space-between;gap:5px 12px}
.request-facts{padding-top:6px;color:var(--dim)}
</style>
