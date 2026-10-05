<script setup lang="ts">
import { computed, ref, toRefs } from "vue";
import type { CatalogFilters } from "../utils/catalog-filters";
import { storeToRefs } from "pinia";
import { ElMessage } from "element-plus";
import { Search, FlaskConical, ArrowRight, Atom } from "@lucide/vue";
import type { ModelCategory, ResearchModelSummary, SkillSummary } from "../../../../../packages/contracts/src/desktop.js";
import { useWorkspaceStore } from "../stores/workspace";
import PotentialAutomationPanel from "./PotentialAutomationPanel.vue";
import UserSkillsPanel from "./UserSkillsPanel.vue";
import PotentialStoragePanel from "./PotentialStoragePanel.vue";
import PotentialUpdatesPanel from "./PotentialUpdatesPanel.vue";
import PotentialRegistryPanel from "./PotentialRegistryPanel.vue";
import AtomisticRunPanel from "./AtomisticRunPanel.vue";
const props = defineProps<{
  view: "skills" | "models";
  incomingDraft: Parameters<typeof window.materialsx.saveUserSkill>[0] | null;
  preparingSilicon: boolean;
  filters: CatalogFilters;
}>();
const emit = defineEmits<{
  skill: [skill: SkillSummary]; model: [model: ResearchModelSummary];
  'skills-changed': []; example: [prompt: string]; 'try-silicon': [];
}>();
const skillLocale = defineModel<"zh" | "en">("skillLocale", { required: true });
const modelLocale = defineModel<"zh" | "en">("modelLocale", { required: true });
const modelDirectoryMode = defineModel<"research" | "potentials">("directoryMode", { required: true });
const workspace = useWorkspaceStore();
const { skills, models, potentialCatalog, settings, activeProjectId, activeConversationId } = storeToRefs(workspace);
const { search, skillCategory, modelSearch, modelCategory } = toRefs(props.filters);
const potentialAutomation = ref<InstanceType<typeof PotentialAutomationPanel> | null>(null);
const readySkillsCount = computed(() => skills.value.filter(item => item.enabled).length);
async function openPotentialSource(id:string) { try { await window.materialsx.openPotentialSource(id); } catch { ElMessage.error("模型来源不可用 / Source unavailable"); } }

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
const skillDescription = (skill: SkillSummary): string =>
  skillLocale.value === "zh" ? skill.descriptionZh : skill.descriptionEn;
</script>

<template>
        <section v-if="view === 'skills'" class="catalog-view">
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
          <UserSkillsPanel :locale="skillLocale" :incoming-draft="incomingDraft" @changed="emit('skills-changed')" />
          <div class="catalog-grid">
            <button v-for="skill in filteredSkills" :key="skill.name" type="button" class="catalog-card" @click="emit('skill', skill)">
              <div class="catalog-icon"><FlaskConical :size="18" /></div>
              <div class="catalog-content"><strong>{{ skill.name }}</strong><p :lang="skillLocale === 'zh' ? 'zh-CN' : 'en'">{{ skillDescription(skill) }}</p><span>{{ skill.license }}</span></div>
              <ArrowRight class="catalog-open-icon" :size="15" />
              <div :class="['enabled-indicator', { reviewing: !skill.enabled }]"><span />{{ skill.availability==='planned' ? '仅规划 · M6.5' : skill.enabled ? '已启用' : '验收中' }}</div>
            </button>
          </div>
        </section>

        <section v-else class="catalog-view">
          <div class="page-heading">
            <div>
              <span class="eyebrow">MATERIALS MODEL DIRECTORY</span>
              <h1>{{ modelLocale === 'zh' ? '材料模型目录' : 'Materials model directory' }}</h1>
              <p v-if="modelDirectoryMode === 'research'">{{ modelLocale === 'zh' ? `${models.length} 个来源可核查的目录条目；不是全网使用量排名。` : `${models.length} source-backed entries; not a worldwide usage ranking.` }}</p>
              <p v-else>{{ modelLocale === 'zh' ? `浏览 ${potentialCatalog?.entries.length ?? 0} 个模型与相关资源，查看适用范围并管理本地安装。` : `Browse ${potentialCatalog?.entries.length ?? 0} models and related resources, check their scope and manage local installations.` }}</p>
            </div>
            <div class="skill-page-tools">
              <div class="language-toggle compact" aria-label="模型介绍语言">
                <button :class="{ active: modelLocale === 'zh' }" @click="modelLocale = 'zh'">中文</button>
                <button :class="{ active: modelLocale === 'en' }" @click="modelLocale = 'en'">English</button>
              </div>
              <div class="search-box"><Search :size="16" /><input v-model="modelSearch" :placeholder="modelLocale === 'zh' ? '搜索模型与来源' : 'Search models and sources'" /></div>
            </div>
          </div>
          <div class="catalog-filters" aria-label="目录类型">
            <button :class="{ active: modelDirectoryMode === 'research' }" @click="modelDirectoryMode = 'research'">{{ modelLocale === 'zh' ? '研究模型目录' : 'Research directory' }} <span>{{ models.length }}</span></button>
            <button :class="{ active: modelDirectoryMode === 'potentials' }" @click="modelDirectoryMode = 'potentials'">{{ modelLocale === 'zh' ? '机器学习势 · 全部目录' : 'ML potentials · All Potentials' }} <span>{{ potentialCatalog?.entries.length ?? 0 }}</span></button>
          </div>
          <div v-if="modelDirectoryMode === 'potentials'" class="catalog-page-body potential-page-body">
            <PotentialStoragePanel :locale="modelLocale" :catalog="potentialCatalog" />
            <PotentialUpdatesPanel :locale="modelLocale" @use-example="emit('example', $event)" />
            <PotentialRegistryPanel :catalog="potentialCatalog" :locale="modelLocale" :search="modelSearch" @use-example="emit('example', $event)" @open-source="openPotentialSource" @manage="potentialAutomation?.open($event)" />
            <PotentialAutomationPanel :catalog="potentialCatalog" ref="potentialAutomation" :preparing-demo="preparingSilicon" :project-id="activeProjectId" :conversation-id="activeConversationId" :locale="modelLocale" @use-example="emit('example', $event)" @try-silicon="emit('try-silicon')" />
            <AtomisticRunPanel :catalog="potentialCatalog" :project-id="activeProjectId" :locale="modelLocale" :local-agent="settings.mode === 'local'" :conversation-id="activeConversationId" @use-example="emit('example', $event)" />
          </div>
          <template v-else>
          <div class="model-catalog-notice">{{ modelLocale === 'zh' ? '这些模型的介绍随程序内置。权重未预装，且部分评测条目没有公开权重或需要额外许可；只有已接入本地推理服务的对话模型才能在研究任务中运行。' : 'Descriptions are bundled with MaterialsX. Weights are not preinstalled; some benchmark entries have no public checkpoint or require separate access. Chat runs only with a model connected to the local inference service.' }}</div>
          <div class="catalog-filters" aria-label="模型分类">
            <button :class="{ active: modelCategory === 'all' }" @click="modelCategory = 'all'">{{ modelLocale === 'zh' ? '全部' : 'All' }} <span>{{ models.length }}</span></button>
            <button v-for="category in modelCategories" :key="category.id" :class="{ active: modelCategory === category.id }" @click="modelCategory = category.id">
              {{ modelLocale === 'zh' ? category.zh : category.en }} <span>{{ models.filter((item) => item.category === category.id).length }}</span>
            </button>
          </div>
          <div class="catalog-grid">
            <button v-for="model in filteredModels" :key="model.id" type="button" class="catalog-card" @click="emit('model', model)">
              <div class="catalog-icon"><Atom :size="18" /></div>
              <div class="catalog-content"><strong>{{ model.name }}</strong><p :lang="modelLocale === 'zh' ? 'zh-CN' : 'en'">{{ modelLocale === 'zh' ? model.descriptionZh : model.descriptionEn }}</p><span>{{ model.benchmark }}</span></div>
              <ArrowRight class="catalog-open-icon" :size="15" />
              <div class="model-catalog-status">{{ modelCategoryLabel(model.category) }} · {{ modelLocale === 'zh' ? '目录收录' : 'Catalog only' }}</div>
            </button>
          </div>
          <div v-if="filteredModels.length === 0" class="empty-list">{{ modelLocale === 'zh' ? '没有匹配的模型' : 'No matching models' }}</div>
          </template>
        </section>

</template>
