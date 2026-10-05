<script setup lang="ts">
import {reactive} from 'vue';
import type {ExperimentDataset,ExperimentConfig,ExperimentConfigInput} from '../../../../../packages/contracts/src/experiments.js';
const props=defineProps<{dataset:ExperimentDataset;current:ExperimentConfig|undefined;locale:'zh'|'en';busy:boolean}>();
const emit=defineEmits<{save:[input:ExperimentConfigInput];cancel:[]}>();
const t=(zh:string,en:string)=>props.locale==='zh'?zh:en;
const form=reactive<ExperimentConfigInput>(props.current?JSON.parse(JSON.stringify(props.current.input)):{
  datasetId:props.dataset.id,expectedRevision:0,specimenId:'',mode:'stress-strain',xColumn:props.dataset.columns[0]!,yColumn:props.dataset.columns[1]!,
  xUnit:'1',yUnit:'MPa',areaMm2:0,gaugeLengthMm:null,strainSource:'reported',conditions:'',acquisition:'measured',digitizationUncertainty:null,
  elasticRegionConfirmed:false,fitRange:[0,.002],exclusions:[]});
form.expectedRevision=props.current?.revision??0;
function mode(){form.xUnit=form.mode==='stress-strain'?'1':'mm';form.yUnit=form.mode==='stress-strain'?'MPa':'N';form.strainSource=form.mode==='stress-strain'?'reported':'crosshead';form.elasticRegionConfirmed=false;}
function submit(){emit('save',JSON.parse(JSON.stringify(form)));}
</script>
<template>
<form class="experiment-form" data-testid="experiment-editor" @submit.prevent="submit">
  <header><div><h3>{{t('分析设置','Analysis settings')}}</h3><p>{{dataset.title}} · {{t('设置版本','Configuration revision')}} {{form.expectedRevision+1}}</p></div><button type="button" class="secondary-button" :disabled="busy" @click="emit('cancel')">{{t('取消','Cancel')}}</button></header>
  <div class="grid">
    <label>{{t('试样编号','Specimen ID')}}<input v-model="form.specimenId" data-testid="specimen-id" required maxlength="2000"/></label>
    <label>{{t('原始数据类型','Input quantities')}}<select v-model="form.mode" @change="mode"><option value="stress-strain">{{t('工程应力—应变','Engineering stress–strain')}}</option><option value="force-displacement">{{t('力—位移','Force–displacement')}}</option></select></label>
    <label>{{t('应变 / 位移列','Strain / displacement column')}}<select v-model="form.xColumn"><option v-for="c in dataset.columns" :key="c">{{c}}</option></select></label>
    <label>{{t('原始横轴单位','Original X unit')}}<select v-model="form.xUnit"><option v-for="u in form.mode==='stress-strain'?['1','%']:['mm','m']" :key="u">{{u}}</option></select></label>
    <label>{{t('应力 / 力列','Stress / force column')}}<select v-model="form.yColumn"><option v-for="c in dataset.columns" :key="c">{{c}}</option></select></label>
    <label>{{t('原始纵轴单位','Original Y unit')}}<select v-model="form.yUnit"><option v-for="u in form.mode==='stress-strain'?['Pa','MPa','GPa']:['N','kN']" :key="u">{{u}}</option></select></label>
    <label>{{t('初始截面积 (mm²)','Initial cross-section (mm²)')}}<input v-model.number="form.areaMm2" data-testid="area" type="number" min="0.0000001" max="1000000000" step="any" required/></label>
    <label>{{t('初始标距 (mm)','Initial gauge length (mm)')}}<input :value="form.gaugeLengthMm??''" type="number" min="0.0000001" max="10000000" step="any" :required="form.mode==='force-displacement'" @input="form.gaugeLengthMm=($event.target as HTMLInputElement).value?Number(($event.target as HTMLInputElement).value):null"/></label>
    <label>{{t('应变测量来源','Strain measurement')}}<select v-model="form.strainSource"><option value="reported">{{t('已报告应变（测量方式未确认）','Reported strain (measurement unconfirmed)')}}</option><option value="extensometer">{{t('试样引伸计','Specimen extensometer')}}</option><option value="dic">DIC</option><option value="crosshead">{{t('横梁位移（表观刚度）','Crosshead (apparent stiffness)')}}</option></select></label>
    <label>{{t('数据来源','Acquisition')}}<select v-model="form.acquisition"><option value="measured">{{t('实测原始记录','Measured records')}}</option><option value="digitized">{{t('图像数字化','Digitized image')}}</option></select></label>
    <label>{{t('拟合起点（无量纲应变）','Fit start (dimensionless strain)')}}<input v-model.number="form.fitRange[0]" data-testid="fit-start" type="number" min="0" step="any" required/></label>
    <label>{{t('拟合终点（无量纲应变）','Fit end (dimensionless strain)')}}<input v-model.number="form.fitRange[1]" data-testid="fit-end" type="number" min="0.00000001" step="any" required/></label>
  </div>
  <label>{{t('测试条件（标准、温度、速率、方向、设备等）','Test conditions (standard, temperature, rate, direction, instrument)')}}<textarea v-model="form.conditions" data-testid="test-conditions" required maxlength="2000" rows="3"/></label>
  <label v-if="form.acquisition==='digitized'">{{t('数字化误差说明（必填）','Digitization uncertainty (required)')}}<textarea :value="form.digitizationUncertainty??''" required maxlength="2000" @input="form.digitizationUncertainty=($event.target as HTMLTextAreaElement).value||null"/></label>
  <label class="check"><input v-model="form.elasticRegionConfirmed" type="checkbox"/>{{t('已人工确认此区间为弹性段；只有实测试样引伸计或 DIC 数据才赋予拟合杨氏模量','I confirm an elastic interval; fitted Young’s modulus is assigned only for measured specimen extensometer or DIC data')}}</label>
  <div class="exclusions"><div class="actions"><strong>{{t('剔除原始行','Exclude original rows')}}</strong><button type="button" class="secondary-button" @click="form.exclusions.push({row:2,reason:''})">{{t('添加剔除记录','Add exclusion')}}</button></div><p>{{t('保留原始值和行号。非数值、异常点只有填写原因后才可剔除。','Original values and row IDs are preserved. Excluding invalid or anomalous points requires a reason.')}}</p>
    <div v-for="(e,i) in form.exclusions" :key="i" class="exclusion-row"><input v-model.number="e.row" type="number" min="2" max="100002" required :aria-label="t('原始行号','Original row')"/><input v-model="e.reason" required maxlength="2000" :placeholder="t('剔除原因','Reason for exclusion')"/><button type="button" class="secondary-button" @click="form.exclusions.splice(i,1)">{{t('移除','Remove')}}</button></div>
  </div>
  <p>{{t('拟合区间至少包含 3 个有效点。单条曲线的点不是重复试验；不会自动计算屈服强度、断裂应变或修正零点。','The fit needs at least three valid points. Curve points are not replicate tests. Yield, fracture strain and zero corrections are not inferred.')}}</p>
  <button class="primary-button" data-testid="save-experiment-config" :disabled="busy">{{t('检查并保存设置','Check & save settings')}}</button>
</form>
</template>
<style scoped>
.experiment-form{display:grid;gap:16px;min-width:0}.experiment-form header,.actions{display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap}.experiment-form h3{margin:0}.experiment-form p{color:var(--muted);font-size:13px;line-height:1.7}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}label{display:grid;gap:7px;font-size:13px;min-width:0}input,select,textarea{box-sizing:border-box;width:100%;min-width:0;background:var(--panel);color:var(--text);border:1px solid var(--line);padding:10px;border-radius:8px;font:inherit}.check{display:flex;align-items:flex-start;line-height:1.7}.check input{width:auto;margin-top:4px}.exclusions{padding:16px;border:1px solid var(--line);border-radius:10px}.exclusion-row{display:grid;grid-template-columns:100px minmax(0,1fr) auto;gap:10px;margin-top:10px}@media(max-width:780px){.grid{grid-template-columns:1fr}.exclusion-row{grid-template-columns:90px minmax(0,1fr)}.exclusion-row button{grid-column:2}}
</style>
