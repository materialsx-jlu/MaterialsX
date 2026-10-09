<script setup lang="ts">
import PlatformConnectionNotice from './PlatformConnectionNotice.vue';
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { ChevronDown, Cpu, Palette, ShieldCheck, WalletCards, X } from "@lucide/vue";
import { ElDrawer, ElInput, ElMessage } from "element-plus";
import type { LocalModelSummary, ModelSettings } from "../../../../../packages/contracts/src/desktop.js";
import type { CompatibilityProfile } from "../../../../../packages/contracts/src/engine-selection.js";
import type {CloudCatalog} from '../../../../../packages/contracts/src/platform.js';
import { admittedPlatformModel } from '../../../../../packages/contracts/src/platform-model-admission.js';
import AccountPanel from "./AccountPanel.vue";
import { appearanceTheme, appearanceThemes, selectAppearanceTheme } from "../utils/appearance";

const props = defineProps<{
  modelValue: boolean;
  settings: ModelSettings;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  save: [settings: ModelSettings];
}>();

const form = reactive<ModelSettings>({ ...props.settings });
const probing = ref(false);
const advancedOpen = ref(false);
const modelValidationVisible = ref(false);
const rememberedLocalModel = ref(props.settings.mode === "local" ? props.settings.modelId : "");
const cloudInfo=ref("");
const releaseCheck=ref<import('../../../main/platform-release.js').ReleaseCheck|null>(null);
const checkingRelease=ref(false);
async function checkUpdate(){checkingRelease.value=true;try{releaseCheck.value=await window.materialsx.checkReleaseUpdate()}finally{checkingRelease.value=false}}
async function openUpdate(){try{await window.materialsx.openReleaseUpdate()}catch{ElMessage.error('下载地址暂不可用，请稍后重试')}}
const cloudCatalog=ref<CloudCatalog|null>(null);
const selectableCloudModels=computed(()=>cloudCatalog.value?.items.filter(item=>admittedPlatformModel(cloudCatalog.value!,item.id))??[]);
async function refreshCloud(){try{const c=await window.materialsx.getCloudCatalog();cloudCatalog.value=c;if(form.mode==='platform'&&!admittedPlatformModel(c,form.modelId))form.modelId=c.items.find(item=>admittedPlatformModel(c,item.id))?.id??form.modelId;cloudInfo.value=c.items.some(item=>item.enabled&&item.accessMode==='mx-points')?"已连接 · MX 点按实际用量结算":c.alpha.available ? c.paidPricing ? "已连接 · 按实际用量扣除积分" : `已连接 · 剩余 ${c.alpha.remainingRequests} 次测试请求` : c.alpha.configured ? "需要有效订阅或测试授权" : "平台模型暂不可用";}catch{cloudCatalog.value=null;cloudInfo.value="无法读取平台状态，请检查账户和网络";}}
let stopPlatformUpdates:()=>void=()=>{};
onMounted(()=>{stopPlatformUpdates=window.materialsx.onPlatformConfigurationChanged(()=>{if(props.modelValue&&form.mode==='platform')void refreshCloud()})});
onUnmounted(()=>stopPlatformUpdates());
watch(()=>[props.modelValue,form.mode],()=>{if(props.modelValue&&form.mode==="platform")void refreshCloud()});
watch(() => props.modelValue, (open) => {
  if (open) { Object.assign(form, props.settings); compatibility.value = null; modelValidationVisible.value = false; }
});
const detectedModels = ref<LocalModelSummary[]>([]);
const checkingEngine = ref(false);
const compatibility = ref<CompatibilityProfile | null>(null);
const endpointError = computed(() => form.mode === "local" && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/.test(form.localEndpoint));
const modelError = computed(() => form.mode === "local" && !form.modelId.trim());
watch(() => [form.mode, form.agentEngine, form.modelId, form.localEndpoint,form.localProtocol,form.localContextBudget], () => { compatibility.value = null; });
async function checkEngine(): Promise<void> {
  checkingEngine.value = true;
  const selected = JSON.stringify(form);
  try {
    const result = await window.materialsx.probeEngineCompatibility({ ...form });
    if (selected === JSON.stringify(form)) compatibility.value = result;
  }
  catch (cause) { ElMessage.error(cause instanceof Error ? cause.message : String(cause)); }
  finally { checkingEngine.value = false; }
}
watch(() => props.settings, (value) => {
  Object.assign(form, value);
  if (value.mode === "local") rememberedLocalModel.value = value.modelId;
}, { deep: true });

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

function save(): void {
  if (endpointError.value) { ElMessage.error("请输入这台电脑的本地地址（127.0.0.1、localhost 或 ::1）"); return; }
  if (modelError.value) { modelValidationVisible.value = true; ElMessage.error("请选择或输入本地模型名称"); return; }
  if(form.mode==='platform'&&!selectableCloudModels.value.some(item=>item.id===form.modelId)){ElMessage.error('所选平台模型当前不可用，请刷新目录后重新选择');return;}
  const settings={...form};
  if(settings.localContextBudget===null||settings.localContextBudget===undefined||settings.localContextBudget===('' as any))delete settings.localContextBudget;
  delete settings.localMaxOutputTokens;
  emit("save", settings);
}

function selectMode(mode: ModelSettings["mode"]): void {
  if (mode === form.mode) return;
  if (form.mode === "local") rememberedLocalModel.value = form.modelId;
  form.mode = mode;
  modelValidationVisible.value = false;
  if (mode === "platform") { form.modelId = "materials-research"; void refreshCloud(); }
  else form.modelId = rememberedLocalModel.value;
}

async function probeLocalModels(): Promise<void> {
  probing.value = true;
  try {
    detectedModels.value = await window.materialsx.probeLocalModels(form.localEndpoint);
    const chatModels = detectedModels.value.filter((item) => !item.id.toLowerCase().includes("embedding"));
    const firstChatModel = chatModels[0];
    if (firstChatModel && !detectedModels.value.some((item) => item.id === form.modelId)) {
      form.modelId = firstChatModel.id;
    }
    ElMessage.success(`检测到 ${detectedModels.value.length} 个本地模型`);
  } catch (cause) {
    detectedModels.value = [];
    ElMessage.error(cause instanceof Error ? cause.message : String(cause));
  } finally {
    probing.value = false;
  }
}
</script>

<template>
  <el-drawer v-model="visible" direction="rtl" size="min(560px, 100vw)" class="settings-drawer" :with-header="false">
    <div class="settings-shell">
      <header class="settings-header">
        <div><span class="settings-kicker">PREFERENCES</span><h2>设置</h2><p>管理模型连接、任务执行与工作区外观</p></div>
        <button class="settings-close" type="button" aria-label="关闭设置" @click="visible = false"><X :size="19" /></button>
      </header>
      <div class="settings-content">
        <section class="settings-group" aria-labelledby="model-settings-title">
          <div class="settings-group-heading"><span class="settings-group-icon"><Cpu :size="19" /></span><div><h3 id="model-settings-title">模型与运行</h3><p>选择任务使用的模型，以及调用工具的执行引擎。</p></div></div>
          <div class="settings-field"><span class="settings-label">模型来源</span>
            <div class="settings-choice-grid" role="group" aria-label="模型来源">
              <button type="button" :class="['settings-choice', { selected: form.mode === 'platform' }]" :aria-pressed="form.mode === 'platform'" @click="selectMode('platform')"><strong>平台模型</strong><small>联网调用，按账户额度计费</small></button>
              <button type="button" :class="['settings-choice', { selected: form.mode === 'local' }]" :aria-pressed="form.mode === 'local'" @click="selectMode('local')"><strong>本地模型</strong><small>连接这台电脑上的推理服务</small></button>
            </div>
          </div>
          <div class="settings-field"><span class="settings-label">执行引擎</span>
            <div class="settings-choice-grid" role="group" aria-label="执行引擎">
              <button type="button" :class="['settings-choice', { selected: form.agentEngine === 'pi' }]" :aria-pressed="form.agentEngine === 'pi'" @click="form.agentEngine = 'pi'"><strong>Pi</strong><small>轻量任务与本地推理</small></button>
              <button type="button" :class="['settings-choice', { selected: (form.agentEngine ?? 'codex') === 'codex' }]" :aria-pressed="(form.agentEngine ?? 'codex') === 'codex'" @click="form.agentEngine = 'codex'"><strong>Codex App Server</strong><small>多步骤任务与工具执行</small></button>
            </div>
            <p class="settings-hint">引擎与模型可以独立选择；新任务会使用保存后的设置。</p>
          </div>
          <div v-if="form.mode === 'platform'" class="settings-connection">
            <PlatformConnectionNotice />
            <div class="settings-connection-top"><div><span class="settings-label">当前模型</span><strong>{{form.modelId}}</strong></div><button class="settings-link-button" type="button" @click="refreshCloud">刷新状态</button></div>
            <p v-if="cloudCatalog" class="settings-hint">平台目录 {{cloudCatalog.items.length}} 个模型 · 当前可选 {{selectableCloudModels.length}} 个</p>
            <div class="settings-model-list" aria-label="平台模型"><button v-for="model in cloudCatalog?.items??[]" :key="model.id" type="button" :class="{selected:form.modelId===model.id}" :disabled="!cloudCatalog||!admittedPlatformModel(cloudCatalog,model.id)" @click="form.modelId=model.id"><span>{{model.id}}</span><small>{{model.enabled?(model.accessMode==='mx-points'?'MX 点计费':model.accessMode==='alpha-diagnostic'?'诊断测试 · 不扣 MX 点':'平台模型'):'当前不可调用'}}</small></button></div>
            <p class="settings-status">{{ cloudInfo || '正在读取平台状态…' }}</p>
            <p class="settings-hint">仅可选择服务端目录中已开放的模型。MX 点价格和购买状态以“订阅与额度”页面的实时目录为准。</p>
            <label class="settings-check"><input v-model="form.cloudWorkspaceTools" type="checkbox" /><span><strong>允许使用项目工具</strong><small>每次任务仍需单独确认外发内容与工具权限。</small></span></label>
          </div>
          <div v-else class="settings-connection">
            <div class="settings-field"><label class="settings-label" for="local-endpoint">服务地址</label><el-input id="local-endpoint" v-model="form.localEndpoint" placeholder="http://localhost:1234/v1" :aria-invalid="endpointError" /><p v-if="endpointError" class="settings-error" role="alert">只支持这台电脑的地址：127.0.0.1、localhost 或 ::1。</p><p v-else class="settings-hint">例如 LM Studio 的 http://localhost:1234/v1。</p></div>
            <div class="settings-field"><label class="settings-label" for="model-id">模型名称</label><el-input id="model-id" v-model="form.modelId" placeholder="选择检测到的模型，或输入模型 ID" :aria-invalid="modelValidationVisible && modelError" /><p v-if="modelValidationVisible && modelError" class="settings-error" role="alert">请选择或输入模型 ID。</p><div class="settings-inline-action"><button class="secondary-button" type="button" :disabled="probing || endpointError" @click="probeLocalModels">{{ probing ? '正在检测…' : '检测本地模型' }}</button><span v-if="detectedModels.length">找到 {{ detectedModels.length }} 个</span></div>
              <div v-if="detectedModels.length" class="settings-model-list" aria-label="检测到的模型"><button v-for="model in detectedModels" :key="model.id" type="button" :class="{ selected: form.modelId === model.id }" :disabled="model.id.toLowerCase().includes('embedding')" @click="form.modelId = model.id"><span>{{ model.id }}</span><small>{{ model.id.toLowerCase().includes('embedding') ? '向量模型' : '对话模型' }}</small></button></div>
            </div>
            <button class="settings-disclosure" type="button" :aria-expanded="advancedOpen" @click="advancedOpen = !advancedOpen">高级连接设置 <ChevronDown :size="16" :class="{ rotated: advancedOpen }" /></button>
            <div v-if="advancedOpen" class="settings-advanced"><label class="settings-label" for="local-protocol">接口协议</label><select id="local-protocol" v-model="form.localProtocol" class="settings-select"><option :value="undefined">自动选择</option><option value="chat-completions">Chat Completions</option><option value="responses">Responses</option></select><p class="settings-hint">自动模式会为已验证的模型选择兼容协议；手动选择会固定当前协议。</p><label class="settings-label" for="context-budget">模型上下文窗口（Token）</label><el-input id="context-budget" v-model.number="form.localContextBudget" type="number" min="1" placeholder="留空使用模型已加载窗口" /><p class="settings-hint">仅当本地服务报告的上下文窗口不准确时调整；留空由模型决定。</p></div>
            <div class="settings-compatibility"><button class="secondary-button" type="button" :disabled="checkingEngine || endpointError" data-testid="engine-probe" @click="checkEngine">{{ checkingEngine ? '正在检查…' : '检查模型与引擎兼容性' }}</button><p v-if="compatibility" class="settings-result" data-testid="engine-compatibility"><strong>{{ compatibility.status }} · {{ compatibility.reason.zh }}</strong><span>{{ compatibility.connection.modelId }} · {{ compatibility.engine }} {{ compatibility.engineVersion }}</span></p><p v-else class="settings-hint">检查连接、流式输出和工具调用是否可用。</p></div>
          </div>
        </section>
        <section class="settings-group" aria-labelledby="appearance-settings-title"><div class="settings-group-heading"><span class="settings-group-icon"><Palette :size="19" /></span><div><h3 id="appearance-settings-title">外观</h3><p>选择适合当前工作环境的配色。</p></div></div><div class="theme-options settings-theme-grid" aria-label="配色方案"><button v-for="theme in appearanceThemes" :key="theme.id" type="button" :class="['theme-option', { active: appearanceTheme === theme.id }]" :aria-pressed="appearanceTheme === theme.id" @click="selectAppearanceTheme(theme.id)"><span :class="['theme-preview', theme.id]" aria-hidden="true"><span class="theme-preview-sidebar" /><span class="theme-preview-main"><span /><span /><i /></span></span><strong>{{ theme.name }}</strong><small>{{ theme.description }}</small></button></div><p class="settings-hint">配色立即生效，并保存在这台电脑上。</p></section>
        <AccountPanel />
        <section class="settings-group" aria-label="版本更新"><div class="settings-group-heading"><div><h3>版本更新</h3><p>从当前发行渠道检查安装包；下载后可对照 SHA-256 校验。</p></div></div><button class="secondary-button" type="button" :disabled="checkingRelease" @click="checkUpdate">{{checkingRelease?'正在检查…':'检查更新'}}</button><p v-if="releaseCheck" class="settings-hint" role="status">{{releaseCheck.state==='available'?`发现 ${releaseCheck.version} 版本`:releaseCheck.state==='current'?'当前已是最新版本':releaseCheck.state==='unconfigured'?'当前版本未配置在线更新':'暂时无法检查更新'}}</p><div v-if="releaseCheck?.state==='available'"><p class="settings-hint">SHA-256：{{releaseCheck.sha256}}</p><button class="settings-link-button" type="button" @click="openUpdate">打开安装包下载页</button></div></section>
        <section class="settings-notes" aria-label="使用说明"><div><ShieldCheck :size="18" /><span><strong>数据边界</strong><small>本地模型在设备上运行；平台调用前可查看待发送内容。</small></span></div><div><WalletCards :size="18" /><span><strong>订阅与额度</strong><small>MX 点余额、充值订单与模型价格请在“订阅与额度”查看；实际用量请在“运行记录”查看。</small></span></div></section>
      </div>
      <footer class="settings-footer"><span>模型与引擎更改在保存后生效</span><div><button class="secondary-button" type="button" @click="visible = false">取消</button><button class="primary-button" type="button" @click="save">保存设置</button></div></footer>
    </div>
  </el-drawer>
</template>
<style scoped src="./SettingsDrawer.css"></style>
