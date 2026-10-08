<script setup lang="ts">
import ComposerReferencePreview from './components/ComposerReferencePreview.vue';
import {useComposerReferences} from './utils/use-composer-references';
import ExecutionIdentity from "./components/ExecutionIdentity.vue";
import ResearchMessageArtifacts from "./components/ResearchMessageArtifacts.vue";
import ResearchWorkspace from "./components/ResearchWorkspace.vue";
import WorkspaceCatalog from "./components/WorkspaceCatalog.vue";
import WorkspaceOperations from "./components/WorkspaceOperations.vue";
import PlatformCenter from "./components/PlatformCenter.vue";
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import type { CatalogFilters } from "./utils/catalog-filters";
import {
  Atom,
  Bot,
  Box,
  ChevronDown,
  CircleDot,
  Database,
  FileChartColumn,
  FilePlus2,
  FlaskConical,
  FolderOpen,
  History,
  Library,
  Gauge,
  MessageSquare,
  Paperclip,
  Plus,
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
import MessageCopyButton from "./components/MessageCopyButton.vue";
import CloudRunPanel from "./components/CloudRunPanel.vue";
import ResearchTaskStarter from "./components/ResearchTaskStarter.vue";
import SettingsDrawer from "./components/SettingsDrawer.vue";
import { openAtomicView } from "./utils/atomic-viewer";
import SkillDetailsDrawer from "./components/SkillDetailsDrawer.vue";
import ModelDetailsDrawer from "./components/ModelDetailsDrawer.vue";
import AtomicTrajectoryDrawer from "./components/AtomicTrajectoryDrawer.vue";
import AtomicComparisonDrawer from "./components/AtomicComparisonDrawer.vue";
import AtomicViewerDrawer from "./components/AtomicViewerDrawer.vue";
import AtomisticMessageArtifacts from "./components/AtomisticMessageArtifacts.vue";
import { useWorkspaceStore } from "./stores/workspace";
import { applySkillMention, findSkillMention, type SkillMentionRange } from "./utils/skill-mention";
import type { ModelSettings, ResearchModelSummary, SkillSummary, WorkspaceView } from "../../../../packages/contracts/src/desktop.js";
import brandLogo from '../../../../assets/brand/materialsx-atom-depth-512.png';

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
  potentialCatalog,
  connections,
  settings,
  activeProjectId,
  activeConversationId,
  activeView,
  activeProject,
  projectConversations,
  activeConversation,
  readyConnectionCount,
} = storeToRefs(workspace);

const draft = ref("");
const scientificScope=ref<import("../../../../packages/contracts/src/atomistic-dynamics.js").ScientificScope|null>(null);
async function refreshScientificScope(){const id=activeConversationId.value;scientificScope.value=id?await window.materialsx.getScientificScope(id):null;}
async function clearScientificScope(){if(activeConversationId.value){await window.materialsx.clearScientificScope(activeConversationId.value);scientificScope.value=null;}}
watch([activeConversationId,activeView],()=>void refreshScientificScope());
const removeAtomicViewListener=window.materialsx.onAtomicViewRequest(request=>{if(request.projectId===activeProjectId.value)openAtomicView(request);});
onUnmounted(removeAtomicViewListener);
const userSkillDraft=ref<Parameters<typeof window.materialsx.saveUserSkill>[0]|null>(null);
const removeUserSkillListener=window.materialsx.onUserSkillDraft(draft=>{userSkillDraft.value=draft;activeView.value="skills";});
onUnmounted(removeUserSkillListener);
const removeSkillsChangedListener=window.materialsx.onSkillsChanged(()=>{void workspace.refreshSkills().catch(()=>{});});
onUnmounted(removeSkillsChangedListener);
const removeCatalogListener=window.materialsx.onPotentialCatalogChanged(()=>{void window.materialsx.getPotentialCatalog().then(c=>{potentialCatalog.value=c;window.dispatchEvent(new Event("materialsx:packages-changed"));}).catch(()=>{});});
onUnmounted(removeCatalogListener);
const cloudAttachments=ref<Array<{id:string;name:string;sha256:string;bytes:number;totalLines:number;format:string;pageCount:number|null;ocrUnverifiedPages:number[]}>>([]);
const attachmentsBusy=ref(false);
watch(activeConversationId,async id=>{cloudAttachments.value=[];if(id){const files=await window.materialsx.listCloudFiles(id);if(activeConversationId.value===id)cloudAttachments.value=files}});
async function chooseCloudFiles(){
 if(!activeProjectId.value||attachmentsBusy.value)return;
 if(!activeConversationId.value)await workspace.createConversation();
 if(!activeConversationId.value)return;
 attachmentsBusy.value=true;
 try{cloudAttachments.value=await window.materialsx.chooseCloudFiles(activeProjectId.value,activeConversationId.value)}catch(e){ElMessage.error(e instanceof Error?e.message:String(e))}
 finally{attachmentsBusy.value=false}
}
async function clearCloudFiles(){if(activeConversationId.value){await window.materialsx.clearCloudFiles(activeConversationId.value);cloudAttachments.value=[]}}

const modelDirectoryMode = ref<"research" | "potentials">("research");
const catalogFilters = reactive<CatalogFilters>({ search: "", skillCategory: "all", modelSearch: "", modelCategory: "all" });
const settingsVisible = ref(false);
const messageList = ref<HTMLElement | null>(null);
const composerInput = ref<HTMLTextAreaElement | null>(null);
const skillMention = ref<SkillMentionRange | null>(null);
const skillSelectionIndex = ref(0);
function openPlatformSkill(skill:SkillSummary,locale:"zh"|"en"){selectedSkill.value=skill;skillLocale.value=locale}
function openPlatformModel(model:ResearchModelSummary,locale:"zh"|"en"){selectedModel.value=model;modelLocale.value=locale}
const selectedSkill = ref<SkillSummary | null>(null);
const selectedModel = ref<ResearchModelSummary | null>(null);
const skillLocale = ref<"zh" | "en">("zh");
const modelLocale = ref<"zh" | "en">("zh");

const readySkillsCount = computed(() => skills.value.filter((item) => item.enabled).length);
const {skillSuggestions,boundReferences,refreshReferences}=useComposerReferences(skills,activeProjectId,activeConversationId,cloudAttachments,draft,skillMention);
const skillMenuOpen = computed(() => skillMention.value !== null);
const modelLabel = computed(() => settings.value.mode === "platform" ? `平台模型 · ${settings.value.modelId}` : "本地模型");

const nav: Array<{ id: WorkspaceView; label: string; icon: typeof MessageSquare }> = [
  { id: "chat", label: "研究任务", icon: MessageSquare },
  { id: "skills", label: "Skills", icon: Library },
  { id: "models", label: "模型目录", icon: Bot },
  { id: "connections", label: "数据与 MCP", icon: Database },
  { id: "research", label: "研究数据与交付", icon: Database },
  { id: "runs", label: "运行记录", icon: History },
  { id: "platform", label: "云服务中心", icon: Gauge },
  { id: "subscription", label: "订阅与额度", icon: WalletCards },
  { id: "release", label: "发布中心", icon: ShieldCheck },
];

async function submit(): Promise<void> {
  if(attachmentsBusy.value){ElMessage.info('附件正在本机解析，请稍候');return;}
  const content = draft.value.trim();
  if(!content)return;
  if(sending.value){try{await window.materialsx.steerRun(activeConversationId.value!,content);draft.value="";ElMessage.success("补充内容已发送到当前任务")}catch(cause){ElMessage.error(cause instanceof Error?cause.message:"当前任务不支持持续输入")}return;}
  skillMention.value = null;
  draft.value = "";
  const response = workspace.sendMessage(content);
  await nextTick();
  if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight;
  const accepted = await response;
  if(!accepted && !draft.value){draft.value=content;await nextTick();composerInput.value?.focus();}
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
  if(activeProjectId.value&&!activeConversationId.value)await workspace.createConversation();
  workspace.showView("chat");
  skillMention.value = null;
  draft.value = `@${skillName} ${prompt}`;
  await nextTick();
  composerInput.value?.focus();
  composerInput.value?.setSelectionRange(draft.value.length, draft.value.length);
  ElMessage.success("示例已填入输入框，可继续编辑后发送");
}

const preparingSilicon=ref(false);
async function trySiliconAnalysis():Promise<void>{
 if(preparingSilicon.value)return;const projectId=activeProjectId.value;if(!projectId){ElMessage.info('请先打开或创建项目');return;}preparingSilicon.value=true;
 try{
  if(!activeConversationId.value)await workspace.createConversation();const conversationId=activeConversationId.value;if(!conversationId)throw Error('没有可用对话');
  const structure=await window.materialsx.importAtomicSample({projectId,sampleId:'si-diamond'});
  const options={optimizer:'FIRE' as const,cellMode:'fixed' as const,cellConstraint:'none' as const,externalPressureGPa:null,maxSteps:3,fmaxEvPerAngstrom:.05};
  await window.materialsx.setScientificScope({projectId,conversationId,structureId:structure.id,domain:'inorganic-crystals',mode:'exploratory',interaction:'short-range',permission:'relaxation',options});
  await window.materialsx.setPotentialAnalysisScope({projectId,conversationId,structureId:structure.id,maxDownloadBytes:200*1048576,maxSteps:3,permission:'relaxation'});
  const zh=`请分析已导入的 8 原子硅晶体（结构 ID：${structure.id}）。根据元素、周期性、任务和本机资源选择合适的机器学习势，优先使用已安装的模型。执行最多 3 步固定晶胞弛豫，说明选势理由，输出能量、原子受力、是否收敛、中文报告和 3D 结构。通过 materials_science 的 auto_plan、auto_run、auto_get 完成任务，只引用实际计算结果；这是探索性计算。`;
  const en=`Analyze the imported 8-atom silicon crystal (structure ID: ${structure.id}). Choose a potential using elements, periodicity, the task and local resources; prefer an installed model. Relax at fixed cell for up to 3 steps. Explain the selection and report energy, forces, convergence, an English report and a 3D structure. Complete materials_science auto_plan, auto_run and auto_get, citing only actual results. This is an exploratory calculation.`;
  await useModelExample(modelLocale.value==='zh'?zh:en);await refreshScientificScope();
 }catch(e){ElMessage.error(e instanceof Error?e.message:String(e));}finally{preparingSilicon.value=false;}
}

async function useModelExample(prompt: string): Promise<void> {
  selectedModel.value = null;
  workspace.showView("chat");
  skillMention.value = null;
  draft.value = prompt;
  await nextTick();
  composerInput.value?.focus();
  composerInput.value?.setSelectionRange(draft.value.length, draft.value.length);
  ElMessage.info("示例已填入；请检查当前模型连接及该任务的运行前置条件");
}

async function openModelSource(modelId: string): Promise<void> {
  try {
    await window.materialsx.openResearchModelSource(modelId);
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : String(cause));
  }
}

function refreshSkillMention(value = draft.value, caret = composerInput.value?.selectionStart ?? value.length): void {
  const opening=!skillMention.value;
  skillMention.value = findSkillMention(value, caret);
  skillSelectionIndex.value = 0;
  if(opening&&skillMention.value)void refreshReferences();
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

async function saveSettings(value: ModelSettings): Promise<void> {
  try {
    await workspace.saveSettings(value);
    settingsVisible.value = false;
    ElMessage.success("模型设置已保存");
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : String(cause));
  }
}

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
        <div class="brand-mark"><img :src="brandLogo" alt="" /></div>
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
            <Sparkles :size="14" /><span>{{ modelLabel }} · {{ (settings.agentEngine ?? 'codex') === 'codex' ? 'Codex' : 'Pi' }}</span><ChevronDown :size="13" />
          </button>
          <div class="health-pill"><span class="status-dot" />{{ readyConnectionCount }}/{{ connections.length }} 就绪</div>
        </div>
      </header>

      <div v-if="loading" class="loading-screen"><div class="loader" /><span>正在打开本地工作区…</span></div>

      <template v-else>
        <section v-if="activeView === 'chat'" class="workspace-layout">
          <div class="conversation-pane">
            <div v-if="!activeProject" class="welcome-state">
              <div class="welcome-symbol"><img :src="brandLogo" alt="" /></div>
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
                    <p>从一个问题开始，按研究阶段选择任务；所需资料可以在发送前补充。</p>
                  </div>
                  <ResearchTaskStarter :skills="skills" @select="useQuickTask" />
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
                      <MessageCopyButton v-if="item.content && (item.role === 'user' || item.role === 'assistant')" :content="item.content" :kind="item.role" />
                    </div>
                    <ExecutionIdentity v-if="item.role==='assistant'" :task-id="item.taskId" :project-id="activeProjectId" :locale="modelLocale" />
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
                    <ResearchMessageArtifacts v-if="item.role==='assistant' && item.status!=='streaming'" :project-id="activeProjectId" :content="item.content" :locale="modelLocale" />
                    <AtomisticMessageArtifacts v-if="item.role==='assistant' && item.status!=='streaming'" :project-id="activeProjectId" :content="item.content" :locale="modelLocale" />
                  </div>
                </article>
              </div>

              <div class="composer-wrap"><div class="composer-inner">
                <CloudRunPanel v-if="settings.mode === 'platform'" :conversation-id="activeConversationId" :sending="sending" />
                <div v-if="cloudAttachments.length" class="field-help composer-attachments">已选附件：{{ cloudAttachments.map(a=>a.name+(a.pageCount?' · '+a.pageCount+' 页':'')+(a.ocrUnverifiedPages.length?' · '+a.ocrUnverifiedPages.length+' 页需核对':'')).join('、') }} <button class="secondary-button" :disabled="sending" @click="clearCloudFiles">清空</button></div>
                <div v-if="attachmentsBusy" class="field-help composer-attachments" role="status">正在本机解析附件；大 PDF 可能需要几分钟…</div>
                <p v-if="scientificScope" class="composer-hint" data-testid="science-scope">本机科学范围 / Local science scope：{{scientificScope.structureId}} · {{scientificScope.permission}} · {{scientificScope.domain}} · {{scientificScope.mode}}<span v-if="settings.mode==='platform'">；发送时再次确认摘要外发。</span><button class="secondary-button" :disabled="sending" @click="clearScientificScope">清除科学及下载授权 / Clear authorization</button></p>
                <ComposerReferencePreview :references="boundReferences" />
                <div class="composer">
                  <div v-if="skillMenuOpen" id="skill-mention-menu" class="skill-mention-menu" role="listbox">
                    <div class="skill-mention-header">
                      <span><Library :size="14" />选择引用 / Reference</span>
                      <small>@Skill · @file · @recipe · @paper · @structure</small>
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
                          <strong>{{ skill.label }}</strong>
                          <small>{{ skill.descriptionZh }} · {{ skill.status }}</small>
                        </span>
                        <kbd v-if="index === skillSelectionIndex">Enter</kbd>
                      </button>
                    </div>
                    <div v-else class="skill-mention-empty">没有匹配的资源。文件需先用附件入口选择；其他资源来自当前项目。 / No scoped match.</div>
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
                      <button class="tool-button" title="添加研究附件：PDF、Word、Excel、文本 / Add research files" :disabled="sending || attachmentsBusy" @click="chooseCloudFiles"><Paperclip :size="17" /></button>
                      <button v-if="sending && draft.trim()" class="context-chip" @click="submit">补充到当前任务</button>
                      <button v-else class="context-chip"><Wrench :size="14" />自动选择工具</button>
                    </div>
                    <button
                      :class="['send-button', { stopping: sending }]"
                      :disabled="(!draft.trim() && !sending) || attachmentsBusy"
                      :title="sending ? '停止生成' : '发送'"
                      @click="sending ? workspace.cancelActiveRun() : submit()"
                    >
                      <Send v-if="!sending" :size="17" /><Square v-else :size="14" />
                    </button>
                  </div>
                </div>
                <p class="composer-hint">
                  Enter {{sending ? "补充当前任务" : "发送"}} · Shift+Enter 换行 ·
                  {{ settings.mode === 'local' ? `经 ${(settings.agentEngine ?? 'codex') === 'codex' ? 'Codex App Server' : 'Pi'} 发送到本机 ${settings.localEndpoint}` : `${settings.modelId} · 每轮确认外发范围与计费` }}
                </p>
              </div>
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

        <PlatformCenter v-else-if="activeView==='platform'" :settings="settings" :skills="skills" :models="models" @chat="workspace.showView('chat')" @settings="settingsVisible=true" @skill="openPlatformSkill" @model="openPlatformModel" @example="useQuickTask($event);workspace.showView('chat')" />
        <WorkspaceCatalog
          v-else-if="activeView === 'skills' || activeView === 'models'"
          :view="activeView" v-model:skill-locale="skillLocale" v-model:model-locale="modelLocale"
          :filters="catalogFilters"
          v-model:directory-mode="modelDirectoryMode" :incoming-draft="userSkillDraft" :preparing-silicon="preparingSilicon"
          @skill="selectedSkill = $event" @model="selectedModel = $event"
          @skills-changed="userSkillDraft = null; workspace.refreshSkills()"
          @example="useModelExample" @try-silicon="trySiliconAnalysis"
        />
        <ResearchWorkspace v-else-if="activeView==='research'" @example="useQuickTask" />
        <WorkspaceOperations v-else :view="activeView" />
      </template>
    </main>

    <SettingsDrawer v-model="settingsVisible" :settings="settings" @save="saveSettings" />
    <AtomicTrajectoryDrawer :locale="modelLocale" :project-id="activeProjectId" />
    <AtomicComparisonDrawer :locale="modelLocale" :project-id="activeProjectId" />
  <AtomicViewerDrawer :locale="modelLocale" :project-id="activeProjectId" />
    <SkillDetailsDrawer
      :skill="selectedSkill"
      :locale="skillLocale"
      @close="selectedSkill = null"
      @update:locale="skillLocale = $event"
      @open-models="selectedSkill=null;activeView='models';modelDirectoryMode='potentials'"
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
