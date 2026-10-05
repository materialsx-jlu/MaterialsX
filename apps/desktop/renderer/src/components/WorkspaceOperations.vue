<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { ElMessage } from "element-plus";
import { Database, Play, Wrench, RefreshCw, History, Gauge, WalletCards, Download, ShieldCheck } from "@lucide/vue";
import type { WorkspaceView } from "../../../../../packages/contracts/src/desktop.js";
import { useWorkspaceStore } from "../stores/workspace";
import ResearchPlanDrawer from './ResearchPlanDrawer.vue';
import type {ResearchGoalPlan} from '../../../../../packages/contracts/src/research-goal.js';
import type {EngineSessionRef} from '../../../../../packages/contracts/src/engine-selection.js';
import ManagedEnvironmentPanel from "./ManagedEnvironmentPanel.vue";
import AgentConnectionsPanel from "./AgentConnectionsPanel.vue";
import ExecutionIdentity from "./ExecutionIdentity.vue";
import PaymentPanel from "./PaymentPanel.vue";
import CreditWalletPanel from "./CreditWalletPanel.vue";
defineProps<{ view: WorkspaceView }>();
const workspace = useWorkspaceStore();
const { connections, runs, subscription, subscriptionLoading, releaseReadiness, releaseLoading } = storeToRefs(workspace);
const researchPlan=ref<ResearchGoalPlan|null>(null),planVisible=ref(false);
const engineSession=ref<EngineSessionRef|null>(null);
async function showPlan(id:string){try{[researchPlan.value,engineSession.value]=await Promise.all([window.materialsx.getResearchPlan(id),window.materialsx.getEngineSession(id)]);if(!researchPlan.value){ElMessage.info('这条旧任务没有研究计划记录');return}planVisible.value=true}catch{ElMessage.error('无法读取研究计划')}}
const paymentWalletVersion = ref(0);
const statusTone = (status: string) => ({ ready: "ready", attention: "attention", offline: "offline" })[status] ?? "offline";

const creditPercent = computed(() => {
  const overview = subscription.value?.overview;
  if (!overview || overview.grantedCredits <= 0) return 0;
  return Math.max(0, Math.min(100, (overview.remainingCredits / overview.grantedCredits) * 100));
});

function formatCredits(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

async function activateDevelopmentPlan(planId: "pro" | "research"): Promise<void> {
  try {
    await workspace.activateDevelopmentPlan(planId);
    ElMessage.success("测试权益已启用；没有发生支付或自动续费");
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : String(cause));
  }
}

async function exportSupportBundle(): Promise<void> {
  try {
    const path = await workspace.exportSupportBundle();
    if (path) ElMessage.success(`脱敏诊断包已保存：${path}`);
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : String(cause));
  }
}

const releaseProgress = computed(() => {
  if (!releaseReadiness.value) return 0;
  const total = releaseReadiness.value.checks.length;
  return total ? Math.round((releaseReadiness.value.passed / total) * 100) : 0;
});

</script>

<template>
        <section v-if="view === 'connections'" class="catalog-view">
          <div class="page-heading">
            <div><span class="eyebrow">LOCAL RUNTIME</span><h1>数据与 MCP</h1><p>检查本地运行时、求解器和工具连接状态。</p></div>
            <button class="secondary-button" @click="workspace.refreshDiagnostics"><RefreshCw :size="15" />重新检测</button>
          </div>
          <div class="connection-list">
            <article v-for="item in connections" :key="item.id" class="connection-row">
              <div class="connection-icon"><Database v-if="item.kind === 'mcp'" :size="18" /><Play v-else-if="item.kind === 'solver'" :size="18" /><Wrench v-else :size="18" /></div>
              <div><strong>{{ item.name }}</strong><span>{{ item.detail }}</span></div>
              <span :class="['connection-status', statusTone(item.status)]"><i />{{ item.status === 'ready' ? '就绪' : item.status === 'attention' ? '需处理' : '离线' }}</span>
            </article>
          </div>
          <AgentConnectionsPanel/>
          <ManagedEnvironmentPanel/>
        </section>

        <section v-else-if="view === 'runs'" class="catalog-view">
          <div class="page-heading"><div><span class="eyebrow">RUN LEDGER</span><h1>运行记录</h1><p>本地任务状态会持久化，重启后仍可追踪。</p></div></div>
          <div v-if="runs.length" class="run-list">
            <article v-for="item in runs" :key="item.id" class="run-row">
              <button class="secondary-button" @click="showPlan(item.id)">研究计划</button>
              <div class="run-icon"><History :size="16" /></div>
              <div><strong>{{ item.label }}</strong><ExecutionIdentity :task-id="item.id" :project-id="item.projectId" locale="zh"/><span>{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</span></div>
              <span :class="item.status === 'failed' ? 'failed-badge' : 'waiting-badge'">
                {{ ({ waiting: '等待计算', waiting_model: '等待模型', running: '运行中', completed: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断', blocked: '等待条件', completed_with_limitations: '执行结束，待复核' } as const)[item.status] }}
              </span>
            </article>
          </div>
          <div v-else class="empty-list"><History :size="26" /><strong>还没有运行记录</strong><span>发送第一个研究任务后会显示在这里。</span></div>
        </section>

        <section v-else-if="view === 'subscription'" class="catalog-view subscription-view">
          <div class="page-heading">
            <div><span class="eyebrow">SUBSCRIPTION & CREDITS</span><h1>订阅与额度</h1><p>查看套餐、账期、预留和实际消耗；本地模型不消耗平台额度。</p></div>
            <button class="secondary-button" :disabled="subscriptionLoading" @click="workspace.loadSubscription">
              <RefreshCw :size="15" />刷新
            </button>
          </div>

          <div class="catalog-page-body">
            <PaymentPanel @updated="paymentWalletVersion++" />
            <CreditWalletPanel :key="paymentWalletVersion" />
          </div>
          <details><summary>M3 开发演示（独立模拟数据，不用于平台账户计费）</summary>
          <div v-if="subscription?.serviceStatus === 'offline'" class="control-plane-offline">
            <Database :size="20" />
            <div><strong>订阅控制面未启动</strong><span>开发环境运行 npm run control-plane:dev 后刷新。</span></div>
          </div>

          <template v-else-if="subscription?.overview">
            <div class="entitlement-grid">
              <article class="entitlement-card primary">
                <div class="entitlement-card-heading"><span>当前套餐</span><strong>{{ subscription.overview.plan.name }}</strong></div>
                <div class="plan-price">
                  <template v-if="subscription.overview.plan.priceFen > 0"><strong>¥{{ subscription.overview.plan.priceFen / 100 }}</strong><span>/ 测试月</span></template>
                  <strong v-else>免费</strong>
                </div>
                <p>{{ subscription.overview.subscription.renewalMode === 'manual' ? '按月手动续期 · 当前未接入真实支付' : '本地功能长期可用' }}</p>
                <span class="subscription-state">{{ subscription.overview.subscription.status }}</span>
              </article>
              <article class="entitlement-card usage">
                <div class="entitlement-card-heading"><span>平台额度</span><Gauge :size="18" /></div>
                <strong class="credit-number">{{ formatCredits(subscription.overview.remainingCredits) }}</strong>
                <span>剩余 credits</span>
                <div class="credit-track"><i :style="{ width: `${creditPercent}%` }" /></div>
                <div class="credit-breakdown">
                  <span>已用 {{ formatCredits(subscription.overview.usedCredits) }}</span>
                  <span>预留 {{ formatCredits(subscription.overview.reservedCredits) }}</span>
                </div>
              </article>
              <article class="entitlement-card period">
                <div class="entitlement-card-heading"><span>当前账期</span><WalletCards :size="18" /></div>
                <strong>{{ new Date(subscription.overview.subscription.periodEnd).toLocaleDateString('zh-CN') }}</strong>
                <p>到期日期</p>
                <small>取消或到期不会影响本地项目文件和基础导出。</small>
              </article>
            </div>

            <div class="plans-grid">
              <article v-for="plan in subscription.plans" :key="plan.id" :class="['plan-card', { current: plan.id === subscription.overview.plan.id }]">
                <span class="plan-tag">{{ plan.id === subscription.overview.plan.id ? '当前套餐' : plan.testPrice ? '测试价格' : '本地基础版' }}</span>
                <h3>{{ plan.name }}</h3>
                <strong>{{ plan.priceFen ? `¥${plan.priceFen / 100}/月` : '免费' }}</strong>
                <p>{{ plan.includedCredits ? `${formatCredits(plan.includedCredits)} 平台 credits` : '不含平台模型额度' }}</p>
                <button
                  v-if="plan.id === 'pro' || plan.id === 'research'"
                  class="secondary-button"
                  :disabled="subscriptionLoading || plan.id === subscription.overview.plan.id"
                  @click="activateDevelopmentPlan(plan.id)"
                >
                  {{ plan.id === subscription.overview.plan.id ? '已启用' : '启用开发权益' }}
                </button>
              </article>
            </div>

            <div class="ledger-panel">
              <div class="ledger-heading"><div><strong>额度账本</strong><span>追加记录，不直接修改历史</span></div><small>{{ subscription.accountId }}</small></div>
              <div v-if="subscription.ledger.length" class="ledger-rows">
                <div v-for="entry in subscription.ledger.slice().reverse().slice(0, 12)" :key="entry.id" class="ledger-row">
                  <div><strong>{{ entry.kind }}</strong><span>{{ new Date(entry.createdAt).toLocaleString('zh-CN') }}</span></div>
                  <b :class="{ debit: entry.units < 0 }">{{ entry.units > 0 ? '+' : '' }}{{ formatCredits(entry.units) }}</b>
                </div>
              </div>
              <div v-else class="empty-ledger">Community 本地模式没有平台额度记录。</div>
            </div>
          </template>
          </details>
        </section>

        <section v-else class="catalog-view release-view">
          <div class="page-heading">
            <div><span class="eyebrow">M4 RELEASE READINESS</span><h1>发布中心</h1><p>把科学质量、安全、安装交付和运维证据集中到一个发布门槛。</p></div>
            <div class="release-actions">
              <button class="secondary-button" :disabled="releaseLoading" @click="workspace.loadReleaseReadiness">
                <RefreshCw :size="15" />重新检查
              </button>
              <button class="primary-button" @click="exportSupportBundle"><Download :size="15" />导出脱敏诊断包</button>
            </div>
          </div>

          <div v-if="releaseLoading && !releaseReadiness" class="release-loading"><div class="small-loader" />正在核对发布门槛…</div>
          <template v-else-if="releaseReadiness">
            <div class="release-summary">
              <article class="release-score">
                <span>v1 发布就绪度</span>
                <strong>{{ releaseProgress }}%</strong>
                <div class="release-track"><i :style="{ width: `${releaseProgress}%` }" /></div>
                <small>v{{ releaseReadiness.version }} · {{ releaseReadiness.platform }}</small>
              </article>
              <article class="release-stat pass"><span>通过</span><strong>{{ releaseReadiness.passed }}</strong></article>
              <article class="release-stat warning"><span>提醒</span><strong>{{ releaseReadiness.warnings }}</strong></article>
              <article class="release-stat blocked"><span>阻断</span><strong>{{ releaseReadiness.blocked }}</strong></article>
            </div>

            <div class="release-notice">
              <ShieldCheck :size="19" />
              <div><strong>{{ releaseReadiness.blocked ? '当前构建不可标记为 v1 正式版' : '当前发布门槛已满足' }}</strong><span>阻断项必须有可复核证据；日期到达不会自动放行。</span></div>
            </div>

            <div class="release-checks">
              <article v-for="item in releaseReadiness.checks" :key="item.id" class="release-check">
                <span :class="['release-check-status', item.status]"><i />{{ item.status === 'pass' ? '通过' : item.status === 'warning' ? '提醒' : '阻断' }}</span>
                <div>
                  <small>{{ ({ science: '科学质量', security: '安全与隐私', delivery: '安装交付', operations: '运维恢复' } as const)[item.category] }}</small>
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.detail }}</p>
                  <em v-if="item.remediation">{{ item.remediation }}</em>
                </div>
              </article>
            </div>
          </template>
        </section>
  <ResearchPlanDrawer v-model="planVisible" :plan="researchPlan" :engine-session="engineSession" />
</template>
