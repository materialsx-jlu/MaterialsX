<script setup lang="ts">
import PotentialModelActions from './PotentialModelActions.vue';
import ExamplePrompts from './ExamplePrompts.vue';
import { computed, ref, shallowRef, onMounted, onUnmounted, watch } from 'vue';
import { Atom, ArrowRight, ExternalLink } from '@lucide/vue';
import { ElDrawer } from 'element-plus';
import type { PotentialCatalog, HubEntry } from '../../../../../packages/contracts/src/potential-hub.js';
import { matchCatalogEntries } from '../../../../../packages/atomistic/src/potential-hub.js';
import type {PotentialModelState} from '../../../../../packages/contracts/src/catalog-weights.js';
const props=defineProps<{catalog:PotentialCatalog|null;locale:'zh'|'en';search:string}>();
const emit=defineEmits<{'use-example':[prompt:string];'open-source':[id:string];'manage':[id:string]}>();
const live=shallowRef<PotentialModelState[]>([]),runtimeError=ref(false),loading=ref(true);
let refreshing=false,refreshQueued=false,disposed=false,frame=0;
async function refresh(){if(disposed)return;if(refreshing){refreshQueued=true;return;}refreshing=true;try{const states=await window.materialsx.getPotentialModelStates();if(!disposed){live.value=states;runtimeError.value=false;}}catch{if(!disposed)runtimeError.value=true;}finally{refreshing=false;loading.value=false;if(refreshQueued){refreshQueued=false;void refresh();}}}
let detach:()=>void=()=>{},timer:ReturnType<typeof setInterval>;
onMounted(()=>{frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>void refresh());});detach=window.materialsx.onPotentialModelChanged(()=>void refresh());window.addEventListener('materialsx:packages-changed',refresh);timer=setInterval(()=>{if(live.value.some(s=>s.state==='downloading'||s.state==='loading'))void refresh();},1200);});
onUnmounted(()=>{disposed=true;cancelAnimationFrame(frame);detach();clearInterval(timer);window.removeEventListener('materialsx:packages-changed',refresh);});
const category=ref('all'),family=ref('all'),type=ref('all'),status=ref('all'),page=ref(0),selected=ref<HubEntry|null>(null);
const visible=computed({get:()=>!!selected.value,set:(v:boolean)=>{if(!v)selected.value=null;}});
const t=(zh:string,en:string)=>props.locale==='zh'?zh:en;
const types:Record<string,[string,string]>={checkpoint:['具体权重','Checkpoint'],family:['模型系列','Model family'],architecture:['研究架构','Architecture'],training_framework:['训练框架','Training framework'],descriptor:['描述符','Descriptor'],engine:['模拟引擎','Engine'],workflow:['工作流','Workflow'],property_model:['性质模型','Property model'],commercial_service:['商业服务','Commercial service'],classical_forcefield:['经典力场','Classical force field'],repository:['资源数据库','Repository'],interop:['互操作接口','Interoperability']};
const categories:Record<string,[string,string]>={materials:['无机材料','Inorganic materials'],molecules:['分子与生物体系','Molecules & biomolecular'],catalysis:['催化与表面','Catalysis & surfaces'],specialized:['专用势方法','Specialized methods'],physics:['特殊物理','Extended physics'],properties:['性质预测','Property prediction'],resources:['相关工具与资源','Tools & resources']};
const label=(map:Record<string,[string,string]>,key:string)=>map[key]?.[props.locale==='zh'?0:1]??key;
const stateIndex=computed(()=>new Map(live.value.map(r=>[r.potentialId,r])));
const modelState=(e:HubEntry)=>stateIndex.value.get(e.id)??null;
const installed=(e:HubEntry)=>!!modelState(e)?.canLoad;
const downloaded=(e:HubEntry)=>['downloaded','installed','ready','disabled'].includes(modelState(e)?.state??'');
const downloadable=(e:HubEntry)=>!!modelState(e)?.canDownload;
const connected=(e:HubEntry)=>!!modelState(e)?.supported;
const entries=computed(()=>props.catalog?.entries??[]);
const families=computed(()=>[...new Set(entries.value.map(e=>e.family))].sort());
const matched=computed(()=>{
 if(!props.catalog)return [];
 const all=matchCatalogEntries(props.catalog,{query:props.search,...(family.value==='all'?{}:{family:family.value}),...(category.value==='all'?{}:{category:category.value}),...(type.value==='all'?{}:{entityType:type.value})});
 return all.filter(e=>status.value==='all'||status.value==='connected'&&connected(e)||status.value==='installed'&&installed(e)||status.value==='downloaded'&&downloaded(e)||status.value==='downloadable'&&downloadable(e)||status.value==='review'&&e.execution.state==='needs_review'||status.value==='paper'&&e.entityType==='architecture'||status.value==='adapter'&&!connected(e)&&['checkpoint','family'].includes(e.entityType));
});
const pages=computed(()=>Math.max(1,Math.ceil(matched.value.length/24))),cards=computed(()=>matched.value.slice(page.value*24,(page.value+1)*24));
watch([()=>props.search,category,family,type,status],()=>page.value=0);
watch(pages,n=>{page.value=Math.min(page.value,n-1);});
const counts=computed(()=>({checkpoints:entries.value.filter(e=>e.entityType==='checkpoint').length,families:entries.value.filter(e=>e.entityType==='family').length,downloadable:entries.value.filter(downloadable).length,downloaded:entries.value.filter(downloaded).length,resources:entries.value.filter(e=>!['checkpoint','family','architecture'].includes(e.entityType)).length,connected:entries.value.filter(connected).length,installed:entries.value.filter(installed).length,sources:new Set(entries.value.flatMap(e=>e.sources.map(s=>s.url))).size}));
const siblings=computed(()=>entries.value.filter(e=>e.family===selected.value?.family&&e.id!==selected.value?.id));
const unknown=()=>t('待核实','Unknown');
const valueLabel=(v:string)=>props.locale==='en'?v:({yes:'是',no:'否',unknown:'待核实',required:'必填',unsupported:'不支持',optional:'可选',single:'单头',multiplicity:'自旋多重度',per_atom:'逐原子',model_specific:'模型特定',all_atom:'全原子',coarse_grained:'粗粒化',virtual_sites:'虚拟位点',energy_gradient:'能量梯度',direct_force:'直接力',other:'其他',active:'维护中',archived:'已归档',discontinued:'停止维护',public:'公开',gated:'需申请',commercial:'商业授权',standalone:'独立势',baseline:'基线',correction:'修正',composite:'组合势',pinned:'冻结来源',documented:'资料定位',candidate:'候选来源'} as Record<string,string>)[v]??v;
const evidence=computed(()=>selected.value?Object.entries(selected.value.fieldEvidence):[]);
function example(prompt:string){selected.value=null;emit('use-example',prompt);}
function state(e:HubEntry){if(loading.value&&e.entityType==='checkpoint')return t('检查安装状态…','Checking installation…');if(e.execution.blockers.includes("POTENTIAL_WITHDRAWN"))return t("已撤回 · 禁止新计算","Withdrawn · new calculations blocked");return installed(e)?t('可计算 · 权重与环境就绪','Ready to compute'):downloaded(e)?t('已下载 · 计算环境或适配待就绪','Downloaded · environment or adapter pending'):downloadable(e)?t('可下载权重','Checkpoint available for download'):connected(e)?t('已适配 · 查看安装状态','Integrated · check installation'):e.execution.state==='not_a_potential'?t('相关资源 · 非可执行势','Related resource · not executable'):e.execution.state==='commercial'?t('商业服务 · 未接入','Commercial service · not integrated'):t('已收录 · 暂不可运行','Listed · not yet runnable');}
</script>
<template>
 <div class="potential-registry" data-testid="potential-registry">
  <div class="hub-summary" data-testid="hub-summary"><div class="registry-heading"><strong>{{t('全部势与相关资源','All potentials & related resources')}}</strong><button class="skill-example-copy" @click="refresh">{{t('刷新安装状态','Refresh status')}}</button></div><p>{{counts.checkpoints}} {{t('个模型权重','checkpoints')}} · {{counts.families}} {{t('个模型系列','model families')}} · {{counts.resources}} {{t('项相关资源','related resources')}}</p><p v-if="loading" role="status">{{t('正在检查本机安装状态…','Checking local installation status…')}}</p><p v-else>{{counts.connected}} {{t('个已接入计算','integrated calculators')}} · {{counts.installed}} {{t('个本机可计算','ready to compute')}}</p><details><summary>{{t('目录说明与版本','About this catalog')}}</summary><p>{{catalog?.releaseId}} · {{catalog?.reviewedAt.slice(0,10)}}</p><p>{{catalog?.scope[locale]}}</p><p>{{t('能力说明来自所列来源，不代表本机精度验证。模型系列、架构与工具没有可直接下载的模型文件。','Capabilities are based on listed sources and do not establish local accuracy. Families, architectures and tools are not downloadable models.')}}</p></details></div>
  <div class="catalog-filters install-filters" :aria-label="t('下载和计算状态','Download and compute status')"><button :class="{active:status==='connected'}" @click="status=status==='connected'?'all':'connected'">{{t('已适配计算','Compute adapters')}} <span>{{counts.connected}}</span></button><button :class="{active:status==='installed'}" @click="status=status==='installed'?'all':'installed'">{{t('本机可计算','Ready to compute')}} <span>{{counts.installed}}</span></button><button :class="{active:status==='downloadable'}" @click="status=status==='downloadable'?'all':'downloadable'">{{t('可下载','Downloadable')}} <span>{{counts.downloadable}}</span></button><button :class="{active:status==='downloaded'}" @click="status=status==='downloaded'?'all':'downloaded'">{{t('已下载','Downloaded')}} <span>{{counts.downloaded}}</span></button></div>
  <p class="registry-note">{{t('先查看模型的适用材料与计算任务，再安装使用。目录收录不代表已安装；计算前会检查模型、结构和运行环境。','Check each model’s materials and supported tasks before installing. Listed models may not be installed; model, structure and environment checks run before calculation.')}}</p>
  <div v-if="runtimeError" class="model-directory-notice" role="status">{{t('本机运行状态暂不可用，目录仍可离线浏览。','Local runtime status unavailable; the catalog remains browsable offline.')}}</div>
  <div class="catalog-filters" :aria-label="t('科学领域','Research domains')"><button :class="{active:category==='all'}" @click="category='all'">{{t('全部','All')}} <span>{{entries.length}}</span></button><button v-for="(labels,key) in categories" :key="key" :class="{active:category===key}" @click="category=key">{{labels[locale==='zh'?0:1]}} <span>{{entries.filter(e=>e.category===key).length}}</span></button></div>
  <div class="hub-controls">
   <label>{{t('家族/来源组','Family / source group')}}<select v-model="family" data-testid="hub-family"><option value="all">{{t('全部家族','All families')}}</option><option v-for="f in families" :key="f" :value="f">{{f}} · {{entries.filter(e=>e.family===f).length}}</option></select></label>
   <label>{{t('资源类型','Resource type')}}<select v-model="type" data-testid="hub-type"><option value="all">{{t('全部类型','All types')}}</option><option v-for="(labels,key) in types" :key="key" :value="key">{{labels[locale==='zh'?0:1]}}</option></select></label>
   <label>{{t('状态','Status')}}<select v-model="status" data-testid="hub-status"><option value="all">{{t('全部状态','All states')}}</option><option value="connected">{{t('已接入计算','Integrated calculators')}}</option><option value="downloadable">{{t('可下载权重','Downloadable checkpoints')}}</option><option value="downloaded">{{t('已下载权重','Downloaded checkpoints')}}</option><option value="installed">{{t('本机可计算','Ready to compute')}}</option><option value="review">{{t('待核实','Needs review')}}</option><option value="paper">{{t('研究架构/方法','Research architectures')}}</option><option value="adapter">{{t('待适配','Adapter pending')}}</option></select></label>
  </div>
  <div class="catalog-grid" data-testid="hub-grid"><button v-for="e in cards" :key="e.id" :data-id="e.id" class="catalog-card" @click="selected=e"><div class="catalog-icon"><Atom :size="18" /></div><div class="catalog-content"><strong>{{e.name}}</strong><p :lang="locale==='zh'?'zh-CN':'en'">{{e.description[locale]}}</p><span>{{e.family}} · {{label(types,e.entityType)}} · {{e.capabilities.functional??unknown()}}</span></div><ArrowRight class="catalog-open-icon" :size="15"/><div class="model-catalog-status">{{state(e)}}<span class="hub-card-action">{{connected(e)||downloadable(e)||downloaded(e)?t('下载与运行 →','Download & run →'):t('查看详情 →','View details →')}}</span></div></button></div>
  <div v-if="!matched.length" class="empty-list">{{t('没有匹配条目；请调整名称、分类或状态筛选。','No matches; adjust the name, category or state filters.')}}</div>
  <div class="hub-pagination" data-testid="hub-pagination"><button class="secondary-button" :disabled="page===0" @click="page--">{{t('上一页','Previous')}}</button><span>{{matched.length}} {{t('条','entries')}} · {{page+1}} / {{pages}}</span><button class="secondary-button" :disabled="page+1>=pages" @click="page++">{{t('下一页','Next')}}</button></div>
  <el-drawer v-model="visible" direction="rtl" size="min(560px, 100vw)" :with-header="false" class="model-details-drawer">
   <div v-if="selected" data-testid="hub-details">
    <div class="skill-detail-heading"><div class="skill-detail-title"><span class="skill-detail-icon"><Atom :size="21"/></span><div><span class="eyebrow">{{label(types,selected.entityType)}}</span><h2>{{selected.name}}</h2></div></div><button class="icon-button" :aria-label="t('关闭势详情','Close potential details')" @click="selected=null">×</button></div>
    <div class="model-directory-notice">{{state(selected)}} · {{t('领域精度未由此目录验收','Domain accuracy is not validated by this catalog')}}</div>
    <section class="skill-detail-section"><p class="skill-detail-description">{{selected.description[locale]}}</p></section>
    <PotentialModelActions v-if="modelState(selected)" :key="selected.id" :entry="selected" :state="modelState(selected)" :locale="locale" @refresh="refresh" @analyze="emit('manage',$event);selected=null"/>
    <section class="skill-detail-section"><strong>{{t('使用例子','Usage examples')}}</strong><ExamplePrompts :examples="selected.examples" :locale="locale" @use="example"/></section>
    <details class="skill-detail-section potential-capabilities"><summary>{{t('能力、权重与环境信息','Capabilities, checkpoint & environment')}}</summary>
    <section class="skill-detail-meta potential-meta">
     <div><span>ID / {{t('类型','Type')}}</span><strong>{{selected.id}} / {{label(types,selected.entityType)}}</strong></div>
     <div><span>{{t('别名','Aliases')}}</span><strong>{{selected.aliases.join(', ')||'—'}}</strong></div>
     <div><span>{{t('声明输出','Declared outputs')}}</span><strong>E: {{valueLabel(selected.capabilities.energy)}} · F: {{valueLabel(selected.capabilities.forces)}} · S: {{valueLabel(selected.capabilities.stress)}}</strong></div>
     <div><span>{{t('力/能量关系','Force / energy relation')}}</span><strong>{{valueLabel(selected.capabilities.forceRelation)}}</strong></div>
     <div><span>{{t('元素 / 边界','Elements / boundaries')}}</span><strong>{{selected.capabilities.elements?.join(', ')??unknown()}} / {{selected.capabilities.periodicity.join(', ')||unknown()}}</strong></div>
     <div><span>{{t('理论 / 数据集','Theory / dataset')}}</span><strong>{{selected.capabilities.functional??unknown()}} / {{selected.capabilities.dataset??unknown()}}</strong></div>
     <div><span>{{t('输出单位 / 温压范围','Output units / temperature-pressure ranges')}}</span><strong>{{Object.values(selected.capabilities.units).map(u=>u??'?').join(' / ')}} · {{selected.capabilities.temperatureK?.join('–')??unknown()}} K / {{selected.capabilities.pressureGPa?.join('–')??unknown()}} GPa</strong></div>
     <div><span>{{t('头/模态','Heads / modalities')}}</span><strong>{{valueLabel(selected.capabilities.headPolicy)}} · {{selected.capabilities.heads.map(h=>`${h.name} (${h.functional??'?'})`).join(', ')||unknown()}}</strong></div>
     <div><span>{{t('电荷 / 自旋语义','Charge / spin semantics')}}</span><strong>{{valueLabel(selected.capabilities.charge)}} / {{valueLabel(selected.capabilities.spin.input)}} · {{valueLabel(selected.capabilities.spin.semantics)}}</strong></div>
     <div><span>{{t('粒子 / cutoff','Particles / cutoff')}}</span><strong>{{valueLabel(selected.capabilities.particleSemantics)}} / {{selected.capabilities.cutoffAngstrom===null?unknown():`${selected.capabilities.cutoffAngstrom} Å`}}</strong></div>
     <div><span>{{t('长程 / 组合项','Long range / components')}}</span><strong>{{selected.capabilities.longRange.join(', ')||unknown()}} · {{valueLabel(selected.capabilities.compositionRole)}} · {{selected.capabilities.requiredComponents.join(', ')||'—'}}</strong></div>
     <div><span>{{t('权重身份与大小','Weight identity / size')}}</span><strong>{{selected.asset.revision??unknown()}}<br/>{{selected.asset.sha256??unknown()}}<br/>{{selected.asset.bytes===null?unknown():`${(selected.asset.bytes/1048576).toFixed(2)} MiB`}}</strong></div>
     <div><span>{{t('代码 / 权重 / 数据许可','Code / weight / data licenses')}}</span><strong>{{selected.licenses.code??unknown()}} / {{selected.licenses.weights??unknown()}} / {{selected.licenses.trainingData??unknown()}}</strong></div>
     <div><span>{{t('维护 / 访问','Maintenance / access')}}</span><strong>{{valueLabel(selected.maintenance)}} / {{valueLabel(selected.access)}}</strong></div>
     <div><span>{{t('适配 / 环境','Adapter / environment')}}</span><strong>{{selected.execution.adapter??unknown()}} / {{selected.execution.profileId??unknown()}}</strong></div>
     <div><span>{{t('空间 / 内存估计','Disk / memory estimate')}}</span><strong>{{selected.execution.diskEstimateMiB??unknown()}} / {{selected.execution.memoryEstimateMiB??unknown()}} MiB</strong></div>
     <div><span>{{t('平台 / 设备工程验收记录','Platform / device engineering checks')}}</span><strong>{{selected.execution.platforms.map(p=>`${p.platform} / ${p.device}: ${p.status}`).join('; ')||unknown()}}</strong></div>
     <div><span>{{t('接入阶段 / 阻塞原因','Integration stage / blockers')}}</span><strong>{{selected.nextStage}} / {{selected.execution.blockers.join(', ')}}</strong></div>
    </section></details>
    <section class="skill-detail-section"><strong>{{t('来源与字段证据','Sources & field evidence')}}</strong><p v-for="s in selected.sources" :key="s.id" class="skill-detail-description">{{s.id}} · {{valueLabel(s.status)}}<br/><span class="hub-url">{{s.url}}</span><br/>{{s.note[locale]}}</p><details><summary>{{t('字段来源映射','Field source mapping')}} ({{evidence.length}})</summary><p v-for="[field,refs] in evidence" :key="field" class="skill-detail-description">{{field}} → {{refs.join(', ')}}</p><p v-if="!evidence.length" class="skill-detail-description">{{t('具体科学能力未核实，不提供自动运行资格。','Specific scientific capabilities are unverified; no automatic run eligibility.')}}</p></details></section>
    <section class="skill-detail-section"><strong>{{t('限制','Limitations')}}</strong><p v-for="(l,i) in selected.limitations" :key="i" class="skill-detail-description">{{l[locale]}}</p></section>

    <section v-if="siblings.length" class="skill-detail-section"><strong>{{t('同家族系列与具体版本','Related family series & versions')}}</strong><div class="hub-siblings"><button v-for="e in siblings" :key="e.id" class="skill-example-copy" @click="selected=e">{{e.name}} · {{label(types,e.entityType)}}</button></div></section>
    <div class="skill-detail-actions"><button v-if="connected(selected)" class="secondary-button" @click="emit('manage',selected.id);selected=null">{{t('选择结构并分析','Choose a structure to analyze')}}</button><button class="secondary-button" @click="selected=null">{{t('关闭','Close')}}</button><button class="primary-button" @click="emit('open-source',selected.id)">{{t('查看来源','Open source')}} <ExternalLink :size="14"/></button></div>
   </div>
  </el-drawer>
 </div>
</template>
<style scoped>
.hub-card-action{float:right;font-size:11px;color:var(--text);margin-left:8px}.install-filters{margin:16px 0}.potential-capabilities summary{font-size:12px;color:var(--muted);cursor:pointer}.potential-capabilities .potential-meta{margin-top:14px}.registry-heading{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.registry-note{margin:12px 0 20px;font-size:12px;color:var(--muted);line-height:1.7}.hub-summary details{font-size:11px;color:var(--dim);line-height:1.7}.hub-summary summary{cursor:pointer}
.hub-summary { max-width:1120px; margin:16px auto; padding:16px; border:1px solid var(--line); border-radius:9px; background:var(--catalog-surface); color:var(--text); }
.hub-summary p { color:var(--muted); font-size:12px; line-height:1.7; }
.hub-summary small { color:var(--dim); line-height:1.7; overflow-wrap:anywhere; }
.hub-controls { display:flex; flex-wrap:wrap; gap:12px; max-width:1120px; margin:14px auto; }
.hub-controls label { display:grid; gap:6px; color:var(--muted); font-size:11px; flex:1; min-width:160px; }
.hub-controls select { border:1px solid var(--line); border-radius:7px; color:var(--text); background:var(--catalog-surface); padding:8px; min-width:0; width:100%; }
.hub-pagination { display:flex; justify-content:center; align-items:center; gap:14px; margin:18px 0; color:var(--muted); font-size:12px; }
.hub-pagination button:disabled { opacity:.4; cursor:default; }
.potential-meta strong,.hub-url { overflow-wrap:anywhere; font-size:12px; }
.hub-siblings { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.skill-detail-title h2 { white-space:normal; overflow-wrap:anywhere; }
.catalog-content strong { white-space:normal; overflow-wrap:anywhere; }
@media(max-width:760px){.catalog-grid{grid-template-columns:minmax(0,1fr)}.potential-meta div{flex-wrap:wrap}.potential-meta strong{max-width:100%;text-align:left}}
</style>
