<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { ElMessage } from "element-plus";
import { Database, Play, Wrench, RefreshCw, History, Search, Download, ShieldCheck } from "@lucide/vue";
import type { ConnectionSummary, WorkspaceView } from "../../../../../packages/contracts/src/desktop.js";
import { useWorkspaceStore } from "../stores/workspace";
import ResearchPlanDrawer from './ResearchPlanDrawer.vue';
import type {ResearchGoalPlan} from '../../../../../packages/contracts/src/research-goal.js';
import type {EngineSessionRef} from '../../../../../packages/contracts/src/engine-selection.js';
import ManagedEnvironmentPanel from "./ManagedEnvironmentPanel.vue";
import AgentConnectionsPanel from "./AgentConnectionsPanel.vue";
import ExecutionIdentity from "./ExecutionIdentity.vue";
import MxPointsPanel from './MxPointsPanel.vue';
defineProps<{ view: WorkspaceView }>();
const workspace = useWorkspaceStore();
const { connections, runs, releaseReadiness, releaseLoading } = storeToRefs(workspace);
const researchPlan=ref<ResearchGoalPlan|null>(null),planVisible=ref(false);
const engineSession=ref<EngineSessionRef|null>(null);
async function showPlan(id:string){try{[researchPlan.value,engineSession.value]=await Promise.all([window.materialsx.getResearchPlan(id),window.materialsx.getEngineSession(id)]);if(!researchPlan.value){ElMessage.info('这条旧任务没有研究计划记录');return}planVisible.value=true}catch{ElMessage.error('无法读取研究计划')}}
const runQuery = ref("");
const runFilter = ref("all");
const activeStatuses = new Set(["waiting", "waiting_model", "running", "blocked"]);
const filteredRuns = computed(() => runs.value.filter(item => {
  const matchesQuery = item.label.toLocaleLowerCase().includes(runQuery.value.trim().toLocaleLowerCase());
  const matchesStatus = runFilter.value === "all"
    || (runFilter.value === "active" && activeStatuses.has(item.status))
    || (runFilter.value === "completed" && ["completed", "completed_with_limitations"].includes(item.status))
    || (runFilter.value === "stopped" && ["failed", "cancelled", "interrupted"].includes(item.status));
  return matchesQuery && matchesStatus;
}));
const runFilters = computed(() => [
  { id: "all", label: "全部", count: runs.value.length },
  { id: "active", label: "进行中 / 等待", count: runs.value.filter(r => activeStatuses.has(r.status)).length },
  { id: "completed", label: "已结束", count: runs.value.filter(r => ["completed", "completed_with_limitations"].includes(r.status)).length },
  { id: "stopped", label: "失败 / 已停止", count: runs.value.filter(r => ["failed", "cancelled", "interrupted"].includes(r.status)).length },
]);
const runStatusLabel = (status: string) => ({ waiting: '等待计算', waiting_model: '等待模型', running: '运行中', completed: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断', blocked: '等待条件', completed_with_limitations: '待复核' })[status] ?? status;
const mxPanelVersion = ref(0);
const statusTone = (status: string) => ({ ready: "ready", attention: "attention", offline: "offline" })[status] ?? "offline";
const connectionGroups = computed((): Array<{id:string;title:string;detail:string;items:ConnectionSummary[]}> => [
  {id:'data',title:'材料数据',detail:'MOOS 后端与只读 MCP 需要同时可用。',items:connections.value.filter(item=>item.id==='mcp-local')},
  {id:'billing',title:'平台账户与计费',detail:'读取 MX 点钱包、零售价和当前可用模型。',items:connections.value.filter(item=>item.id==='mx-points')},
  {id:'local',title:'本机运行环境',detail:'模型引擎、论文解析与科学计算依赖。',items:connections.value.filter(item=>item.id!=='mcp-local'&&item.id!=='mx-points')},
].filter(group=>group.items.length));

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
  const required = releaseReadiness.value.target === "v0.2-preview"
    ? releaseReadiness.value.checks.filter(item => item.status !== "warning")
    : releaseReadiness.value.checks;
  return required.length ? Math.round((required.filter(item => item.status === "pass").length / required.length) * 100) : 0;
});
const previewRelease = computed(() => releaseReadiness.value?.target === "v0.2-preview");

</script>

<template>
        <section v-if="view === 'connections'" class="catalog-view operations-view connections-view">
          <div class="page-heading">
            <div><span class="eyebrow">LOCAL RUNTIME</span><h1>数据与 MCP</h1><p>管理数据连接，检查模型引擎和论文解析环境。</p></div>
            <button class="secondary-button" @click="workspace.refreshDiagnostics"><RefreshCw :size="15" />重新检测</button>
          </div>
          <div class="catalog-page-body operations-body">
          <div class="section-heading"><h2>连接状态</h2><span>{{ connections.filter(item=>item.status==='ready').length }}/{{ connections.length }} 就绪</span></div>
          <section v-for="group in connectionGroups" :key="group.id" class="connection-group" :aria-labelledby="`connection-group-${group.id}`">
            <div class="connection-group-heading"><h3 :id="`connection-group-${group.id}`">{{group.title}}</h3><p>{{group.detail}}</p></div>
            <div class="connection-list">
              <article v-for="item in group.items" :key="item.id" class="connection-row">
                <div class="connection-icon"><Database v-if="item.kind === 'mcp'" :size="18" /><Play v-else-if="item.kind === 'solver'" :size="18" /><Wrench v-else :size="18" /></div>
                <div><strong>{{ item.name }}</strong><span>{{ item.detail }}</span></div>
                <span :class="['connection-status', statusTone(item.status)]"><i />{{ item.status === 'ready' ? '就绪' : item.status === 'attention' ? '需处理' : '离线' }}</span>
              </article>
            </div>
          </section>
          <AgentConnectionsPanel/>
          <ManagedEnvironmentPanel/>
          </div>
        </section>

        <section v-else-if="view === 'runs'" class="catalog-view operations-view runs-view">
          <div class="page-heading">
            <div><span class="eyebrow">RUN HISTORY</span><h1>运行记录</h1><p>查看任务状态、执行模型和研究计划。</p></div>
            <label class="search-box"><Search :size="16" /><input v-model="runQuery" aria-label="搜索运行记录" placeholder="搜索任务名称" /></label>
          </div>
          <div class="catalog-filters" aria-label="任务状态筛选">
            <button v-for="filter in runFilters" :key="filter.id" :class="{ active: runFilter === filter.id }" :aria-pressed="runFilter === filter.id" @click="runFilter = filter.id">{{ filter.label }}<span>{{ filter.count }}</span></button>
          </div>
          <div v-if="filteredRuns.length" class="run-list">
            <article v-for="item in filteredRuns" :key="item.id" class="run-row">
              <div class="run-icon"><History :size="18" /></div>
              <div class="run-content"><strong>{{ item.label }}</strong><ExecutionIdentity :task-id="item.id" :project-id="item.projectId" locale="zh"/><time :datetime="item.createdAt">{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</time></div>
              <span :class="['run-status', item.status]">{{ runStatusLabel(item.status) }}</span>
              <button class="secondary-button run-action" @click="showPlan(item.id)">研究计划</button>
            </article>
          </div>
          <div v-else class="empty-list"><History :size="26" /><strong>{{ runs.length ? '没有匹配的任务' : '还没有运行记录' }}</strong><span>{{ runs.length ? '试试其他关键词或状态。' : '发送研究任务后，可在这里查看进度。' }}</span></div>
        </section>

        <section v-else-if="view === 'subscription'" class="catalog-view subscription-view">
          <div class="page-heading">
            <div><span class="eyebrow">MX POINTS & BILLING</span><h1>订阅与额度</h1><p>管理 MX 点、充值订单、模型价格与实际消耗；本地模型不消耗平台额度。</p></div>
            <button class="secondary-button" @click="mxPanelVersion++"><RefreshCw :size="15" />刷新</button>
          </div>
          <div class="catalog-page-body"><MxPointsPanel :key="mxPanelVersion" /></div>
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
                <span>{{ previewRelease ? '0.2 预览版门槛' : 'v1 发布就绪度' }}</span>
                <strong>{{ releaseProgress }}%</strong>
                <div class="release-track"><i :style="{ width: `${releaseProgress}%` }" /></div>
                <small>v{{ releaseReadiness.version }} · {{ releaseReadiness.platform }}</small>
              </article>
              <article class="release-stat pass"><span>通过</span><strong>{{ releaseReadiness.passed }}</strong></article>
              <article class="release-stat warning"><span>提醒</span><strong>{{ releaseReadiness.warnings }}</strong></article>
              <article class="release-stat blocked"><span>阻断</span><strong>{{ releaseReadiness.blocked }}</strong></article>
            </div>

            <div class="release-notice" :class="{ ready: !releaseReadiness.blocked }">
              <ShieldCheck :size="19" />
              <div>
                <strong>{{ releaseReadiness.blocked ? (previewRelease ? '0.2 预览版仍有阻断项' : '当前构建不可标记为 v1 正式版') : (previewRelease ? '0.2 预览版源码门槛通过' : '当前发布门槛已满足') }}</strong>
                <span>{{ previewRelease ? '可继续打包与发行核验；提醒项不代表 v1 正式版资格。' : '阻断项必须有可复核证据；日期到达不会自动放行。' }}</span>
              </div>
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
