<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  ArrowRight,
  Atom,
  Bot,
  Box,
  ChevronDown,
  CircleDot,
  Database,
  Download,
  FileChartColumn,
  FilePlus2,
  FlaskConical,
  FolderOpen,
  History,
  Library,
  Gauge,
  MessageSquare,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Wrench,
  WalletCards,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { ElMessage } from "element-plus";
import MarkdownContent from "./components/MarkdownContent.vue";
import SettingsDrawer from "./components/SettingsDrawer.vue";
import SkillDetailsDrawer from "./components/SkillDetailsDrawer.vue";
import ModelDetailsDrawer from "./components/ModelDetailsDrawer.vue";
import { useWorkspaceStore } from "./stores/workspace";
import { applySkillMention, findSkillMention, type SkillMentionRange } from "./utils/skill-mention";
import type { ModelCategory, ModelSettings, ResearchModelSummary, SkillSummary, WorkspaceView } from "../../../../packages/contracts/src/desktop.js";

const workspace = useWorkspaceStore();
const {
  loading,
  sending,
  error,
  appVersion,
  platform,
  projects,
  messages,
  skills,
  models,
  connections,
  runs,
  settings,
  subscription,
  subscriptionLoading,
  releaseReadiness,
  releaseLoading,
  activeProjectId,
  activeConversationId,
  activeView,
  activeProject,
  projectConversations,
  activeConversation,
  readyConnectionCount,
} = storeToRefs(workspace);

const draft = ref("");
const search = ref("");
const skillCategory = ref("all");
const modelSearch = ref("");
const modelCategory = ref<ModelCategory | "all">("all");
const settingsVisible = ref(false);
const messageList = ref<HTMLElement | null>(null);
const composerInput = ref<HTMLTextAreaElement | null>(null);
const skillMention = ref<SkillMentionRange | null>(null);
const skillSelectionIndex = ref(0);
const selectedSkill = ref<SkillSummary | null>(null);
const selectedModel = ref<ResearchModelSummary | null>(null);
const skillLocale = ref<"zh" | "en">("zh");
const modelLocale = ref<"zh" | "en">("zh");

const skillCategories = computed(() => {
  const entries = new Map<string, { labelZh: string; labelEn: string; count: number }>();
  for (const skill of skills.value) {
    const current = entries.get(skill.category) ?? { labelZh: skill.categoryLabelZh, labelEn: skill.categoryLabelEn, count: 0 };
    current.count += 1;
    entries.set(skill.category, current);
  }
  const order = ["materials-extraction", "structure-simulation", "chemistry-molecules", "experiment-statistics", "laboratory", "machine-learning", "quantum-physics", "scientific-data", "literature-writing", "visualization", "geospatial", "resources"];
  return [...entries]
    .map(([id, value]) => ({ id, ...value }))
    .sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
});

const modelCategories: Array<{ id: ModelCategory; zh: string; en: string }> = [
  { id: "atomistic", zh: "原子尺度与势函数", en: "Atomistic potentials" },
  { id: "materials-property", zh: "材料性质预测", en: "Property prediction" },
  { id: "materials-chat", zh: "材料对话模型", en: "Materials chat" },
  { id: "materials-cif-generation", zh: "晶体结构生成", en: "Crystal generation" },
  { id: "materials-language-base", zh: "材料语言基座", en: "Materials language base" },
  { id: "materials-text", zh: "文献文本编码", en: "Literature encoders" },
];
const modelCategoryLabel = (category: ModelCategory): string => {
  const item = modelCategories.find((value) => value.id === category);
  return modelLocale.value === "zh" ? (item?.zh ?? category) : (item?.en ?? category);
};

const filteredSkills = computed(() => {
  const query = search.value.trim().toLowerCase();
  const matches = query
    ? skills.value.filter((item) =>
        `${item.name} ${item.descriptionZh} ${item.descriptionEn}`.toLowerCase().includes(query),
      )
    : skills.value;
  return matches.filter((item) => skillCategory.value === "all" || item.category === skillCategory.value);
});
const filteredModels = computed(() => {
  const query = modelSearch.value.trim().toLowerCase();
  return models.value.filter((item) =>
    (modelCategory.value === "all" || item.category === modelCategory.value) &&
    (!query || `${item.name} ${item.benchmark} ${item.descriptionZh} ${item.descriptionEn}`.toLowerCase().includes(query)),
  );
});
const readySkillsCount = computed(() => skills.value.filter((item) => item.enabled).length);
const skillSuggestions = computed(() => {
  const query = skillMention.value?.query.trim().toLowerCase() ?? "";
  return skills.value
    .filter((item) => item.enabled)
    .filter((item) => !query || `${item.name} ${item.description}`.toLowerCase().includes(query))
    .sort((left, right) => {
      const leftStarts = left.name.toLowerCase().startsWith(query) ? 0 : 1;
      const rightStarts = right.name.toLowerCase().startsWith(query) ? 0 : 1;
      return leftStarts - rightStarts || left.name.localeCompare(right.name);
    })
    .slice(0, 8);
});
const skillMenuOpen = computed(() => skillMention.value !== null);
const skillDescription = (skill: SkillSummary): string =>
  skillLocale.value === "zh" ? skill.descriptionZh : skill.descriptionEn;
const modelLabel = computed(() => (settings.value.mode === "platform" ? "平台订阅" : "本地模型"));
const statusTone = (status: string) => ({ ready: "ready", attention: "attention", offline: "offline" })[status] ?? "offline";

const nav: Array<{ id: WorkspaceView; label: string; icon: typeof MessageSquare }> = [
  { id: "chat", label: "研究任务", icon: MessageSquare },
  { id: "skills", label: "Skills", icon: Library },
  { id: "models", label: "模型目录", icon: Bot },
  { id: "connections", label: "数据与 MCP", icon: Database },
  { id: "runs", label: "运行记录", icon: History },
  { id: "subscription", label: "订阅与额度", icon: WalletCards },
  { id: "release", label: "发布中心", icon: ShieldCheck },
];

const quickTasks = [
  { icon: FileChartColumn, title: "分析实验数据", text: "导入 CSV，检查单位、重复样并生成图表" },
  { icon: FlaskConical, title: "提取论文数据", text: "从材料论文整理配方、工艺与性能证据" },
  { icon: Atom, title: "准备计算任务", text: "校验结构并准备 QE 或 LAMMPS 微型算例" },
];

async function submit(): Promise<void> {
  const content = draft.value.trim();
  if (!content || sending.value) return;
  skillMention.value = null;
  draft.value = "";
  const response = workspace.sendMessage(content);
  await nextTick();
  if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight;
  await response;
}

function useQuickTask(text: string): void {
  draft.value = text;
  skillMention.value = null;
  void nextTick(() => composerInput.value?.focus());
}

async function useSkillFromCatalog(skillName: string): Promise<void> {
  selectedSkill.value = null;
  workspace.showView("chat");
  const prefix = draft.value && !/\s$/u.test(draft.value) ? `${draft.value} ` : draft.value;
  draft.value = `${prefix}@${skillName} `;
  await nextTick();
  composerInput.value?.focus();
  composerInput.value?.setSelectionRange(draft.value.length, draft.value.length);
}

async function useSkillExample(skillName: string, prompt: string): Promise<void> {
  selectedSkill.value = null;
  workspace.showView("chat");
  skillMention.value = null;
  draft.value = `@${skillName} ${prompt}`;
  await nextTick();
  composerInput.value?.focus();
  composerInput.value?.setSelectionRange(draft.value.length, draft.value.length);
  ElMessage.success("示例已填入输入框，可继续编辑后发送");
}

async function useModelExample(prompt: string): Promise<void> {
  selectedModel.value = null;
  workspace.showView("chat");
  skillMention.value = null;
  draft.value = prompt;
  await nextTick();
  composerInput.value?.focus();
  composerInput.value?.setSelectionRange(draft.value.length, draft.value.length);
  ElMessage.info("示例已填入；目录中的模型权重尚未安装，请先确认当前推理模型可用");
}

async function openModelSource(modelId: string): Promise<void> {
  try {
    await window.materialsx.openResearchModelSource(modelId);
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : String(cause));
  }
}

function refreshSkillMention(value = draft.value, caret = composerInput.value?.selectionStart ?? value.length): void {
  skillMention.value = findSkillMention(value, caret);
  skillSelectionIndex.value = 0;
}

function handleComposerInput(event: Event): void {
  const input = event.currentTarget as HTMLTextAreaElement;
  draft.value = input.value;
  refreshSkillMention(input.value, input.selectionStart);
}

async function chooseSkill(skillName: string): Promise<void> {
  if (!skillMention.value) return;
  const result = applySkillMention(draft.value, skillMention.value, skillName);
  draft.value = result.value;
  skillMention.value = null;
  await nextTick();
  composerInput.value?.focus();
  composerInput.value?.setSelectionRange(result.caret, result.caret);
}

function handleComposerKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;

  if (skillMenuOpen.value) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = skillSuggestions.value.length;
      if (count) {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        skillSelectionIndex.value = (skillSelectionIndex.value + direction + count) % count;
      }
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && skillSuggestions.value.length) {
      event.preventDefault();
      const selected = skillSuggestions.value[skillSelectionIndex.value] ?? skillSuggestions.value[0];
      if (selected) void chooseSkill(selected.name);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      skillMention.value = null;
      return;
    }
  }

  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    event.preventDefault();
    void submit();
  }
}

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

async function saveSettings(value: ModelSettings): Promise<void> {
  try {
    await workspace.saveSettings(value);
    settingsVisible.value = false;
    ElMessage.success("模型设置已保存");
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

watch(error, (value) => {
  if (value) ElMessage.error(value);
});

watch(
  () => {
    const last = messages.value.at(-1);
    return last ? `${last.id}:${last.content.length}:${last.status}` : "";
  },
  async () => {
    const list = messageList.value;
    if (!list) return;
    const followsLatest = list.scrollHeight - list.scrollTop - list.clientHeight < 160;
    await nextTick();
    if (followsLatest) list.scrollTop = list.scrollHeight;
  },
);

onMounted(() => workspace.initialize());
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand drag-region">
        <div class="brand-mark"><Atom :size="20" /></div>
        <div><strong>MaterialsX</strong><span>RESEARCH OS</span></div>
      </div>

      <button class="new-task-button" :disabled="!activeProject" @click="workspace.createConversation">
        <Plus :size="17" /> 新建研究任务
      </button>

      <nav class="primary-nav" aria-label="主导航">
        <button
          v-for="item in nav"
          :key="item.id"
          :class="{ active: activeView === item.id }"
          @click="workspace.showView(item.id)"
        >
          <component :is="item.icon" :size="17" />
          <span>{{ item.label }}</span>
          <small v-if="item.id === 'skills'">{{ skills.length }}</small>
          <small v-if="item.id === 'models'">{{ models.length }}</small>
        </button>
      </nav>

      <div class="sidebar-section">
        <div class="sidebar-label"><span>项目</span><button aria-label="添加项目" @click="workspace.chooseProject"><Plus :size="14" /></button></div>
        <button v-if="projects.length === 0" class="empty-project" @click="workspace.chooseProject">
          <FolderOpen :size="17" /><span>选择本地项目文件夹</span>
        </button>
        <button
          v-for="project in projects"
          :key="project.id"
          :class="['project-item', { active: activeProjectId === project.id }]"
          @click="workspace.selectProject(project.id)"
        >
          <Box :size="15" />
          <span>{{ project.name }}</span>
        </button>
      </div>

      <div v-if="activeProject && projectConversations.length" class="sidebar-section conversation-section">
        <div class="sidebar-label"><span>最近会话</span></div>
        <button
          v-for="conversation in projectConversations.slice(0, 7)"
          :key="conversation.id"
          :class="['conversation-item', { active: activeConversationId === conversation.id && activeView === 'chat' }]"
          @click="workspace.selectConversation(conversation.id)"
        >
          <MessageSquare :size="14" />
          <span>{{ conversation.title }}</span>
        </button>
      </div>

      <div class="sidebar-footer">
        <button @click="settingsVisible = true"><Settings :size="17" /> 设置</button>
        <div class="runtime-mini"><span class="status-dot" />本地服务正常</div>
        <div class="copyright">© 2026 吉林大学 AI-DAOS 团队</div>
      </div>
    </aside>

    <main class="main-area">
      <header class="topbar drag-region">
        <div class="crumbs no-drag">
          <span>{{ activeProject?.name ?? 'MaterialsX' }}</span>
          <template v-if="activeConversation"><span>/</span><strong>{{ activeConversation.title }}</strong></template>
        </div>
        <div class="topbar-actions no-drag">
          <button class="model-pill" @click="settingsVisible = true">
            <Sparkles :size="14" /><span>{{ modelLabel }}</span><ChevronDown :size="13" />
          </button>
          <div class="health-pill"><span class="status-dot" />{{ readyConnectionCount }}/{{ connections.length }} 就绪</div>
        </div>
      </header>

      <div v-if="loading" class="loading-screen"><div class="loader" /><span>正在打开本地工作区…</span></div>

      <template v-else>
        <section v-if="activeView === 'chat'" class="workspace-layout">
          <div class="conversation-pane">
            <div v-if="!activeProject" class="welcome-state">
              <div class="welcome-symbol"><Atom :size="30" /></div>
              <span class="eyebrow">LOCAL MATERIALS INTELLIGENCE</span>
              <h1>把材料问题变成<br />可复现的研究结果</h1>
              <p>选择一个本地项目文件夹，MaterialsX 会在其中管理会话、输入文件、计算记录和研究产物。</p>
              <button class="primary-button large" @click="workspace.chooseProject"><FolderOpen :size="17" />选择项目文件夹</button>
              <div class="privacy-note"><CircleDot :size="13" />项目数据默认保存在这台电脑上</div>
            </div>

            <template v-else>
              <div ref="messageList" class="message-list">
                <div v-if="!activeConversation || messages.length === 0" class="task-starter">
                  <div class="starter-heading">
                    <span class="eyebrow">{{ activeProject.name }}</span>
                    <h2>今天要推进什么研究任务？</h2>
                    <p>描述目标，或从一个常用材料工作流开始。</p>
                  </div>
                  <div class="quick-grid">
                    <button v-for="item in quickTasks" :key="item.title" @click="useQuickTask(item.text)">
                      <component :is="item.icon" :size="19" />
                      <strong>{{ item.title }}</strong>
                      <span>{{ item.text }}</span>
                    </button>
                  </div>
                </div>

                <article v-for="item in messages" :key="item.id" :class="['message', item.role]">
                  <div class="message-avatar">
                    <Bot v-if="item.role !== 'user'" :size="16" />
                    <span v-else>你</span>
                  </div>
                  <div class="message-body">
                    <div class="message-meta">
                      <strong>{{ item.role === 'user' ? '你' : item.role === 'system' ? 'MaterialsX 状态' : 'MaterialsX' }}</strong>
                      <span>{{ new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</span>
                    </div>
                    <p v-if="item.role === 'user'" class="user-content">{{ item.content }}</p>
                    <MarkdownContent
                      v-else-if="item.content"
                      :content="item.content"
                      :streaming="item.status === 'streaming'"
                    />
                    <p v-else-if="item.status === 'streaming'" class="streaming-text thinking-placeholder">正在思考</p>
                    <span v-if="item.status === 'streaming'" class="streaming-badge">正在生成</span>
                    <span v-else-if="item.status === 'waiting_model'" class="waiting-badge">等待模型连接</span>
                    <span v-else-if="item.status === 'cancelled'" class="cancelled-badge">已停止</span>
                    <span v-else-if="item.status === 'failed'" class="failed-badge">调用失败</span>
                  </div>
                </article>
              </div>

              <div class="composer-wrap">
                <div class="composer">
                  <div v-if="skillMenuOpen" id="skill-mention-menu" class="skill-mention-menu" role="listbox">
                    <div class="skill-mention-header">
                      <span><Library :size="14" />选择 Skill</span>
                      <small>{{ readySkillsCount }} 项已启用</small>
                    </div>
                    <div v-if="skillSuggestions.length" class="skill-mention-options">
                      <button
                        v-for="(skill, index) in skillSuggestions"
                        :id="`skill-option-${index}`"
                        :key="skill.name"
                        type="button"
                        role="option"
                        :aria-selected="index === skillSelectionIndex"
                        :class="{ active: index === skillSelectionIndex }"
                        @mouseenter="skillSelectionIndex = index"
                        @mousedown.prevent="chooseSkill(skill.name)"
                      >
                        <span class="skill-mention-icon"><FlaskConical :size="15" /></span>
                        <span class="skill-mention-copy">
                          <strong>{{ skill.name }}</strong>
                          <small>{{ skill.descriptionZh }}</small>
                        </span>
                        <kbd v-if="index === skillSelectionIndex">Enter</kbd>
                      </button>
                    </div>
                    <div v-else class="skill-mention-empty">没有匹配的已启用 Skill</div>
                  </div>
                  <textarea
                    ref="composerInput"
                    v-model="draft"
                    rows="2"
                    placeholder="描述材料研究任务，输入 @ 可引用文件或 Skill…"
                    aria-autocomplete="list"
                    :aria-expanded="skillMenuOpen"
                    :aria-controls="skillMenuOpen ? 'skill-mention-menu' : undefined"
                    :aria-activedescendant="skillMenuOpen && skillSuggestions.length ? `skill-option-${skillSelectionIndex}` : undefined"
                    @input="handleComposerInput"
                    @click="refreshSkillMention()"
                    @blur="skillMention = null"
                    @keydown="handleComposerKeydown"
                  />
                  <div class="composer-toolbar">
                    <div>
                      <button class="tool-button" title="添加文件"><Paperclip :size="17" /></button>
                      <button class="context-chip"><Wrench :size="14" />自动选择工具</button>
                    </div>
                    <button
                      :class="['send-button', { stopping: sending }]"
                      :disabled="!draft.trim() && !sending"
                      :title="sending ? '停止生成' : '发送'"
                      @click="sending ? workspace.cancelActiveRun() : submit()"
                    >
                      <Send v-if="!sending" :size="17" /><Square v-else :size="14" />
                    </button>
                  </div>
                </div>
                <p class="composer-hint">
                  Enter 发送 · Shift+Enter 换行 ·
                  {{ settings.mode === 'local' ? `经 Pi 发送到本机 ${settings.localEndpoint}` : '平台模型尚未接通' }}
                </p>
              </div>
            </template>
          </div>

          <aside class="context-pane">
            <div class="context-header"><span>研究上下文</span><FilePlus2 :size="16" /></div>
            <section>
              <span class="context-label">项目</span>
              <div v-if="activeProject" class="project-context">
                <FolderOpen :size="17" />
                <div><strong>{{ activeProject.name }}</strong><small>{{ activeProject.path }}</small></div>
              </div>
              <p v-else class="context-empty">尚未选择项目</p>
            </section>
            <section>
              <span class="context-label">已启用能力</span>
              <div class="metric-row"><span>Skills 目录 / 就绪</span><strong>{{ skills.length }} / {{ readySkillsCount }}</strong></div>
              <div class="metric-row"><span>运行时连接</span><strong>{{ readyConnectionCount }}/{{ connections.length }}</strong></div>
              <div class="metric-row"><span>模型模式</span><strong>{{ modelLabel }}</strong></div>
            </section>
            <section>
              <span class="context-label">推荐 Skills</span>
              <button class="skill-mini"><FlaskConical :size="15" /><span>experimental-design</span></button>
              <button class="skill-mini"><FileChartColumn :size="15" /><span>scientific-visualization</span></button>
              <button class="skill-mini"><Atom :size="15" /><span>pymatgen</span></button>
            </section>
            <div class="context-footer"><span>v{{ appVersion }}</span><span>{{ platform }}</span></div>
          </aside>
        </section>

        <section v-else-if="activeView === 'skills'" class="catalog-view">
          <div class="page-heading">
            <div>
              <span class="eyebrow">CAPABILITY REGISTRY</span>
              <h1>科研 Skills</h1>
              <p>
                {{ skills.length }} 项已固定版本；{{ readySkillsCount === skills.length
                  ? '全部已内置并默认启用；部分工作流需要额外的计算库或服务。'
                  : `${readySkillsCount} 项已启用，其余需完成验收。` }}
              </p>
            </div>
            <div class="skill-page-tools">
              <div class="language-toggle compact" aria-label="目录介绍语言">
                <button :class="{ active: skillLocale === 'zh' }" @click="skillLocale = 'zh'">中文</button>
                <button :class="{ active: skillLocale === 'en' }" @click="skillLocale = 'en'">English</button>
              </div>
              <div class="search-box"><Search :size="16" /><input v-model="search" placeholder="搜索名称或中英文介绍" /></div>
            </div>
          </div>
          <div class="catalog-filters" aria-label="Skill 分类">
            <button :class="{ active: skillCategory === 'all' }" @click="skillCategory = 'all'">{{ skillLocale === 'zh' ? '全部' : 'All' }} <span>{{ skills.length }}</span></button>
            <button v-for="category in skillCategories" :key="category.id" :class="{ active: skillCategory === category.id }" @click="skillCategory = category.id">
              {{ skillLocale === 'zh' ? category.labelZh : category.labelEn }} <span>{{ category.count }}</span>
            </button>
          </div>
          <div class="catalog-grid">
            <button v-for="skill in filteredSkills" :key="skill.name" type="button" class="catalog-card" @click="selectedSkill = skill">
              <div class="catalog-icon"><FlaskConical :size="18" /></div>
              <div class="catalog-content"><strong>{{ skill.name }}</strong><p :lang="skillLocale === 'zh' ? 'zh-CN' : 'en'">{{ skillDescription(skill) }}</p><span>{{ skill.license }}</span></div>
              <ArrowRight class="catalog-open-icon" :size="15" />
              <div :class="['enabled-indicator', { reviewing: !skill.enabled }]"><span />{{ skill.enabled ? '已启用' : '验收中' }}</div>
            </button>
          </div>
        </section>

        <section v-else-if="activeView === 'models'" class="catalog-view">
          <div class="page-heading">
            <div>
              <span class="eyebrow">MATERIALS MODEL DIRECTORY</span>
              <h1>{{ modelLocale === 'zh' ? '材料模型目录' : 'Materials model directory' }}</h1>
              <p>{{ modelLocale === 'zh' ? `${models.length} 个来源可核查的目录条目；不是全网使用量排名。` : `${models.length} source-backed entries; not a worldwide usage ranking.` }}</p>
            </div>
            <div class="skill-page-tools">
              <div class="language-toggle compact" aria-label="模型介绍语言">
                <button :class="{ active: modelLocale === 'zh' }" @click="modelLocale = 'zh'">中文</button>
                <button :class="{ active: modelLocale === 'en' }" @click="modelLocale = 'en'">English</button>
              </div>
              <div class="search-box"><Search :size="16" /><input v-model="modelSearch" :placeholder="modelLocale === 'zh' ? '搜索模型与来源' : 'Search models and sources'" /></div>
            </div>
          </div>
          <div class="model-catalog-notice">{{ modelLocale === 'zh' ? '这些模型的介绍随程序内置。权重未预装，且部分评测条目没有公开权重或需要额外许可；只有已接入本地推理服务的对话模型才能在研究任务中运行。' : 'Descriptions are bundled with MaterialsX. Weights are not preinstalled; some benchmark entries have no public checkpoint or require separate access. Chat runs only with a model connected to the local inference service.' }}</div>
          <div class="catalog-filters" aria-label="模型分类">
            <button :class="{ active: modelCategory === 'all' }" @click="modelCategory = 'all'">{{ modelLocale === 'zh' ? '全部' : 'All' }} <span>{{ models.length }}</span></button>
            <button v-for="category in modelCategories" :key="category.id" :class="{ active: modelCategory === category.id }" @click="modelCategory = category.id">
              {{ modelLocale === 'zh' ? category.zh : category.en }} <span>{{ models.filter((item) => item.category === category.id).length }}</span>
            </button>
          </div>
          <div class="catalog-grid">
            <button v-for="model in filteredModels" :key="model.id" type="button" class="catalog-card" @click="selectedModel = model">
              <div class="catalog-icon"><Atom :size="18" /></div>
              <div class="catalog-content"><strong>{{ model.name }}</strong><p :lang="modelLocale === 'zh' ? 'zh-CN' : 'en'">{{ modelLocale === 'zh' ? model.descriptionZh : model.descriptionEn }}</p><span>{{ model.benchmark }}</span></div>
              <ArrowRight class="catalog-open-icon" :size="15" />
              <div class="model-catalog-status">{{ modelCategoryLabel(model.category) }} · {{ modelLocale === 'zh' ? '目录收录' : 'Catalog only' }}</div>
            </button>
          </div>
          <div v-if="filteredModels.length === 0" class="empty-list">{{ modelLocale === 'zh' ? '没有匹配的模型' : 'No matching models' }}</div>
        </section>

        <section v-else-if="activeView === 'connections'" class="catalog-view">
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
        </section>

        <section v-else-if="activeView === 'runs'" class="catalog-view">
          <div class="page-heading"><div><span class="eyebrow">RUN LEDGER</span><h1>运行记录</h1><p>本地任务状态会持久化，重启后仍可追踪。</p></div></div>
          <div v-if="runs.length" class="run-list">
            <article v-for="item in runs" :key="item.id" class="run-row">
              <div class="run-icon"><History :size="16" /></div>
              <div><strong>{{ item.label }}</strong><span>{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</span></div>
              <span :class="item.status === 'failed' ? 'failed-badge' : 'waiting-badge'">
                {{ ({ waiting_model: '等待模型', running: '运行中', completed: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断' } as const)[item.status] }}
              </span>
            </article>
          </div>
          <div v-else class="empty-list"><History :size="26" /><strong>还没有运行记录</strong><span>发送第一个研究任务后会显示在这里。</span></div>
        </section>

        <section v-else-if="activeView === 'subscription'" class="catalog-view subscription-view">
          <div class="page-heading">
            <div><span class="eyebrow">SUBSCRIPTION & CREDITS</span><h1>订阅与额度</h1><p>查看套餐、账期、预留和实际消耗；本地模型不消耗平台额度。</p></div>
            <button class="secondary-button" :disabled="subscriptionLoading" @click="workspace.loadSubscription">
              <RefreshCw :size="15" />刷新
            </button>
          </div>

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
      </template>
    </main>

    <SettingsDrawer v-model="settingsVisible" :settings="settings" @save="saveSettings" />
    <SkillDetailsDrawer
      :skill="selectedSkill"
      :locale="skillLocale"
      @close="selectedSkill = null"
      @update:locale="skillLocale = $event"
      @use="useSkillFromCatalog"
      @use-example="useSkillExample"
    />
    <ModelDetailsDrawer
      :model="selectedModel"
      :locale="modelLocale"
      @close="selectedModel = null"
      @update:locale="modelLocale = $event"
      @use-example="useModelExample"
      @open-source="openModelSource"
    />
  </div>
</template>
