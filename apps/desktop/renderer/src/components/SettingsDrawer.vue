<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { Cpu, Palette, ShieldCheck, WalletCards } from "@lucide/vue";
import { ElDrawer, ElInput, ElMessage } from "element-plus";
import type { LocalModelSummary, ModelSettings } from "../../../../../packages/contracts/src/desktop.js";
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
const detectedModels = ref<LocalModelSummary[]>([]);
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
  if (form.mode === "local" && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/.test(form.localEndpoint)) {
    ElMessage.error("本地模型地址必须使用 loopback 地址");
    return;
  }
  emit("save", { ...form });
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
      <p class="field-help">选择后立即生效，并记住这台电脑上的配色偏好。</p>
    </section>

    <section class="setting-section">
      <div class="section-title"><Cpu :size="17" /> 推理模式</div>
      <div class="mode-grid">
        <button :class="['mode-option', { active: form.mode === 'platform' }]" @click="form.mode = 'platform'">
          <span class="mode-radio" />
          <strong>平台订阅</strong>
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
      <el-input id="model-id" v-model="form.modelId" placeholder="materials-research" />
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
      <p>项目文件默认留在本机。平台模式接入后，每次外发都会显示目标与范围。</p>
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
