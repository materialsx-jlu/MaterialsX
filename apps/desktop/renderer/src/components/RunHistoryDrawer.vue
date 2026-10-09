<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElDrawer } from 'element-plus';
import type { RunHistory } from '../../../../../packages/contracts/src/desktop.js';
import MarkdownContent from './MarkdownContent.vue';
import {summarizeCloudBilling} from '../utils/cloud-billing.js';
import {runStatusLabel, settlementLabel} from '../utils/run-labels.js';

const props = defineProps<{runId: string | null}>();
const emit = defineEmits<{close: []; conversation: [id: string]}>();
const history = ref<RunHistory | null>(null);
const busy = ref(false);
const error = ref('');
let requestVersion = 0;
async function refresh() {
  const id = props.runId;
  if (!id) return;
  const version = ++requestVersion;
  busy.value = true;
  error.value = '';
  try {
    const result = await window.materialsx.getRunHistory(id);
    if (version === requestVersion && props.runId === id) history.value = result;
  } catch (cause) {
    if (version === requestVersion) error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (version === requestVersion) busy.value = false;
  }
}
watch(() => props.runId, () => { history.value = null; if (props.runId) void refresh(); else requestVersion++; }, {immediate: true});
const roleLabel: Record<string, string> = {user:'提问',assistant:'回复',system:'状态与失败原因'};
const bills = computed(() => (history.value?.billing ?? []).map(snapshot => ({
  snapshot,
  totals: summarizeCloudBilling(snapshot.task.billingMode, snapshot.requests),
})));
</script>

<template>
  <ElDrawer class="run-history-drawer" :model-value="runId !== null" :show-close="false" size="min(900px, 100vw)" @update:model-value="emit('close')">
    <template #header>
      <div class="history-heading"><div><span class="eyebrow">RUN HISTORY</span><h2>完整运行记录</h2></div><button class="close-button" aria-label="关闭运行记录" @click="emit('close')">×</button></div>
    </template>
    <div v-if="busy && !history" class="history-note">正在读取本地会话与云端结算记录…</div>
    <p v-if="error" class="history-error" role="alert">{{ error }} <button class="secondary-button" @click="refresh">重试</button></p>
    <template v-if="history">
      <header class="history-summary"><strong>{{ history.run.label }}</strong><span>{{ runStatusLabel(history.run.status) }} · {{ new Date(history.run.createdAt).toLocaleString('zh-CN') }}</span><code>{{ history.run.id }}</code><button v-if="history.conversationId" class="secondary-button" @click="emit('conversation', history.conversationId)">打开完整会话</button></header>
      <section class="history-section"><div class="history-section-head"><h3>提问、回复与失败原因</h3><span>{{ history.messages.length }} 条</span></div>
        <div v-if="history.messages.length" class="history-messages"><article v-for="message in history.messages" :key="message.id" class="history-message" :class="message.role"><div class="history-message-meta"><strong>{{ roleLabel[message.role] }}</strong><span>{{ new Date(message.createdAt).toLocaleString('zh-CN') }} · {{ message.status === 'failed' ? '失败' : message.status === 'cancelled' ? '已停止' : '已记录' }}</span></div><p v-if="message.role !== 'assistant'" class="history-text">{{ message.content }}</p><MarkdownContent v-else-if="message.content" :content="message.content" /><p v-else class="history-text">没有返回正文。</p></article></div>
        <p v-else class="history-note">这条旧运行没有可确认关联的会话消息；任务状态仍保留。</p>
      </section>
      <section class="history-section"><div class="history-section-head"><h3>计费与扣减</h3><button class="secondary-button" :disabled="busy" @click="refresh">刷新结算</button></div>
        <p v-if="history.billingState === 'not-billed'" class="history-note">本地没有关联的云端计费任务。如这条旧运行曾发起云调用，请在运行记录的云端用量中进一步核对。</p>
        <p v-else-if="history.billingState === 'login-required'" class="history-note">需要登录产生这笔调用的 MaterialsX 账户，才能读取实际扣费与预留状态。</p>
        <p v-if="history.billingState === 'unavailable'" class="history-error" role="alert">{{ history.billingError ?? '云端结算暂时无法核对。' }} 已读取的记录显示在下方；其余金额不按 0 处理。</p>
        <article v-for="bill in bills" :key="bill.snapshot.task.id" class="history-bill">
          <div class="history-bill-head"><strong>{{ bill.snapshot.task.modelId }}</strong><span>{{ runStatusLabel(bill.snapshot.task.state) }} · {{ bill.snapshot.requests.length }} 次模型请求</span></div>
          <code>{{ bill.snapshot.task.id }}</code>
          <p v-if="!bill.totals.billable">技术测试，不收取 MX 点。</p>
          <p v-else>已确认扣减 <strong>{{ bill.totals.charged }} {{ bill.totals.unit }}</strong>；仍预留 <strong>{{ bill.totals.held }} {{ bill.totals.unit }}</strong></p>
          <div v-for="request in bill.snapshot.requests" :key="request.id" class="history-request">
            <code>{{ request.id }}</code>
            <span>{{ request.execution }} · {{ settlementLabel(request.settlement) }}</span>
            <span>实际扣减 {{ request.chargedCredits ?? '待核对' }} {{ bill.totals.unit }} · 预留 {{ request.reservedCredits }}</span>
            <span>输入 {{ request.usage?.inputTokens ?? '未知' }} / 输出 {{ request.usage?.outputTokens ?? '未知' }} tokens</span>
            <span>价格版本 {{ request.salesPriceVersionId ?? '未启用' }} · 路由 {{ request.routeVersionId }}</span>
            <span v-if="request.errorCode" class="history-error">错误代码 {{ request.errorCode }}</span>
          </div>
        </article>
      </section>
    </template>
  </ElDrawer>
</template>

<style scoped>
:global(.run-history-drawer.el-drawer){--el-drawer-bg-color:var(--panel);color:var(--text)}:global(.run-history-drawer .el-drawer__header){margin:0;padding:18px 24px;border-bottom:1px solid var(--line)}:global(.run-history-drawer .el-drawer__body){padding:20px 24px;overflow:auto}
.history-heading,.history-section-head,.history-message-meta,.history-bill-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.history-heading{width:100%}.history-heading h2{margin:4px 0 0;font-size:19px}.close-button{border:0;background:transparent;color:var(--muted);font-size:25px;cursor:pointer}.history-summary,.history-section,.history-bill,.history-message{border:1px solid var(--line);border-radius:9px;background:var(--catalog-surface)}.history-summary{display:grid;justify-items:start;gap:8px;padding:18px}.history-summary>strong{font-size:15px}.history-summary>span,.history-note,.history-section-head>span,.history-bill-head>span,.history-message-meta>span{color:var(--muted);font-size:12px}.history-summary code,.history-bill code,.history-request code{overflow-wrap:anywhere;color:var(--dim);font-size:11px}.history-section{margin-top:18px;padding:18px}.history-section-head{margin-bottom:14px}.history-section-head h3{margin:0;font-size:14px}.history-messages{display:grid;gap:10px}.history-message{padding:14px}.history-message.user{border-left:3px solid var(--accent)}.history-message.system{border-left:3px solid var(--danger)}.history-message-meta strong{font-size:12px}.history-text{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;font-size:13px}.history-error{color:var(--danger);font-size:12px;line-height:1.6}.history-bill{display:grid;gap:9px;padding:14px;margin-top:10px}.history-bill-head strong{font-size:13px}.history-bill p{margin:0;font-size:12px;line-height:1.7}.history-request{display:grid;gap:4px;padding:11px;border-top:1px solid var(--line-soft);font-size:11px;color:var(--muted)}
</style>
