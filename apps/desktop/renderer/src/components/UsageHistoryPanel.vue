<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import {RefreshCw} from '@lucide/vue';
import type {z} from 'zod';
import type {mx03UsageRowsSchema} from '../../../../../packages/contracts/src/mx-v03.js';
import {mxPointDisplay, mxPointSubunits} from '../../../../../packages/contracts/src/platform.js';
import {settlementLabel} from '../utils/run-labels.js';

type UsageRow = z.infer<typeof mx03UsageRowsSchema>['items'][number];
const rows = ref<UsageRow[] | null>(null);
const busy = ref(false);
const error = ref('');
const stateFilter = ref('all');
const visibleCount = ref(20);

const stateGroups = computed(() => [
  {id: 'all', label: '全部', count: rows.value?.length ?? 0},
  {id: 'settled', label: '已结算', count: rows.value?.filter(row => row.state === 'settled').length ?? 0},
  {id: 'pending', label: '待核对 / 预留', count: rows.value?.filter(row => row.state === 'reserved' || row.state === 'reconciliation_pending').length ?? 0},
  {id: 'released', label: '已释放', count: rows.value?.filter(row => row.state === 'released').length ?? 0},
]);
const filteredRows = computed(() => (rows.value ?? []).filter(row =>
  stateFilter.value === 'all' || row.state === stateFilter.value ||
  (stateFilter.value === 'pending' && (row.state === 'reserved' || row.state === 'reconciliation_pending')),
));
const visibleRows = computed(() => filteredRows.value.slice(0, visibleCount.value));
const settledPoints = computed(() => mxPointDisplay((rows.value ?? []).reduce((total, row) =>
  total + (row.state === 'settled' && row.chargedPoints !== null ? mxPointSubunits(row.chargedPoints) : 0n), 0n)));
const heldPoints = computed(() => mxPointDisplay((rows.value ?? []).reduce((total, row) =>
  total + (row.state === 'reserved' || row.state === 'reconciliation_pending' ? mxPointSubunits(row.reservedPoints) : 0n), 0n)));
const pendingCount = computed(() => stateGroups.value.find(group => group.id === 'pending')?.count ?? 0);
const tokenCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? value.toLocaleString('zh-CN') : '待核对';

async function refresh() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const account = await window.materialsx.getAccount();
    if (account.status !== 'connected') {
      rows.value = null;
      error.value = '请先在设置中登录 MaterialsX 账户，再查看 MX 点用量。';
      return;
    }
    rows.value = (await window.materialsx.getMxUsage()).items;
    visibleCount.value = 20;
  } catch {
    rows.value = null;
    error.value = 'MX 点用量暂不可读取，请检查账户和服务连接后重试。';
  } finally {
    busy.value = false;
  }
}

function setFilter(id: string) {
  stateFilter.value = id;
  visibleCount.value = 20;
}

onMounted(() => void refresh());
</script>

<template>
  <section class="usage-history" aria-label="MX 点用量">
    <div class="usage-heading">
      <div>
        <h2>MX 点用量</h2>
        <p>查看平台模型请求的扣减与结算状态。单条任务的完整对话和失败原因可在「任务记录」中查看。</p>
      </div>
      <button class="secondary-button" :disabled="busy" @click="refresh"><RefreshCw :size="15" />{{ busy ? '正在刷新…' : '刷新用量' }}</button>
    </div>
    <p v-if="error" class="usage-error" role="status">{{ error }}</p>

    <template v-if="rows">
      <p class="usage-scope">以下汇总仅统计平台最近返回的 {{ rows.length }} 笔请求（最多 100 笔），不代表钱包累计消耗或余额。</p>
      <div class="usage-summary">
        <article><span>已结算扣减</span><strong>{{ settledPoints }} <small>MX 点</small></strong></article>
        <article><span>尚在预留</span><strong>{{ heldPoints }} <small>MX 点</small></strong></article>
        <article><span>待核对 / 预留请求</span><strong>{{ pendingCount }} <small>笔</small></strong></article>
      </div>
      <div class="usage-filter" aria-label="MX 点请求状态筛选">
        <button v-for="group in stateGroups" :key="group.id" type="button" :class="{active: stateFilter === group.id}" :aria-pressed="stateFilter === group.id" @click="setFilter(group.id)">{{ group.label }} <span>{{ group.count }}</span></button>
      </div>
      <div v-if="visibleRows.length" class="usage-list">
        <details v-for="row in visibleRows" :key="row.requestId" class="usage-row">
          <summary>
            <div class="usage-main"><strong>{{ row.modelId }}</strong><time :datetime="row.createdAt">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</time></div>
            <div class="usage-amount"><span>{{ row.chargedPoints === null ? '扣减待核对' : `${row.chargedPoints} MX 点` }}</span><small>预留 {{ row.reservedPoints }} 点</small></div>
            <span class="usage-state" :class="row.state">{{ settlementLabel(row.state) }}</span>
            <span class="usage-disclosure" aria-hidden="true">⌄</span>
          </summary>
          <div class="usage-row-detail">
            <div><span>请求编号</span><code>{{ row.requestId }}</code></div>
            <div><span>任务编号</span><code>{{ row.taskId ?? '未关联' }}</code></div>
            <div><span>普通输入 / 输出</span><strong>{{ tokenCount(row.usage?.inputTokens) }} / {{ tokenCount(row.usage?.outputTokens) }} Token</strong></div>
            <div><span>缓存读取 / 写入</span><strong>{{ tokenCount(row.usage?.cacheReadTokens) }} / {{ tokenCount(row.usage?.cacheCreateTokens) }} Token</strong></div>
            <div><span>路由版本</span><code>{{ row.routeVersionId }}</code></div>
            <div><span>价格版本</span><code>{{ row.retailPriceVersionId }}</code></div>
            <div><span>用量证据</span><code>{{ row.usageEvidenceRef ?? '待核对' }}</code></div>
          </div>
        </details>
      </div>
      <p v-else class="usage-empty">{{ rows.length ? '这个状态下暂无请求。' : '暂无 MX 点计费请求。' }}</p>
      <button v-if="filteredRows.length > visibleCount" class="secondary-button usage-more" @click="visibleCount += 20">加载更多（剩余 {{ filteredRows.length - visibleCount }} 笔）</button>
    </template>
  </section>
</template>

<style scoped>
.usage-history { display: grid; gap: 16px; width: 100%; max-width: 1120px; min-width: 0; margin: 0 auto 28px; }
.usage-heading { display: flex; align-items: start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.usage-heading h2 { margin: 0 0 5px; font-size: 16px; font-weight: 600; }
.usage-heading p, .usage-scope { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.7; }
.usage-heading button { display: inline-flex; align-items: center; gap: 6px; }
.usage-scope { padding: 10px 13px; border: 1px solid var(--line); border-radius: 9px; background: var(--panel-2); }
.usage-error { margin: 0; padding: 12px 14px; border: 1px solid var(--danger-border); border-radius: 9px; background: var(--danger-bg); color: var(--danger); font-size: 12px; }
.usage-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.usage-summary article { display: grid; align-content: center; gap: 8px; min-height: 88px; padding: 15px 17px; border: 1px solid var(--line); border-radius: 9px; background: var(--catalog-surface); }
.usage-summary article > span { color: var(--muted); font-size: 11px; }
.usage-summary strong { overflow-wrap: anywhere; font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.usage-summary small { color: var(--muted); font-size: 11px; font-weight: 400; }
.usage-filter { display: flex; flex-wrap: wrap; gap: 7px; }
.usage-filter button { min-height: 31px; padding: 0 11px; border: 1px solid var(--line); border-radius: 17px; background: var(--catalog-surface); color: var(--muted); font-size: 11px; cursor: pointer; }
.usage-filter button.active { border-color: var(--accent); background: var(--accent-bg); color: var(--accent-strong); }
.usage-filter span { margin-left: 4px; color: var(--dim); font-size: 10px; }
.usage-list { overflow: hidden; border: 1px solid var(--line); border-radius: 9px; background: var(--catalog-surface); }
.usage-row + .usage-row { border-top: 1px solid var(--line-soft); }
.usage-row summary { display: grid; grid-template-columns: minmax(0, 1fr) minmax(140px, auto) auto 16px; align-items: center; gap: 18px; padding: 16px 18px; cursor: pointer; list-style: none; }
.usage-row summary::-webkit-details-marker { display: none; }
.usage-row summary:hover { background: var(--panel-2); }
.usage-main, .usage-amount { display: grid; gap: 5px; min-width: 0; }
.usage-main strong { overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; }
.usage-main time, .usage-amount small { color: var(--dim); font-size: 11px; }
.usage-amount { text-align: right; font-variant-numeric: tabular-nums; }
.usage-amount span { font-size: 12px; font-weight: 600; }
.usage-state { padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); font-size: 11px; white-space: nowrap; }
.usage-state.settled { color: var(--accent); }
.usage-state.reconciliation_pending, .usage-state.reserved { color: var(--warn); }
.usage-disclosure { color: var(--dim); font-size: 16px; transition: transform .15s; }
.usage-row[open] .usage-disclosure { transform: rotate(180deg); }
.usage-row-detail { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 22px; padding: 16px 18px 18px; border-top: 1px solid var(--line-soft); background: var(--panel-2); }
.usage-row-detail > div { display: grid; gap: 4px; min-width: 0; }
.usage-row-detail span { color: var(--muted); font-size: 11px; }
.usage-row-detail strong, .usage-row-detail code { overflow-wrap: anywhere; font-size: 11px; font-weight: 500; }
.usage-empty { margin: 0; padding: 42px 18px; border: 1px dashed var(--line); border-radius: 9px; color: var(--muted); font-size: 12px; text-align: center; }
.usage-more { justify-self: center; }
@media (max-width: 700px) {
  .usage-summary { grid-template-columns: minmax(0, 1fr); }
  .usage-row summary { grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 14px; }
  .usage-amount { grid-column: 1; text-align: left; }
  .usage-state { grid-column: 2; grid-row: 1; }
  .usage-disclosure { grid-column: 2; grid-row: 2; justify-self: end; }
  .usage-row-detail { grid-template-columns: minmax(0, 1fr); padding: 14px; }
}
</style>
