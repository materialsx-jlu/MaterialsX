<script setup lang="ts">
import ExamplePrompts from './ExamplePrompts.vue';
import { computed } from "vue";
import { ArrowRight, CheckCircle2, FlaskConical, Languages, MessageSquareText, ShieldCheck } from "@lucide/vue";
import { ElDrawer } from "element-plus";
import type { SkillSummary } from "../../../../../packages/contracts/src/desktop.js";

const props = defineProps<{
  skill: SkillSummary | null;
  locale: "zh" | "en";
}>();

const emit = defineEmits<{
  close: [];
  "open-models": [];
  use: [skillName: string];
  "use-example": [skillName: string, prompt: string];
  "update:locale": [locale: "zh" | "en"];
}>();

const visible = computed({
  get: () => props.skill !== null,
  set: (value: boolean) => {
    if (!value) emit("close");
  },
});

const description = computed(() =>
  props.skill ? (props.locale === "zh" ? props.skill.descriptionZh : props.skill.descriptionEn) : "",
);
</script>

<template>
  <el-drawer v-model="visible" direction="rtl" size="min(500px, 100vw)" class="skill-details-drawer" :with-header="false">
    <template v-if="skill">
      <div class="skill-detail-heading">
        <div class="skill-detail-title">
          <span class="skill-detail-icon"><FlaskConical :size="21" /></span>
          <div><span class="eyebrow">SCIENTIFIC SKILL</span><h2 :title="skill.name">{{ skill.name }}</h2></div>
        </div>
        <button class="icon-button" aria-label="关闭 Skill 详情" @click="emit('close')">×</button>
      </div>

      <div :class="['skill-detail-status', { reviewing: !skill.enabled }]">
        <CheckCircle2 v-if="skill.enabled" :size="15" />
        <ShieldCheck v-else :size="15" />
        {{ skill.availability === 'planned' ? (locale === 'zh' ? '已内置 · 仅规划，执行器待 M6.5' : 'Bundled · Planning only, execution in M6.5') : skill.enabled ? '已启用，可以在研究任务中使用' : skill.source==='MaterialsX installed Skill'?'已停用，可在扩展 Skills 中启用':'验收中，暂未加入默认运行能力' }}
      </div>

      <section class="skill-detail-section">
        <div class="skill-detail-section-title"><Languages :size="16" /><strong>能力介绍</strong></div>
        <div class="language-toggle" aria-label="介绍语言">
          <button :class="{ active: locale === 'zh' }" @click="emit('update:locale', 'zh')">中文</button>
          <button :class="{ active: locale === 'en' }" @click="emit('update:locale', 'en')">English</button>
        </div>
        <p class="skill-detail-description" :lang="locale === 'zh' ? 'zh-CN' : 'en'">{{ description }}</p>
      </section>

      <section class="skill-detail-section skill-examples-section">
        <div class="skill-detail-section-title">
          <MessageSquareText :size="16" />
          <strong>{{ locale === 'zh' ? '使用示例' : 'Example prompts' }}</strong>
          <span>{{ skill.examples.length }}</span>
        </div>
        <ExamplePrompts :examples="skill.examples" :locale="locale" @use="emit('use-example',skill.name,$event)"/>
      </section>

      <section v-if="skill.applicablePotentialIds?.length" class="skill-detail-section"><strong>{{locale==='zh'?'关联核心势（仍需兼容与精度检查）':'Related core potentials (eligibility checks required)'}}</strong><p>{{skill.applicablePotentialIds.join(' · ')}}</p><button class="secondary-button" @click="emit('open-models')">{{locale==='zh'?'打开势目录与本地计算':'Open potential directory and local tasks'}}</button></section>
      <section class="skill-detail-section skill-detail-meta">
        <div><span>许可证</span><strong>{{ skill.license }}</strong></div>
        <div><span>来源</span><strong>{{ skill.source }}</strong></div>
        <div><span>安装方式</span><strong>MaterialsX 本地固定版本</strong></div>
      </section>

      <div class="skill-detail-actions">
        <button class="secondary-button" @click="emit('close')">关闭</button>
        <button v-if="skill.enabled" class="primary-button" :aria-label="locale === 'zh' ? `在对话中使用 @${skill.name}` : `Use @${skill.name} in chat`" :title="`@${skill.name}`" @click="emit('use', skill.name)">
          <span>{{ locale === 'zh' ? '在对话中使用' : 'Use in chat' }}</span><ArrowRight :size="15" />
        </button>
      </div>
    </template>
  </el-drawer>
</template>
