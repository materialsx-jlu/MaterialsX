<script setup lang="ts">
import ExamplePrompts from "./ExamplePrompts.vue";
import { computed } from "vue";
import { Atom, ExternalLink, Languages, MessageSquareText } from "@lucide/vue";
import { ElDrawer } from "element-plus";
import type { ResearchModelSummary } from "../../../../../packages/contracts/src/desktop.js";

const props = defineProps<{ model: ResearchModelSummary | null; locale: "zh" | "en" }>();
const emit = defineEmits<{
  close: [];
  "update:locale": [locale: "zh" | "en"];
  "use-example": [prompt: string];
  "open-source": [modelId: string];
}>();
const visible = computed({
  get: () => props.model !== null,
  set: (value: boolean) => { if (!value) emit("close"); },
});
</script>

<template>
  <el-drawer v-model="visible" direction="rtl" size="500px" class="model-details-drawer" :with-header="false">
    <template v-if="model">
      <div class="skill-detail-heading">
        <div class="skill-detail-title">
          <span class="skill-detail-icon"><Atom :size="21" /></span>
          <div><span class="eyebrow">RESEARCH MODEL DIRECTORY</span><h2>{{ model.name }}</h2></div>
        </div>
        <button class="icon-button" aria-label="关闭模型详情" @click="emit('close')">×</button>
      </div>
      <div class="model-directory-notice">
        {{ locale === 'zh' ? '已收录目录信息；权重未随 MaterialsX 安装，也未加载到推理服务。' : 'Catalog entry included; weights are not bundled or loaded into an inference service.' }}
      </div>
      <section class="skill-detail-section">
        <div class="skill-detail-section-title"><Languages :size="16" /><strong>{{ locale === 'zh' ? '模型介绍' : 'Model description' }}</strong></div>
        <div class="language-toggle" aria-label="介绍语言">
          <button :class="{ active: locale === 'zh' }" @click="emit('update:locale', 'zh')">中文</button>
          <button :class="{ active: locale === 'en' }" @click="emit('update:locale', 'en')">English</button>
        </div>
        <p class="skill-detail-description" :lang="locale === 'zh' ? 'zh-CN' : 'en'">{{ locale === 'zh' ? model.descriptionZh : model.descriptionEn }}</p>
      </section>
      <section class="skill-detail-section skill-examples-section">
        <div class="skill-detail-section-title"><MessageSquareText :size="16" /><strong>{{ locale === 'zh' ? '使用示例' : 'Example prompts' }}</strong><span>{{ model.examples.length }}</span></div>
        <ExamplePrompts :examples="model.examples" :locale="locale" @use="emit('use-example',$event)"/>
      </section>
      <section class="skill-detail-section skill-detail-meta">
        <div><span>{{ locale === 'zh' ? '收录来源' : 'Source' }}</span><strong>{{ model.benchmark }}</strong></div>
        <div><span>{{ locale === 'zh' ? '权重链接' : 'Checkpoint' }}</span><strong>{{ model.checkpointUrl ? (locale === 'zh' ? '来源记录提供' : 'Listed by source') : (locale === 'zh' ? '未提供或需另行核查' : 'Not listed or requires review') }}</strong></div>
        <div><span>{{ locale === 'zh' ? '权重许可' : 'Checkpoint license' }}</span><strong>{{ model.license }}</strong></div>
      </section>
      <div class="skill-detail-actions">
        <button class="secondary-button" @click="emit('close')">{{ locale === 'zh' ? '关闭' : 'Close' }}</button>
        <button class="primary-button" @click="emit('open-source', model.id)">{{ locale === 'zh' ? '查看来源' : 'Open source' }} <ExternalLink :size="14" /></button>
      </div>
    </template>
  </el-drawer>
</template>
