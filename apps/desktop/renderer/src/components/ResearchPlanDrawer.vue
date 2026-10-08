<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElDrawer } from 'element-plus';
import TaskExecutionPanel from './TaskExecutionPanel.vue';
import ResearchPlanEditor from './ResearchPlanEditor.vue';
import type { ResearchGoalPlan } from '../../../../../packages/contracts/src/research-goal.js';
import type { EngineSessionRef } from '../../../../../packages/contracts/src/engine-selection.js';

type Tab = 'plan' | 'execution' | 'review';
const props = withDefaults(defineProps<{
  modelValue: boolean; plan: ResearchGoalPlan | null;
  engineSession?: EngineSessionRef | null; locale?: 'zh' | 'en';
}>(), { locale: 'zh' });
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; revised: [plan: ResearchGoalPlan] }>();
const current = ref<ResearchGoalPlan | null>(null);
const tab = ref<Tab>('plan');
const t = (zh: string, en: string) => props.locale === 'zh' ? zh : en;
watch(() => props.plan, plan => { current.value = plan; tab.value = 'plan'; }, { immediate: true });
function revised(plan: ResearchGoalPlan) { current.value = plan; emit('revised', plan); }
const hasCognition = computed(() => !!current.value && Object.values(current.value.cognition)
  .some(value => Array.isArray(value) && value.length > 0));
const permissions: Record<string, [string, string]> = {
  read: ['读取', 'Read'], search: ['搜索', 'Search'], terminal: ['终端', 'Terminal'],
  patch: ['修改文件', 'Edit files'], network: ['联网', 'Network'], science: ['科学计算', 'Scientific tools'],
};
const actions: Record<string, [string, string]> = {
  request_data: ['补充数据', 'Request data'], change_method: ['更换方法', 'Change method'],
  recompute: ['重新计算', 'Recompute'], stop: ['停止执行', 'Stop'],
};
const label = (value: string, names: Record<string, [string, string]>) =>
  names[value] ? t(...names[value]) : value;
</script>

<template>
  <ElDrawer class="research-plan-drawer" :model-value="modelValue" :show-close="false"
    size="min(880px, 100vw)" @update:model-value="emit('update:modelValue', $event)">
    <template #header>
      <div class="drawer-heading">
        <div><span class="eyebrow">{{ t('运行记录 / 研究计划', 'Run history / Research plan') }}</span>
          <h2>{{ t('研究目标与执行计划', 'Research goal and execution plan') }}</h2></div>
        <button type="button" class="close-button" :aria-label="t('关闭研究计划', 'Close research plan')"
          @click="emit('update:modelValue', false)">×</button>
      </div>
    </template>
    <div v-if="current" class="research-plan">
      <header class="plan-intro">
        <div class="intro-top"><span class="eyebrow">{{ t('本次任务', 'This task') }}</span>
          <span class="chip">{{ current.executionMode === 'direct' ? t('直接执行', 'Direct execution') : t('分步执行', 'Step-by-step') }}</span></div>
        <p class="request">{{ current.originalRequest }}</p>
        <div class="intro-meta"><span>{{ t('目标版本', 'Goal version') }} {{ current.goalRevision }}</span>
          <span>{{ t('计划版本', 'Plan version') }} {{ current.planRevision }}</span>
          <span>{{ current.steps.length }} {{ t('个步骤', 'steps') }}</span></div>
      </header>
      <nav class="plan-tabs" role="tablist" :aria-label="t('研究计划内容', 'Research plan sections')">
        <button v-for="item in ([{id:'plan',zh:'目标与步骤',en:'Goal & steps'},
          {id:'execution',zh:'执行状态',en:'Execution'},
          {id:'review',zh:'依据与验收',en:'Evidence & review'}] as const)"
          :key="item.id" type="button" role="tab" :aria-selected="tab === item.id"
          :class="{active:tab === item.id}" @click="tab = item.id">{{ t(item.zh, item.en) }}</button>
      </nav>

      <div v-if="tab === 'plan'" class="section-stack" role="tabpanel">
        <section class="plan-card">
          <div class="card-heading"><div><span class="section-index">01</span><h3>{{ t('研究目标', 'Research goal') }}</h3></div></div>
          <p class="goal-statement">{{ current.goal.problemType }}</p>
          <div class="facts-grid">
            <div class="fact"><span>{{ t('材料体系', 'Material system') }}</span>
              <strong>{{ current.goal.materialSystem || t('尚未指定', 'Not specified') }}</strong></div>
            <div v-if="current.goal.priorities.length" class="fact"><span>{{ t('优先顺序', 'Priorities') }}</span>
              <strong>{{ current.goal.priorities.join(' → ') }}</strong></div>
          </div>
          <div v-if="current.goal.metrics.length" class="subsection"><h4>{{ t('目标指标', 'Target metrics') }}</h4>
            <div class="metric-list"><div v-for="(metric,index) in current.goal.metrics" :key="index" class="metric-row">
              <strong>{{ metric.name }}</strong><span>{{ metric.value === null ? t('数值待确定', 'Value to define') : metric.value + (metric.unit ? ' ' + metric.unit : '') }}</span>
              <small v-if="metric.condition">{{ metric.condition }}</small></div></div>
          </div>
          <ResearchPlanEditor :plan="current" :locale="locale" @updated="revised" />
        </section>
        <section class="plan-card">
          <div class="card-heading"><div><span class="section-index">02</span><h3>{{ t('执行条件', 'Execution conditions') }}</h3></div></div>
          <div class="facts-grid">
            <div class="fact"><span>{{ t('可用工具权限', 'Tool access') }}</span>
              <div class="tag-list"><span v-for="permission in current.constraints.permissions" :key="permission" class="tag">{{ label(permission, permissions) }}</span></div></div>
            <div class="fact"><span>{{ t('任务时限', 'Task deadline') }}</span><strong>{{ current.constraints.maxSeconds }} {{ t('秒', 'seconds') }}</strong></div>
            <div v-if="current.constraints.maxCredits !== null" class="fact"><span>{{ t('本任务额度', 'Task credit limit') }}</span><strong>{{ current.constraints.maxCredits }}</strong></div>
            <div v-if="current.constraints.process.length" class="fact"><span>{{ t('工艺条件', 'Process conditions') }}</span>
              <ul><li v-for="(item,index) in current.constraints.process" :key="index">{{ item }}</li></ul></div>
            <div v-if="current.constraints.dataSources.length" class="fact"><span>{{ t('数据来源', 'Data sources') }}</span>
              <ul><li v-for="(item,index) in current.constraints.dataSources" :key="index">{{ item }}</li></ul></div>
          </div>
        </section>
        <section class="plan-card">
          <div class="card-heading"><div><span class="section-index">03</span><h3>{{ t('执行步骤', 'Execution steps') }}</h3></div>
            <span class="chip">{{ current.steps.length }}</span></div>
          <ol class="step-list"><li v-for="(step,index) in current.steps" :key="step.id" class="step-card">
            <span class="step-number">{{ String(index + 1).padStart(2, '0') }}</span>
            <div class="step-content"><div class="step-title"><strong>{{ step.method === 'engine.execute' ? t('执行研究任务', 'Execute research task') : step.method }}</strong><code>{{ step.id }}</code></div>
              <dl><div><dt>{{ t('输入', 'Inputs') }}</dt><dd>{{ step.inputRefs.length ? step.inputRefs.join('、') : t('当前任务', 'Current task') }}</dd></div>
                <div v-if="step.dependsOn.length"><dt>{{ t('前置步骤', 'Depends on') }}</dt><dd>{{ step.dependsOn.join('、') }}</dd></div>
                <div><dt>{{ t('交付内容', 'Outputs') }}</dt><dd>{{ step.expectedArtifacts.length ? step.expectedArtifacts.join('、') : t('文字答复', 'Written answer') }}</dd></div>
                <div><dt>{{ t('完成标准', 'Done when') }}</dt><dd>{{ step.completionCriteria.join('；') }}</dd></div></dl>
            </div></li></ol>
        </section>
      </div>
      <div v-else-if="tab === 'execution'" class="section-stack" role="tabpanel">
        <section v-if="engineSession" class="plan-card engine-card" data-testid="run-engine">
          <span class="section-index">{{ t('执行环境', 'Runtime') }}</span>
          <strong>{{ engineSession.connection.modelId }}</strong>
          <p>{{ engineSession.selection.engine }} {{ engineSession.selection.engineVersion }} · {{ engineSession.connection.source }} · {{ engineSession.connection.protocol }}</p>
        </section>
        <TaskExecutionPanel :task-id="current.task.taskId" :locale="locale" :plan-revision="current.planRevision" />
      </div>
      <div v-else class="section-stack" role="tabpanel">
        <section class="plan-card">
          <div class="card-heading"><div><span class="section-index">01</span><h3>{{ t('已知与待确认', 'Evidence and open questions') }}</h3></div></div>
          <p v-if="!hasCognition" class="empty-note">{{ t('当前计划没有记录额外事实、假设或待补充条件。', 'No additional facts, assumptions or open questions are recorded.') }}</p>
          <div v-for="(fact,index) in current.cognition.facts" :key="'fact-'+index" class="review-item">
            <span class="review-type">{{ t('已知', 'Known') }}</span><p>{{ fact.text }}</p>
            <small>{{ fact.evidence.length }} {{ t('条证据引用', 'evidence references') }}</small></div>
          <div v-for="missing in current.cognition.missing" :key="missing.id" class="review-item">
            <span class="review-type pending">{{ t('待补充', 'Needed') }}</span><p>{{ missing.question }}</p>
            <small v-if="missing.blocks.length">{{ t('影响步骤', 'Affects') }} {{ missing.blocks.join('、') }}</small></div>
          <div v-for="(assumption,index) in current.cognition.assumptions" :key="'assumption-'+index" class="review-item">
            <span class="review-type">{{ t('暂定假设', 'Assumption') }}</span><p>{{ assumption.text }}</p>
            <small>{{ assumption.confirmed ? t('已有证据支持', 'Evidence available') : t('尚待核实', 'Not yet verified') }}</small></div>
          <div v-for="(conflict,index) in current.cognition.conflicts" :key="'conflict-'+index" class="review-item">
            <span class="review-type pending">{{ t('条件冲突', 'Conflict') }}</span><p>{{ conflict }}</p></div>
        </section>
        <section class="plan-card">
          <div class="card-heading"><div><span class="section-index">02</span><h3>{{ t('调整规则', 'When the plan changes') }}</h3></div></div>
          <p v-if="!current.adjustmentRules.length" class="empty-note">{{ t('没有额外调整规则。', 'No additional adjustment rules.') }}</p>
          <div v-for="(rule,index) in current.adjustmentRules" :key="index" class="rule-row">
            <p>{{ rule.trigger }}</p><strong>{{ label(rule.action, actions) }}</strong>
            <small v-if="rule.maxRetries">{{ t('最多重试', 'Up to') }} {{ rule.maxRetries }} {{ t('次', 'retries') }}</small></div>
        </section>
        <section class="plan-card">
          <div class="card-heading"><div><span class="section-index">03</span><h3>{{ t('交付与验收', 'Delivery and review') }}</h3></div></div>
          <div class="acceptance-grid">
            <div><h4>{{ t('需要交付', 'Required outputs') }}</h4><ul>
              <li v-for="(item,index) in (current.acceptance.requiredArtifacts.length ? current.acceptance.requiredArtifacts : [t('回答原始请求', 'Answer the original request')])" :key="index">{{ item }}</li></ul></div>
            <div><h4>{{ t('完成标准', 'Acceptance criteria') }}</h4><ul><li v-for="(item,index) in current.acceptance.criteria" :key="index">{{ item }}</li></ul></div>
            <div v-if="current.acceptance.requiredEvidence.length"><h4>{{ t('必要证据', 'Required evidence') }}</h4><ul><li v-for="(item,index) in current.acceptance.requiredEvidence" :key="index">{{ item }}</li></ul></div>
            <div v-if="current.acceptance.allowedLimitations.length"><h4>{{ t('允许的限制', 'Allowed limitations') }}</h4><ul><li v-for="(item,index) in current.acceptance.allowedLimitations" :key="index">{{ item }}</li></ul></div>
          </div>
        </section>
        <p class="review-footer">{{ t('执行完成不等于科学结论已验证。条件或输入变化时，受影响的结果需要重新核对。', 'Execution does not validate scientific conclusions. Review affected results when conditions or inputs change.') }}</p>
      </div>
    </div>
    <div v-else class="empty-drawer">{{ t('没有可查看的研究计划。', 'No research plan is available.') }}</div>
  </ElDrawer>
</template>

<style scoped>
.drawer-heading{display:flex;align-items:center;justify-content:space-between;gap:18px;width:100%;min-width:0}.eyebrow,.section-index{color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.05em}.drawer-heading h2{margin:4px 0 0;color:var(--text);font-size:20px;line-height:1.35;font-weight:650;letter-spacing:-.02em}.close-button{flex:none;display:grid;place-items:center;width:34px;height:34px;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--muted);font-size:25px;line-height:1;cursor:pointer}.close-button:hover{color:var(--text);background:var(--panel-2)}.close-button:focus-visible,.plan-tabs button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.research-plan{width:100%;max-width:100%;min-width:0;box-sizing:border-box;color:var(--text);font-size:13px;line-height:1.65;overflow-wrap:anywhere}.research-plan *{box-sizing:border-box}.plan-intro{padding:20px 22px;border:1px solid var(--line);border-radius:14px;background:var(--catalog-surface)}.intro-top,.intro-meta,.card-heading,.card-heading>div,.step-title{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.intro-top,.card-heading,.step-title{justify-content:space-between}.chip,.tag{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:3px 9px;background:var(--panel);color:var(--muted);font-size:11px;font-weight:600}.request{margin:12px 0 15px;white-space:pre-wrap;font-size:15px;font-weight:570;line-height:1.7}.intro-meta{gap:8px 16px;color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
.plan-tabs{position:sticky;top:-1px;z-index:2;display:flex;gap:5px;padding:13px 0 10px;margin:0 0 5px;background:var(--panel);border-bottom:1px solid var(--line)}.plan-tabs button{min-height:36px;padding:7px 13px;border:0;border-radius:8px;background:transparent;color:var(--muted);font:inherit;font-size:12px;font-weight:600;cursor:pointer}.plan-tabs button:hover{background:var(--panel-2);color:var(--text)}.plan-tabs button.active{background:var(--accent-bg);color:var(--accent)}.section-stack{display:grid;gap:14px;padding:14px 0 28px;min-width:0}.plan-card{min-width:0;padding:20px 22px;border:1px solid var(--line);border-radius:14px;background:var(--catalog-surface)}.card-heading{align-items:flex-start;margin-bottom:16px}.card-heading>div{gap:9px}.card-heading h3{margin:0;font-size:15px;line-height:1.4;letter-spacing:-.01em}.goal-statement{margin:0 0 18px;font-size:14px;line-height:1.75}.facts-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.fact{min-width:0;padding:12px 14px;border:1px solid var(--line-soft);border-radius:9px;background:var(--panel)}.fact>span{display:block;margin-bottom:6px;color:var(--muted);font-size:11px}.fact strong{display:block;font-size:13px;font-weight:600;line-height:1.6}.fact ul{margin:2px 0 0;padding-left:18px}.fact li{margin:3px 0}.tag-list{display:flex;gap:5px;flex-wrap:wrap}.tag{border-radius:6px;padding:2px 7px}.subsection{margin-top:20px}.subsection h4,.acceptance-grid h4{margin:0 0 9px;font-size:12px;font-weight:650}.metric-list{display:grid;gap:8px}.metric-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 12px;padding:10px 13px;border:1px solid var(--line-soft);border-radius:8px;background:var(--panel)}.metric-row strong{font-size:12px}.metric-row>span{font-variant-numeric:tabular-nums;font-weight:600}.metric-row small{grid-column:1/-1;color:var(--muted);font-size:11px}
.step-list{display:grid;gap:10px;list-style:none;margin:0;padding:0}.step-card{display:grid;grid-template-columns:32px minmax(0,1fr);gap:12px;padding:15px;border:1px solid var(--line-soft);border-radius:10px;background:var(--panel)}.step-number{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:var(--accent-bg);color:var(--accent);font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}.step-content{min-width:0}.step-title{align-items:baseline;margin-bottom:8px}.step-title strong{font-size:13px}.step-title code{color:var(--muted);font-size:10px}.step-card dl{display:grid;gap:6px;margin:0}.step-card dl>div{display:grid;grid-template-columns:70px minmax(0,1fr);gap:10px}.step-card dt{color:var(--muted);font-size:11px}.step-card dd{min-width:0;margin:0;font-size:12px}.engine-card{display:grid;gap:5px}.engine-card strong{font-size:15px}.engine-card p{margin:0;color:var(--muted);font-size:12px}
.empty-note,.review-footer{margin:0;color:var(--muted);font-size:12px}.review-item{display:grid;grid-template-columns:76px minmax(0,1fr);gap:2px 12px;padding:12px 0;border-top:1px solid var(--line-soft)}.review-item p{margin:0;font-size:12px}.review-item small{grid-column:2;color:var(--muted);font-size:11px}.review-type{color:var(--accent);font-size:11px;font-weight:650}.review-type.pending{color:var(--warn)}.rule-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:10px 0;border-top:1px solid var(--line-soft)}.rule-row p{flex:1;min-width:180px;margin:0}.rule-row strong{font-size:12px}.rule-row small{color:var(--muted);font-size:11px}.acceptance-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.acceptance-grid>div{min-width:0}.acceptance-grid ul{margin:0;padding-left:18px}.acceptance-grid li{margin:4px 0;font-size:12px}.empty-drawer{padding:32px;color:var(--muted)}
@media(max-width:650px){.drawer-heading h2{font-size:17px}.plan-intro,.plan-card{padding:16px}.request{font-size:14px}.facts-grid,.acceptance-grid{grid-template-columns:1fr}.plan-tabs{overflow-x:auto}.plan-tabs button{white-space:nowrap}.step-card dl>div{grid-template-columns:1fr;gap:0}.review-item{grid-template-columns:1fr}.review-item small{grid-column:1}}
</style>
<style>
.research-plan-drawer.el-drawer{--el-drawer-bg-color:var(--panel);color:var(--text)}
.research-plan-drawer .el-drawer__header{flex:none;margin:0;padding:18px 24px;border-bottom:1px solid var(--line)}
.research-plan-drawer .el-drawer__body{padding:20px 24px;overflow-x:hidden;overflow-y:auto}
@media(max-width:650px){.research-plan-drawer .el-drawer__header{padding:15px 17px}.research-plan-drawer .el-drawer__body{padding:16px}}
</style>
