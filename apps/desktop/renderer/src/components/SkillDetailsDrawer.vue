<script setup lang="ts">
import { computed } from "vue";
import { ArrowRight, CheckCircle2, Copy, FlaskConical, Languages, MessageSquareText, ShieldCheck } from "@lucide/vue";
import { ElDrawer } from "element-plus";
import type { SkillSummary } from "../../../../../packages/contracts/src/desktop.js";

const props = defineProps<{
  skill: SkillSummary | null;
  locale: "zh" | "en";
}>();

const emit = defineEmits<{
  close: [];
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
  <el-drawer v-model="visible" direction="rtl" size="500px" class="skill-details-drawer" :with-header="false">
    <template v-if="skill">
      <div class="skill-detail-heading">
        <div class="skill-detail-title">
          <span class="skill-detail-icon"><FlaskConical :size="21" /></span>
          <div><span class="eyebrow">SCIENTIFIC SKILL</span><h2>{{ skill.name }}</h2></div>
        </div>
        <button class="icon-button" aria-label="关闭 Skill 详情" @click="emit('close')">×</button>
      </div>

      <div :class="['skill-detail-status', { reviewing: !skill.enabled }]">
        <CheckCircle2 v-if="skill.enabled" :size="15" />
        <ShieldCheck v-else :size="15" />
        {{ skill.enabled ? '已启用，可以在研究任务中使用' : '验收中，暂未加入默认运行能力' }}
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
        <div class="skill-example-list">
          <article v-for="(example, index) in skill.examples" :key="`${skill.name}-${index}`" class="skill-example-card">
            <div class="skill-example-number">{{ String(index + 1).padStart(2, '0') }}</div>
            <p :lang="locale === 'zh' ? 'zh-CN' : 'en'">{{ example[locale] }}</p>
            <button
              type="button"
              class="skill-example-copy"
              :aria-label="locale === 'zh' ? `将示例 ${index + 1} 填入输入框` : `Use example ${index + 1} in chat`"
              @click="emit('use-example', skill.name, example[locale])"
            >
              <Copy :size="14" />
              {{ locale === 'zh' ? '填入输入框' : 'Use in chat' }}
            </button>
          </article>
        </div>
      </section>

      <section class="skill-detail-section skill-detail-meta">
        <div><span>许可证</span><strong>{{ skill.license }}</strong></div>
        <div><span>来源</span><strong>{{ skill.source }}</strong></div>
        <div><span>安装方式</span><strong>MaterialsX 本地固定版本</strong></div>
      </section>

      <div class="skill-detail-actions">
        <button class="secondary-button" @click="emit('close')">关闭</button>
        <button v-if="skill.enabled" class="primary-button" @click="emit('use', skill.name)">
          在对话中使用 @{{ skill.name }} <ArrowRight :size="15" />
        </button>
      </div>
    </template>
  </el-drawer>
</template>
