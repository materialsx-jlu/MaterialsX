<script setup lang="ts">
import {ref,watch} from 'vue';
import TaskExecutionPanel from './TaskExecutionPanel.vue';
import ResearchPlanEditor from './ResearchPlanEditor.vue';
import {ElDrawer} from 'element-plus';
import type {ResearchGoalPlan} from '../../../../../packages/contracts/src/research-goal.js';
import type {EngineSessionRef} from '../../../../../packages/contracts/src/engine-selection.js';
const props=withDefaults(defineProps<{modelValue:boolean;plan:ResearchGoalPlan|null;engineSession?:EngineSessionRef|null;locale?:'zh'|'en'}>(),{locale:'zh'});
const emit=defineEmits<{'update:modelValue':[value:boolean];revised:[plan:ResearchGoalPlan]}>();
const current=ref<ResearchGoalPlan|null>(null);
watch(()=>props.plan,p=>current.value=p,{immediate:true});
const t=(zh:string,en:string)=>props.locale==='zh'?zh:en;
function revised(p:ResearchGoalPlan){current.value=p;emit('revised',p);}
</script>
<template>
<ElDrawer :model-value="modelValue" :title="t('研究目标与执行计划','Research goal & execution plan')" size="min(900px,96vw)" @update:model-value="emit('update:modelValue',$event)">
 <div v-if="current" class="research-plan">
  <p v-if="engineSession" class="field-help" data-testid="run-engine">{{engineSession.selection.engine}} {{engineSession.selection.engineVersion}} · {{engineSession.connection.source}} · {{engineSession.connection.modelId}} · {{engineSession.connection.protocol}}</p>
  <p class="field-help">{{t('目标 / 计划版本','Goal / plan revision')}} {{current.goalRevision}} / {{current.planRevision}} · {{current.executionMode==='direct'?t('直接执行','Direct execution'):t('分步执行','Planned execution')}}</p>
  <TaskExecutionPanel :task-id="current.task.taskId" :locale="locale" :plan-revision="current.planRevision"/>
  <ResearchPlanEditor :plan="current" :locale="locale" @updated="revised"/>
  <section><h3>{{t('原始请求','Original request')}}</h3><p class="request">{{current.originalRequest}}</p></section>
  <section><h3>{{t('研究目标','Research goal')}}</h3><p>{{current.goal.materialSystem??t('材料体系未指定','Material system unspecified')}} · {{current.goal.problemType}}</p><ul><li v-for="(m,i) in current.goal.metrics" :key="i">{{m.name}}: {{m.value??t('未指定阈值','No threshold')}} {{m.unit}} · {{m.condition}}</li></ul><p v-if="current.goal.priorities.length">{{t('优先级','Priorities')}}: {{current.goal.priorities.join(' → ')}}</p></section>
  <section><h3>{{t('执行范围','Execution scope')}}</h3><p>{{t('权限','Permissions')}}: {{current.constraints.permissions.join(' · ')}}</p><p>{{t('时间上限','Time limit')}}: {{current.constraints.maxSeconds}} s · {{t('积分上限','Credit limit')}}: {{current.constraints.maxCredits??t('本机任务','Local task')}}</p><p v-if="current.constraints.process.length">{{t('工艺条件','Process conditions')}}: {{current.constraints.process.join('; ')}}</p><p v-if="current.constraints.dataSources.length">{{t('数据来源','Data sources')}}: {{current.constraints.dataSources.join('; ')}}</p></section>
  <section><h3>{{t('已知与待确认','Known facts & gaps')}}</h3><p v-for="(f,i) in current.cognition.facts" :key="i">{{t('已知','Fact')}}: {{f.text}} · {{f.evidence.length}} {{t('条证据','evidence references')}}</p><p v-for="m in current.cognition.missing" :key="m.id">{{t('待补充','Missing')}}: {{m.question}} · {{t('影响步骤','Blocks')}} {{m.blocks.join(', ')}}</p><p v-for="(a,i) in current.cognition.assumptions" :key="'a'+i">{{t('假设','Assumption')}}: {{a.text}} · {{a.confirmed?t('有证据确认','Confirmed with evidence'):t('尚未确认','Unconfirmed')}}</p><p v-for="c in current.cognition.conflicts" :key="c">{{t('条件冲突','Conflict')}}: {{c}}</p></section>
  <section><h3>{{t('执行步骤','Execution steps')}}</h3><ol><li v-for="s in current.steps" :key="s.id"><strong>{{s.id}} · {{s.method}}</strong><p>{{t('输入','Inputs')}}: {{s.inputRefs.join(', ')}} · {{t('依赖','Dependencies')}}: {{s.dependsOn.join(', ')||t('无','None')}}</p><p>{{t('预期产物','Expected artifacts')}}: {{s.expectedArtifacts.join(', ')||t('文本回答','Text response')}}</p><p>{{t('完成条件','Completion criteria')}}: {{s.completionCriteria.join('; ')}}</p></li></ol></section>
  <section><h3>{{t('调整规则','Adjustment rules')}}</h3><p v-for="(r,i) in current.adjustmentRules" :key="i">{{r.trigger}} → {{r.action}} · {{r.maxRetries}} {{t('次纠错上限','maximum corrections')}}</p></section>
  <section><h3>{{t('验收条件','Acceptance criteria')}}</h3><p>{{current.acceptance.requiredArtifacts.join(', ')||t('回答原始请求','Answer the original request')}}</p><p>{{current.acceptance.criteria.join('; ')}}</p><p>{{current.acceptance.requiredEvidence.join('; ')}}</p><p>{{current.acceptance.allowedLimitations.join('; ')}}</p></section>
  <p class="field-help">{{t('计划、技术执行与科学复核分别验收。输入或目标改变后，受影响产物保留但标记失效。','Plans, technical execution and scientific review are assessed separately. Changed inputs or goals retain affected artifacts as stale.')}}</p>
 </div>
</ElDrawer>
</template>
<style scoped>
.research-plan{color:var(--text);overflow-wrap:anywhere;min-width:0}.research-plan section{padding:16px 0;border-bottom:1px solid var(--line)}.research-plan h3{margin:0 0 10px;font-size:15px}.research-plan p{margin:6px 0;line-height:1.7}.request{white-space:pre-wrap}.research-plan ol,.research-plan ul{padding-left:22px}.research-plan li{margin:12px 0}
</style>
