<script setup lang="ts">
import {computed,onMounted,ref} from 'vue';
import {Search,RefreshCw,FlaskConical,Atom,ArrowRight,Server,Monitor} from '@lucide/vue';
import type {ModelSettings,SkillSummary,ResearchModelSummary,AccountSnapshot} from '../../../../../packages/contracts/src/desktop.js';
import type {billingActivitySchema,WorkspaceStatus,CloudCatalog,TaskBill,AlphaRequest,ReleaseEntry} from '../../../../../packages/contracts/src/platform.js';
import type {z} from 'zod';
import {usePreferences} from '../../../../../packages/ui/src/preferences.js';
import AccountPanel from './AccountPanel.vue';
import SupportPanel from './SupportPanel.vue';
import CreditWalletPanel from './CreditWalletPanel.vue';
import PaymentPanel from './PaymentPanel.vue';
const props=defineProps<{settings:ModelSettings;skills:SkillSummary[];models:ResearchModelSummary[]}>();
const emit=defineEmits<{chat:[];skill:[SkillSummary,'zh'|'en'];model:[ResearchModelSummary,'zh'|'en'];example:[string];settings:[]}>();
const {locale,t}=usePreferences();
const tab=ref('agent'),query=ref(''),category=ref('all'),resource=ref<'skills'|'models'>('skills'),supplierOpen=ref(false),buyOpen=ref(false);
const activity=ref<z.infer<typeof billingActivitySchema>|null>(null);
const activityMax=computed(()=>Math.max(1,...(activity.value?.items.map(d=>d.requests)??[])));
const status=ref<WorkspaceStatus|null>(null),catalog=ref<CloudCatalog|null>(null),bills=ref<TaskBill[]>([]),cursor=ref<string|null>(null),selected=ref<TaskBill|null>(null),requests=ref<AlphaRequest[]>([]),releases=ref<ReleaseEntry[]>([]),account=ref<AccountSnapshot|null>(null),busy=ref(false),error=ref(''),walletVersion=ref(0);
const tabs=computed(()=>[{id:'agent',label:'Agent'},{id:'providers',label:t('供应商','Providers')},{id:'gateway',label:t('网关','Gateway')},{id:'routes',label:t('路由','Routes')},{id:'usage',label:t('用量','Usage')},{id:'resources',label:t('资源库','Resources')}]);
async function refresh(){if(busy.value)return;busy.value=true;error.value='';status.value=null;catalog.value=null;activity.value=null;bills.value=[];selected.value=null;requests.value=[];releases.value=[];try{account.value=await window.materialsx.getAccount();const [s,c,b,r,a]=await Promise.all([window.materialsx.getWorkspaceStatus(),window.materialsx.getCloudCatalog(),window.materialsx.getTaskBills(),window.materialsx.getReleaseCatalog(),window.materialsx.getBillingActivity()]);activity.value=a;status.value=s;catalog.value=c;bills.value=b.items;cursor.value=b.nextCursor;releases.value=r.items.filter(v=>v.state==='published')}catch{cursor.value=null;error.value=t('云端数据不可读取，请确认登录和服务连接。本地模型与内置资源仍可使用。','Cloud data unavailable. Check sign-in and service connectivity. Local models and bundled resources remain available.')}finally{busy.value=false}}
async function detail(b:TaskBill){busy.value=true;selected.value=b;requests.value=[];try{requests.value=await window.materialsx.getTaskRequests(b.id)}catch{error.value=t('无法读取任务明细，请刷新。','Task details unavailable. Refresh to retry.')}finally{busy.value=false}}
async function more(){if(!cursor.value||busy.value)return;busy.value=true;try{const page=await window.materialsx.getTaskBills(cursor.value);bills.value.push(...page.items);cursor.value=page.nextCursor}catch{error.value=t('账单读取失败','Unable to load bills')}finally{busy.value=false}}
async function exportBills(){if(busy.value)return;busy.value=true;try{let next:string|undefined;do{const page=await window.materialsx.exportTaskBills(next);if(!page.saved)return;next=page.nextCursor??undefined;if(next&&!confirm(t('继续导出下一页？每页最多50个任务。','Export the next page? Up to 50 tasks per page.')))return}while(next)}catch{error.value=t('导出失败，请重试','Export failed. Please retry.')}finally{busy.value=false}}
async function download(url:string){try{await window.materialsx.openReleaseDownload(url)}catch{error.value=t('此下载已不可用，请刷新版本目录。','This download is no longer available. Refresh the release catalogue.')}}
const visibleSkills=computed(()=>props.skills.filter(s=>(category.value==='all'||category.value===s.category)&&`${s.name} ${s.descriptionZh} ${s.descriptionEn}`.toLowerCase().includes(query.value.toLowerCase())));
const visibleModels=computed(()=>props.models.filter(m=>(category.value==='all'||category.value===m.category)&&`${m.name} ${m.descriptionZh} ${m.descriptionEn}`.toLowerCase().includes(query.value.toLowerCase())));
const modelLabels:Record<string,[string,string]>={atomistic:['原子尺度与势函数','Atomistic potentials'],'materials-property':['材料性质预测','Property prediction'],'materials-chat':['材料对话模型','Materials chat'],'materials-cif-generation':['晶体结构生成','Crystal generation'],'materials-language-base':['材料语言基座','Materials language base'],'materials-text':['文献文本编码','Literature encoders']};
const modelCategoryLabel=(id:string)=>modelLabels[id]?.[locale.value==='zh'?0:1]??id;
const categories=computed(()=>resource.value==='skills'?[...new Map(props.skills.map(s=>[s.category,{id:s.category,label:locale.value==='zh'?s.categoryLabelZh:s.categoryLabelEn}])).values()]:[...new Set(props.models.map(m=>m.category))].map(id=>({id,label:modelCategoryLabel(id)})));
const retailRate=computed(()=>{const p=catalog.value?.paidPricing?.tiers[0];return p?`${BigInt(p.inputPerMillion)/100n} / ${BigInt(p.cachedInputPerMillion)/100n} / ${BigInt(p.outputPerMillion)/100n}`:null});
const route=computed(()=>catalog.value?.items[0]);
const state=(s:string)=>({created:t('已创建','Created'),running:t('运行中','Running'),completed:t('已完成','Completed'),cancelled:t('已停止','Stopped'),interrupted:t('已中断','Interrupted'),failed:t('失败','Failed'),unknown:t('未知','Unknown'),cancel_requested:t('停止中','Stopping'),settled:t('已结算','Settled'),reserved:t('预留中','Reserved'),released:t('已释放','Released'),reconciliation_pending:t('待核对','Pending reconciliation'),not_billed:t('不收费','Not billed')})[s]??s;
onMounted(refresh);
</script>
<template>
<section class="catalog-view platform-center" :lang="locale==='zh'?'zh-CN':'en'">
 <header class="page-heading"><div><span class="eyebrow">CLOUD WORKSPACE</span><h1>{{t('云服务中心','Cloud workspace')}}</h1><p>{{t('管理平台模型、研究用量与内置资源。','Manage platform models, research usage and bundled resources.')}}</p></div><div class="skill-page-tools"><div class="language-toggle compact" :aria-label="t('页面语言','Page language')"><button :class="{active:locale==='zh'}" @click="locale='zh'">中文</button><button :class="{active:locale==='en'}" @click="locale='en'">English</button></div><button class="secondary-button" :disabled="busy" @click="refresh"><RefreshCw :size="15" />{{t('刷新','Refresh')}}</button></div></header>
 <nav class="catalog-filters" aria-label="Cloud workspace"><button v-for="item in tabs" :key="item.id" :class="{active:tab===item.id}" @click="tab=item.id">{{item.label}}</button></nav>
 <div class="catalog-page-body">
 <p class="notice">{{t('当前为测试阶段，正式收款未开启。平台密钥保存在服务端。','Test stage. Live sales are disabled. Supplier credentials remain on the server.')}}</p>
 <p v-if="status?.controls.cloudPaused||status?.controls.salesPaused" class="notice">{{status.controls.cloudPaused?t('新云调用已暂停。','New cloud requests are paused.'):''}} {{status.controls.salesPaused?t('新订单已暂停。','New orders are paused.'):''}}</p>
 <p v-if="status&&(status.controls.announcementZh||status.controls.announcementEn)" class="notice">{{locale==='zh'?status.controls.announcementZh:status.controls.announcementEn}}</p>
 <p v-if="error" class="notice error" role="status">{{error}}</p>
 <div v-if="tab==='agent'" class="workspace-grid">
  <article class="catalog-panel"><h2>Agent</h2><p>{{t('当前模式','Current mode')}}: {{props.settings.mode==='platform'?t('平台模型','Platform model'):t('本地 LM Studio','Local LM Studio')}}</p><p>{{props.settings.mode==='platform'?'materials-research → gpt-5.6-sol':props.settings.modelId}}</p><p>{{t('平台单次输出上限','Platform output limit per request')}}: {{status?.limits.maxOutputTokensPerRequest??t('待连接','Connect to view')}} tokens</p><p>{{t('任务积分上限','Task credit limit')}}: {{props.settings.cloudMaxCredits??t('未配置','Not configured')}} {{catalog?.paidPricing?t('积分','paid credits'):'test-credit'}}</p><p v-if="retailRate">{{t('每万 Token：普通输入 / 缓存输入 / 输出','Per 10k tokens: uncached input / cached input / output')}} {{retailRate}} {{t('积分；精度 0.0001 积分','credits; precision 0.0001 credit')}}</p><p>{{t('云工具需逐次授权文件范围，调用与科学质量分别验收。','Cloud tools use explicitly selected file scopes. Execution and scientific quality are assessed separately.')}}</p><div class="actions"><button class="primary-button" @click="emit('chat')">{{t('开始研究任务','Start research task')}}</button><button class="secondary-button" @click="emit('settings')">{{t('模型与账户设置','Model and account settings')}}</button></div></article>
  <article class="catalog-panel"><AccountPanel :locale="locale" @changed="refresh" /></article>
  <article class="catalog-panel wide"><h2>{{t('购买与订单','Plans and orders')}}</h2><button class="secondary-button" @click="buyOpen=!buyOpen">{{buyOpen?t('收起','Hide'):t('打开订阅、积分包和退款记录','View subscriptions, credit packs and refunds')}}</button><PaymentPanel class="embedded" v-if="buyOpen" :locale="locale" @updated="walletVersion++" /></article>
  <article class="catalog-panel wide"><h2>{{t('可下载版本','Available releases')}}</h2><p>{{t('手动下载并安装；不自动替换程序。目录仅展示已核验公开发布的安装文件。','Download and install manually. Only verified public release assets are listed.')}}</p><p v-if="!releases.length">{{t('尚无通过发布门禁的版本。','No releases have passed publication gates.')}}</p><div v-for="r in releases" :key="r.manifest.id"><h3>{{r.manifest.id}} · {{r.manifest.channel}}</h3><p class="multiline">{{locale==='zh'?r.manifest.notesZh:r.manifest.notesEn}}</p><div v-for="a in r.manifest.assets" :key="a.name" class="asset"><button class="secondary-button" @click="download(a.downloadUrl)">{{a.os}} / {{a.arch}} · {{a.signature==='unsigned'?t('未签名测试版','Unsigned test build'):t('已核验签名','Verified signature')}}</button><small>SHA256 {{a.sha256}} · {{a.sizeBytes}} bytes</small></div></div></article>
 </div>
 <template v-if="tab==='providers'">
  <div class="section-toolbar"><h2>{{t('供应商','Providers')}}</h2><div class="search-box"><Search :size="16" /><input v-model="query" :placeholder="t('搜索供应商','Search providers')" /></div></div>
  <div class="catalog-grid">
   <button v-if="!query||'rootflowai gpt-5.6-sol'.includes(query.toLowerCase())" class="catalog-card provider-card" @click="supplierOpen=!supplierOpen"><div class="catalog-icon"><Server :size="18" /></div><div class="catalog-content"><strong>RootFlowAI</strong><p>gpt-5.6-sol · Responses</p><span>{{t('平台中转 API','Platform relay API')}}</span></div><ArrowRight class="catalog-open-icon" :size="15" /><div class="model-catalog-status">{{status?.gatewayConfigured?t('受限测试','Limited test'):t('未连接 / 未启用','Disconnected / disabled')}}</div></button>
   <button v-if="!query||'lm studio'.includes(query.toLowerCase())" class="catalog-card provider-card" @click="emit('settings')"><div class="catalog-icon"><Monitor :size="18" /></div><div class="catalog-content"><strong>LM Studio</strong><p>{{t('本地推理，独立于平台订阅。','Local inference, independent of platform subscription.')}}</p><span>{{t('配置本地模型','Configure local model')}}</span></div><ArrowRight class="catalog-open-icon" :size="15" /><div class="model-catalog-status">{{t('本机服务','Local service')}}</div></button>
  </div>
  <article v-if="supplierOpen" class="catalog-panel"><h3>RootFlowAI · {{t('中转 API','Relay API')}}</h3><p>{{t('使用平台采购账户，无用户密钥输入。仅开放已固定的 gpt-5.6-sol 测试路由。','Uses the platform procurement account. No user API-key input. Only the pinned gpt-5.6-sol test route is available.')}}</p><p>{{t('流式与工具支持','Streaming and tools')}}: {{route?.capabilities.streaming.status??'unknown'}} / {{route?.capabilities.tools.status??'unknown'}}</p><p>{{t('结构化输出、上游取消能力仍待验收。','Structured output and upstream cancellation remain unverified.')}}</p></article>
 </template>
 <article class="catalog-panel" v-if="tab==='gateway'"><h2>{{t('网关状态','Gateway status')}}</h2><dl><dt>{{t('配置','Configuration')}}</dt><dd>{{status?.gatewayConfigured?t('已启用受限测试','Limited test enabled'):t('未配置 / 未连接','Unconfigured / disconnected')}}</dd><dt>{{t('账户','Account')}}</dt><dd>{{account?.user?.email??t('未登录','Signed out')}}</dd><dt>{{t('上游健康 / 延迟','Upstream health / latency')}}</dt><dd>{{t('未测量，连接配置不代表上游健康','Not measured; configured does not imply healthy')}}</dd><dt>{{t('协议','Protocol')}}</dt><dd>Responses · SSE</dd><dt>{{t('调用预算','Call budget')}}</dt><dd>{{status?`${status.limits.maxRequests} requests / ${status.limits.maxDurationSeconds}s`:'—'}}</dd></dl><p>{{t('失败时保留请求编号与待核对状态，生成请求不自动重放。','Failures retain request IDs and reconciliation state. Generation requests are not automatically replayed.')}}</p></article>
 <article class="catalog-panel" v-if="tab==='routes'"><h2>{{t('路由','Routes')}}</h2><p>materials-research → RootFlowAI / gpt-5.6-sol</p><dl><dt>{{t('版本','Version')}}</dt><dd>{{status?.routeVersionId??'—'}}</dd><dt>{{t('计费模式','Billing mode')}}</dt><dd>{{route?.accessMode??'—'}}</dd><dt>{{t('价格版本','Price version')}}</dt><dd>{{route?.salesPriceVersionId??t('未启用积分计费','Credit billing disabled')}}</dd><dt>{{t('可用请求','Remaining requests')}}</dt><dd>{{catalog?.alpha.remainingRequests??'—'}}</dd></dl><p>{{t('由服务端固定供应商、模型和协议。运行中的任务保留原价格版本。','Provider, model and protocol are pinned server-side. Running tasks retain their original price version.')}}</p></article>
 <template v-if="tab==='usage'"><article class="catalog-panel" v-if="activity"><h2>{{t('最近7天调用趋势','Calls over the last 7 days')}} (UTC)</h2><div class="activity-bars"><div v-for="d in activity.items" :key="d.day"><b>{{d.requests}}</b><span class="bar" :style="{height:`${Math.max(3,80*d.requests/activityMax)}px`}" /><small>{{d.day.slice(5)}}</small><small>{{t('待核对','Pending')}} {{d.pendingRequests}}</small></div></div></article><CreditWalletPanel :key="walletVersion" :locale="locale" compact /><div class="actions"><h2>{{t('任务账单','Task bills')}}</h2><button class="secondary-button" :disabled="busy" @click="exportBills">{{t('导出 CSV','Export CSV')}}</button><button class="secondary-button" @click="tab='agent';buyOpen=true">{{t('购买与退款','Purchase and refunds')}}</button></div><p>{{t('真实积分与 test-credit 分别计量；已知扣减与待核对金额分开显示。Token 未知时不显示为零。','Paid credits and test credits are metered separately. Known charges and pending holds are separate. Unknown token usage is never shown as zero.')}}</p><div class="table-wrap"><table><thead><tr><th>{{t('时间 / 任务','Time / task')}}</th><th>{{t('执行','Execution')}}</th><th>{{t('输入 / 输出','Input / output')}}</th><th>{{t('已知扣减 / 预留','Known charge / hold')}}</th><th>{{t('待核对','Pending')}}</th></tr></thead><tbody><tr v-for="b in bills" :key="b.id"><td><button class="secondary-button" @click="detail(b)" :disabled="busy">{{new Date(b.createdAt).toLocaleString(locale==='zh'?'zh-CN':'en-US')}}</button><small>{{b.id}}</small></td><td>{{state(b.state)}}</td><td>{{b.inputTokens??t('未知','Unknown')}} / {{b.outputTokens??t('未知','Unknown')}}</td><td>{{b.chargedCredits}} / {{b.heldCredits}} <small>{{b.billingMode==='paid-credits'?t('积分','paid credits'):'test-credit'}}</small></td><td>{{b.pendingRequests}}</td></tr></tbody></table></div><p v-if="!bills.length">{{t('暂无任务账单','No task bills')}}</p><button class="secondary-button" v-if="cursor" :disabled="busy" @click="more">{{t('更多账单','More bills')}}</button><article class="catalog-panel" v-if="selected"><h3>{{t('任务明细','Task details')}} · {{selected.id}}</h3><p>{{selected.billingMode}} · {{t('科学质量尚未验收','Scientific quality not evaluated')}}</p><div v-for="r in requests" :key="r.id"><h4>{{r.phase??'conversation'}} · {{state(r.execution)}} / {{state(r.settlement)}}</h4><small>{{r.id}} · {{r.routeVersionId}} · {{r.salesPriceVersionId??'—'}}</small><p>{{t('输入 / 输出','Input / output')}} {{r.usage?.inputTokens??t('未知','Unknown')}} / {{r.usage?.outputTokens??t('未知','Unknown')}} · {{t('普通 / 缓存输入','Uncached / cached input')}} {{r.usage?.uncachedInputTokens??t('未知','Unknown')}} / {{r.usage?.cachedInputTokens??t('未知','Unknown')}} · {{t('扣减','Charge')}} {{r.chargedCredits??t('待确认','Pending')}}</p></div></article></template>
 <template v-if="tab==='resources'">
  <div class="section-toolbar"><div class="catalog-filters resource-types"><button :class="{active:resource==='skills'}" @click="resource='skills';category='all'">Skills <span>{{props.skills.length}}</span></button><button :class="{active:resource==='models'}" @click="resource='models';category='all'">{{t('材料模型目录','Materials model catalogue')}} <span>{{props.models.length}}</span></button></div><div class="search-box"><Search :size="16" /><input v-model="query" :placeholder="t('搜索名称、中文或英文介绍','Search names or bilingual descriptions')" /></div></div>
  <p class="notice">{{t('Skills 已内置；模型目录提供说明与示例，计算权重和 M6 运行环境仍需单独准备。','Skills are bundled. The model catalogue contains descriptions and examples; compute weights and the M6 runtime require separate preparation.')}}</p>
  <div class="catalog-filters" :aria-label="t('资源分类','Resource categories')"><button :class="{active:category==='all'}" @click="category='all'">{{t('全部','All')}}</button><button v-for="c in categories" :key="c.id" :class="{active:category===c.id}" @click="category=c.id">{{c.label}}</button></div>
  <div class="catalog-grid">
   <article v-for="s in resource==='skills'?visibleSkills:[]" :key="s.name" class="resource-card"><button type="button" class="catalog-card" @click="emit('skill',s,locale)"><div class="catalog-icon"><FlaskConical :size="18" /></div><div class="catalog-content"><strong>{{s.name}}</strong><p>{{locale==='zh'?s.descriptionZh:s.descriptionEn}}</p><span>{{s.license}}</span></div><ArrowRight class="catalog-open-icon" :size="15" /><div :class="['enabled-indicator',{reviewing:!s.enabled}]"><span />{{locale==='zh'?s.categoryLabelZh:s.categoryLabelEn}} · {{s.enabled?t('已启用','Enabled'):t('验收中','Under review')}}</div></button><div class="resource-examples"><button v-for="(e,i) in s.examples" :key="i" class="secondary-button" :disabled="!s.enabled" @click="emit('example',e[locale])">{{t('填入输入框','Use in chat')}} {{i+1}}</button></div></article>
   <article v-for="m in resource==='models'?visibleModels:[]" :key="m.id" class="resource-card"><button type="button" class="catalog-card" @click="emit('model',m,locale)"><div class="catalog-icon"><Atom :size="18" /></div><div class="catalog-content"><strong>{{m.name}}</strong><p>{{locale==='zh'?m.descriptionZh:m.descriptionEn}}</p><span>{{m.license}}</span></div><ArrowRight class="catalog-open-icon" :size="15" /><div class="model-catalog-status">{{modelCategoryLabel(m.category)}} · {{t('目录收录','Catalog only')}}</div></button><div class="resource-examples"><button v-for="(e,i) in m.examples" :key="i" class="secondary-button" @click="emit('example',e[locale])">{{t('填入输入框','Use in chat')}} {{i+1}}</button></div></article>
  </div>
  <div v-if="!(resource==='skills'?visibleSkills:visibleModels).length" class="empty-list">{{t('没有匹配的资源','No matching resources')}}</div>
 </template>
 <SupportPanel v-if="tab==='agent'&&account?.status==='connected'" />
 <footer>© 2026 吉林大学 AI-DAOS 团队</footer>
 </div>
</section>
</template>
<style scoped>
.platform-center { color: var(--text); }
.actions, .section-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.section-toolbar { justify-content: space-between; margin-bottom: 18px; }
.resource-types { margin: 0; }
.workspace-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-items: start; }
.workspace-grid > .catalog-panel { margin: 0; }
.wide { grid-column: 1 / -1; }
.notice { margin: 0 0 18px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); color: var(--muted); font-size: 11px; line-height: 1.6; }
.notice.error { border-color: var(--danger); color: var(--danger); }
h2, h3 { margin: 0 0 12px; font-size: 13px; font-weight: 600; }
h4 { font-size: 12px; }
.catalog-panel p, .catalog-page-body > p { color: var(--muted); font-size: 12px; line-height: 1.65; }
small { display: block; color: var(--dim); font-size: 10px; overflow-wrap: anywhere; }
dl { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 12px; font-size: 12px; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
.multiline { white-space: pre-wrap; }
.asset { margin: 14px 0; }
.asset small { margin-top: 8px; }
.table-wrap { overflow: auto; border: 1px solid var(--line); border-radius: 9px; background: var(--catalog-surface); }
table { border-collapse: collapse; width: 100%; font-size: 11px; }
td, th { padding: 12px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; background: var(--panel-2); }
td small { margin-top: 6px; }
td .secondary-button { height: auto; min-height: 30px; padding: 6px 8px; font-size: 10px; }
.activity-bars { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; align-items: end; text-align: center; }
.activity-bars .bar { display: block; background: var(--accent); border-radius: 4px; margin: 7px auto; width: 70%; max-width: 70px; }
.activity-bars b { font-size: 12px; }
.resource-card { min-width: 0; }
.resource-card > .catalog-card { width: 100%; }
.resource-examples { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.resource-examples .secondary-button { height: 28px; padding: 0 9px; font-size: 10px; }
footer { text-align: center; color: var(--dim); font-size: 9px; padding-top: 30px; }
.platform-center :deep(.setting-section) { border: 0; padding: 0; }
@media (max-width: 800px) { .workspace-grid { grid-template-columns: 1fr; } dl { grid-template-columns: 110px minmax(0, 1fr); } }
</style>
