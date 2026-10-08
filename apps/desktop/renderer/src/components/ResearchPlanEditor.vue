<script setup lang="ts">
import {ref,watch} from 'vue';
import type {ResearchGoalPlan} from '../../../../../packages/contracts/src/research-goal.js';
const props=defineProps<{plan:ResearchGoalPlan;locale:'zh'|'en'}>();
const emit=defineEmits<{updated:[plan:ResearchGoalPlan]}>();
const draft=ref<ResearchGoalPlan>(JSON.parse(JSON.stringify(props.plan))),editing=ref(false),busy=ref(false),error=ref('');
watch(()=>props.plan,p=>{draft.value=JSON.parse(JSON.stringify(p));editing.value=false;});
const resolved=ref<string[]>([]),note=ref(''),refreshInputs=ref(false);
const t=(zh:string,en:string)=>props.locale==='zh'?zh:en;
async function save(){busy.value=true;error.value='';try{
  const p=JSON.parse(JSON.stringify(draft.value)) as ResearchGoalPlan;p.planRevision=props.plan.planRevision+1;
  p.goalRevision=props.plan.goalRevision+1;p.revisionReason=note.value.trim()||t('用户修改研究目标或补充条件','User revised research goal or supplied conditions');
  p.originalRequest=props.plan.originalRequest+'\n'+p.revisionReason+'\n'+JSON.stringify({goal:p.goal,process:p.constraints.process});
  if(resolved.value.length&&!note.value.trim())throw Error(t('请填写补充条件；不能只勾选解决','Supply the missing conditions before marking them resolved'));
  p.cognition.missing=p.cognition.missing.filter(m=>!resolved.value.includes(m.id));
  if(note.value.trim())p.cognition.facts.push({text:note.value.trim(),evidence:[],confirmed:false});
  if(refreshInputs.value){const b=await window.materialsx.getResearchRevisionInputs(p.task.taskId);const removed=p.inputVersionRefs.filter(i=>!b.approvedInputs.some(n=>n.id===i.id)).map(i=>i.id);p.inputVersionRefs=b.approvedInputs;
    for(const s of p.steps){const lost=s.inputRefs.filter(id=>removed.includes(id));s.inputRefs=s.inputRefs.filter(id=>!removed.includes(id));if(lost.length)p.cognition.missing.push({id:('source-'+s.id) as any,question:'Source withdrawn; reselect method inputs / 来源已撤回，请重新指定本步骤输入',blocks:[s.id]});}
    p.constraints.process=[...new Set([...p.constraints.process,...b.conditions])];
    for(const f of p.cognition.facts){if(f.evidence.length&&removed.length){f.evidence=[];f.confirmed=false;}}
  }
  await window.materialsx.reviseAgentPlan(p.task.taskId,props.plan.planRevision,p);
  const actual=await window.materialsx.getResearchPlan(p.task.taskId);if(actual&&props.plan.task.taskId===p.task.taskId)emit('updated',actual);editing.value=false;
}catch(e){error.value=String(e);}finally{busy.value=false;}}
</script>
<template>
  <div class="plan-edit">
    <button type="button" class="edit-toggle" :aria-expanded="editing" @click="editing=!editing">{{editing?t('收起修改表单','Close editor'):t('修改目标与条件','Edit goal and conditions')}}</button>
    <div v-if="editing" class="edit-fields">
      <label>{{t('材料体系','Material system')}}<input v-model="draft.goal.materialSystem" /></label>
      <label>{{t('研究问题','Research question')}}<textarea v-model="draft.goal.problemType" rows="3" /></label>
      <label>{{t('工艺条件（分号分隔）','Process conditions (semicolon separated)')}}<input :value="draft.constraints.process.join('; ')" @input="draft.constraints.process=($event.target as HTMLInputElement).value.split(';').map(v=>v.trim()).filter(Boolean)" /></label>
      <div v-for="(m,i) in draft.goal.metrics" :key="i" class="metric-edit"><label>{{m.name}}<input v-model.number="m.value" type="number" /></label><label>{{t('原单位','Original unit')}}<input v-model="m.unit" /></label><label>{{t('测试条件','Test condition')}}<input v-model="m.condition" /></label></div>
      <label v-for="m in draft.cognition.missing" :key="m.id" class="resolved"><input v-model="resolved" type="checkbox" :value="m.id" />{{t('已补充：','Supplied: ')}}{{m.question}}</label>
      <label class="resolved"><input v-model="refreshInputs" type="checkbox"/>{{t('同步当前项目输入版本（已撤回来源会阻断相关步骤）','Use current project input revision (withdrawn sources block dependent steps)')}}</label>
      <label>{{t('补充信息 / 修改原因','Additional information / Reason')}}<textarea v-model="note" rows="3" /></label>
      <p class="field-help">{{t('保存后会生成新的计划版本。受影响的步骤和结果需要重新核对；原有权限和任务时限仍然有效。','Saving creates a new plan revision. Review affected steps and results; existing permissions and task deadline remain in effect.')}}</p>
      <button class="primary-button" :disabled="busy" @click="save">{{t('保存新版本','Save revision')}}</button>
    </div>
    <p v-if="error" role="alert">{{error}}</p>
  </div>
</template>
<style scoped>
.plan-edit{min-width:0;margin-top:18px;padding-top:15px;border-top:1px solid var(--line-soft);color:var(--text)}
.edit-toggle{padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--text);font:inherit;font-size:12px;font-weight:600;cursor:pointer}.edit-toggle:hover{background:var(--panel-2)}.edit-toggle:focus-visible,.edit-fields :is(input,textarea,button):focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.edit-fields{display:grid;gap:14px;min-width:0;margin-top:14px;padding:17px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
.edit-fields label{display:grid;gap:6px;min-width:0;color:var(--text);font-size:12px;font-weight:600}
.edit-fields input,.edit-fields textarea{box-sizing:border-box;width:100%;min-width:0;background:var(--catalog-surface);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:9px 10px;font:inherit;font-size:13px;font-weight:400;line-height:1.5}
.metric-edit{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.edit-fields .resolved{display:flex;align-items:flex-start;line-height:1.6;font-weight:400}.resolved input{width:auto;margin:4px 8px 0 0}
.edit-fields .field-help{margin:0;color:var(--muted);font-size:11px;line-height:1.65}.edit-fields .primary-button{justify-self:start}
[role=alert]{color:var(--danger);overflow-wrap:anywhere}
@media(max-width:600px){.metric-edit{grid-template-columns:1fr}}
</style>
