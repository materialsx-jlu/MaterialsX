<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { Cpu, Palette, ShieldCheck, WalletCards } from "@lucide/vue";
import { ElDrawer, ElInput, ElMessage } from "element-plus";
import type { LocalModelSummary, ModelSettings } from "../../../../../packages/contracts/src/desktop.js";
import type { CompatibilityProfile } from "../../../../../packages/contracts/src/engine-selection.js";
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
const cloudInfo=ref("");
async function refreshCloud(){try{const c=await window.materialsx.getCloudCatalog();cloudInfo.value=c.alpha.available ? c.paidPricing ? "gpt-5.6-sol · 使用真实积分，普通 / 缓存 / 输出每万 Token：10 / 1 / 100 积分" : `gpt-5.6-sol · 剩余 ${c.alpha.remainingRequests} 次测试请求` : c.alpha.configured ? "请确认有效订阅或账户测试授权" : "服务端模型网关尚未配置";}catch{cloudInfo.value="请先登录平台账户，或检查服务端连接";}}
watch(()=>[props.modelValue,form.mode],()=>{if(props.modelValue&&form.mode==="platform")void refreshCloud()});
const detectedModels = ref<LocalModelSummary[]>([]);
const checkingEngine = ref(false);
const compatibility = ref<CompatibilityProfile | null>(null);
watch(() => [form.mode, form.agentEngine, form.modelId, form.localEndpoint,form.localProtocol,form.localContextBudget,form.localMaxOutputTokens], () => { compatibility.value = null; });
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
watch(
  () => props.settings,
  (value) => Object.assign(form, value),
  { deep: true },
);

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

function save(): void {
  if(form.cloudMaxCredits!==undefined&&(!/^(0|[1-9]\d{0,14})(\.\d{1,4})?$/.test(form.cloudMaxCredits)||Number(form.cloudMaxCredits)<=0)){ElMessage.error("任务积分上限需为正数，最多四位小数");return}
  if (form.mode === "local" && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/.test(form.localEndpoint)) {
    ElMessage.error("本地模型地址必须使用 loopback 地址");
    return;
  }
  const settings={...form};
  for(const key of ['localContextBudget','localMaxOutputTokens'] as const)if(settings[key]===null||settings[key]===undefined||settings[key]===('' as any))delete settings[key];
  emit("save", settings);
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
  <el-drawer v-model="visible" direction="rtl" size="440px" class="settings-drawer" :with-header="false">
    <div class="drawer-heading">
      <div>
        <span class="eyebrow">SETTINGS</span>
        <h2>设置</h2>
      </div>
      <button class="icon-button" aria-label="关闭设置" @click="visible = false">×</button>
    </div>

    <AccountPanel />

    <section class="setting-section">
      <div class="section-title"><Palette :size="17" /> 外观与配色</div>
      <div class="theme-options" aria-label="配色方案">
        <button
          v-for="theme in appearanceThemes"
          :key="theme.id"
          :class="['theme-option', { active: appearanceTheme === theme.id }]"
          :aria-pressed="appearanceTheme === theme.id"
          @click="selectAppearanceTheme(theme.id)"
        >
          <span :class="['theme-preview', theme.id]" aria-hidden="true">
            <span class="theme-preview-sidebar" />
            <span class="theme-preview-main"><span /><span /><i /></span>
          </span>
          <strong>{{ theme.name }}</strong>
          <small>{{ theme.description }}</small>
        </button>
      </div>
      <p class="field-help">统一应用到研究工作台和云服务中心，立即生效，并记住这台电脑上的配色偏好。</p>
    </section>

    <section class="setting-section">
      <div class="section-title"><Cpu :size="17" /> 执行引擎 / Execution engine</div>
      <div class="mode-grid">
        <button :class="['mode-option',{active:(form.agentEngine ?? 'pi')==='pi'}]" @click="form.agentEngine='pi'"><span class="mode-radio" /><strong>Pi</strong><small>本地或平台模型 · Local / cloud</small></button>
        <button :class="['mode-option',{active:form.agentEngine==='codex'}]" @click="form.agentEngine='codex'"><span class="mode-radio" /><strong>Codex App Server</strong><small>本地或平台模型 · macOS</small></button>
      </div>
      <p class="field-help">模型和执行引擎可分别选择，两种引擎使用相同材料工具。本地支持选择 Chat Completions 或 Responses，兼容检测只检查协议和工具回传。Codex 项目隔离暂仅验收 macOS；不兼容时不会切换云端。</p>
      <p class="field-help">Model and engine are independent. Select Chat Completions or Responses and verify streaming/tool round-trips. Codex isolation is verified on macOS only. No automatic cloud fallback.</p>
      <template v-if="form.mode === 'local'">
        <button class="secondary-button" :disabled="checkingEngine" data-testid="engine-probe" @click="checkEngine">{{ checkingEngine ? '检测中 / Checking…' : '检测引擎兼容性 / Check compatibility' }}</button>
        <p v-if="compatibility" class="field-help" data-testid="engine-compatibility">{{ compatibility.status }} · {{ compatibility.reason.zh }}<br />{{ compatibility.reason.en }}<br />{{ compatibility.connection.modelId }} · {{ compatibility.engine }} {{ compatibility.engineVersion }}</p>
      </template>
    </section>

    <section class="setting-section">
      <div class="section-title"><Cpu :size="17" /> 推理模式</div>
      <div class="mode-grid">
        <button :class="['mode-option', { active: form.mode === 'platform' }]" @click="form.mode = 'platform'; form.modelId = 'materials-research'; refreshCloud()">
          <span class="mode-radio" />
          <strong>平台模型</strong>
          <small>由 MaterialsX 网关提供模型和用量管理</small>
        </button>
        <button :class="['mode-option', { active: form.mode === 'local' }]" @click="form.mode = 'local'">
          <span class="mode-radio" />
          <strong>本地模型</strong>
          <small>连接这台电脑上的 loopback 推理服务</small>
        </button>
      </div>
    </section>

    <section class="setting-section">
      <label class="field-label" for="model-id">模型</label>
      <div v-if="form.mode==='local'" class="field-gap">
        <label class="field-label">本地协议 / Local protocol</label><select v-model="form.localProtocol" class="protocol-select"><option :value="undefined">自动选择 / Automatic</option><option value="chat-completions">Chat Completions</option><option value="responses">Responses</option></select>
        <label class="field-label">请求上下文预算 / Context budget</label><el-input v-model.number="form.localContextBudget" type="number" placeholder="留空使用实际加载窗口 / Loaded window"/>
        <p class="settings-help">gpt-oss-20b 自动使用已验证的 Chat Completions；手动选择的协议与原任务恢复连接保持不变。 / Automatic uses qualified Chat Completions for gpt-oss-20b; explicit choices and resumed connections remain fixed.</p>
        <label class="field-label">单次输出上限 / Output tokens</label><el-input v-model.number="form.localMaxOutputTokens" type="number" placeholder="留空使用现有预算 / Existing budget"/>
        <p class="field-help">上下文按实际加载窗口限制；字节预算保守估算，不是实测 Token。单次输出须为输入留下空间。/ Context is bounded by the loaded window; byte estimates are conservative, not measured tokens.</p>
      </div>
      <label v-if="form.mode==='platform'" class="field-help"><input v-model="form.cloudWorkspaceTools" type="checkbox"/>允许本轮确认项目工具 / Offer project tools for explicit per-run consent</label>
      <el-input v-if="form.mode === 'local'" id="model-id" v-model="form.modelId" placeholder="本地模型名称" />
      <template v-else><strong>RootFlowAI · gpt-5.6-sol</strong><p class="field-help">{{ cloudInfo }}<br />受邀账户可使用真实积分调用；技术测试单独使用 test-credit。正式售卖尚未开放。</p><label class="field-label">每个任务最多消耗的积分</label><el-input v-model="form.cloudMaxCredits" placeholder="500" inputmode="decimal" /><p class="field-help">积分类型按服务端路由选择；还受账户日/月额度和请求上限约束。</p><button class="secondary-button" @click="refreshCloud">刷新状态</button></template>
      <template v-if="form.mode === 'local'">
        <label class="field-label field-gap" for="local-endpoint">本地端点</label>
        <el-input id="local-endpoint" v-model="form.localEndpoint" placeholder="http://127.0.0.1:11434" />
        <p class="field-help">仅接受 127.0.0.1、localhost 或 ::1，不会连接用户配置的远程模型地址。</p>
        <div class="local-probe-row">
          <button class="secondary-button" :disabled="probing" @click="probeLocalModels">
            {{ probing ? '检测中…' : '检测本地模型' }}
          </button>
          <span v-if="detectedModels.length">已发现 {{ detectedModels.length }} 个</span>
        </div>
        <div v-if="detectedModels.length" class="detected-models">
          <button
            v-for="model in detectedModels"
            :key="model.id"
            :class="{ active: form.modelId === model.id, embedding: model.id.toLowerCase().includes('embedding') }"
            :disabled="model.id.toLowerCase().includes('embedding')"
            @click="form.modelId = model.id"
          >
            <span>{{ model.id }}</span><small>{{ model.id.toLowerCase().includes('embedding') ? 'Embedding' : 'Chat' }}</small>
          </button>
        </div>
      </template>
    </section>

    <section class="info-panel">
      <div><ShieldCheck :size="17" /><strong>数据边界</strong></div>
      <p>项目文件默认留在本机。平台模式在每轮发送前显示供应商、问题、历史、选定文本和 Skill。</p>
    </section>
    <section class="info-panel muted">
      <div><WalletCards :size="17" /><strong>订阅状态</strong></div>
      <p>在“订阅与额度”页面查看测试套餐、账期和追加式额度账本。真实支付与自动续费尚未接入。</p>
    </section>

    <div class="drawer-actions">
      <button class="secondary-button" @click="visible = false">取消</button>
      <button class="primary-button" @click="save">保存设置</button>
    </div>
  </el-drawer>
</template>
