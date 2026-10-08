<script setup lang="ts">
import {computed, ref, onUnmounted} from 'vue';
import {ElDrawer} from 'element-plus';
import {HardDrive, ArrowRight, ChevronDown, Download, Upload, Lock, RefreshCw, X, Check} from '@lucide/vue';
import type {PotentialStorageInventory, PotentialStorageItem} from '../../../../../packages/contracts/src/potential-distribution.js';
import type {PotentialCatalog} from '../../../../../packages/contracts/src/potential-hub.js';
const props = defineProps<{locale:'zh'|'en'; catalog:PotentialCatalog|null}>();
const api = window.materialsx, t = (zh:string,en:string) => props.locale==='zh' ? zh : en;
const expanded=ref(false), details=ref(false), exportDetails=ref(false), busy=ref(false), error=ref(''), notice=ref('');
const inventory=ref<PotentialStorageInventory|null>(null), selected=ref<string[]>([]), exportIds=ref<string[]>([]);
const available=ref<string[]>([]), receipt=ref<Awaited<ReturnType<typeof api.inspectScientificReceipt>>>(null);
const size=(n:number)=>n>=1073741824?(n/1073741824).toFixed(2)+' GiB':n>=1048576?(n/1048576).toFixed(2)+' MiB':n>=1024?(n/1024).toFixed(1)+' KiB':n+' B';
const name=(id:string)=>props.catalog?.entries.find(e=>e.id===id)?.name??id;
const removable=computed(()=>inventory.value?.items.filter(i=>i.removable)??[]);
const protectedItems=computed(()=>inventory.value?.items.filter(i=>!i.removable)??[]);
const selectedBytes=computed(()=>removable.value.filter(i=>selected.value.includes(i.id)).reduce((sum,i)=>sum+i.bytes,0));
const exportBytes=(id:string)=>inventory.value?.items.find(i=>i.id==='package:'+id)?.bytes??props.catalog?.entries.find(e=>e.id===id)?.asset.bytes??undefined;
function itemName(item:PotentialStorageItem){
 if(item.kind==='package'||item.kind==='partial'||item.kind==='catalog')return name(item.id.split(':')[1]!);
 const names:Record<string,[string,string]>={
  'protected:runtime':['核心模型与计算环境','Core models & compute environment'],
  'protected:catalog':['目录与版本记录','Catalog & version history'],
  'protected:discovery':['模型发现记录与来源资料','Discoveries & source material'],
  'protected:native-engine':['NEP / D3 计算引擎','NEP / D3 compute engines'],
  'protected:skill-python':['Skills 运行环境','Skills environment'],
  'protected:bundled':['安装程序内置模型','Models bundled with the installer'],
  'protected:other-scientific-cache':['安装记录与其他模型文件','Installation records & other model files'],
 };
 return names[item.id]?t(...names[item.id]!):item.label[props.locale];
}
const protectionReason=(item:PotentialStorageItem)=>item.kind==='protected'?t('应用保留文件','Kept by the application'):t('正在使用，暂不可清理','In use; cannot be removed now');
const kindLabel=(item:PotentialStorageItem)=>item.kind==='partial'?t('未完成的下载','Incomplete download'):item.kind==='quarantine'?t('隔离缓存','Quarantined cache'):t('模型文件','Model files');
async function load(){
 const [s,p]=await Promise.all([api.getPotentialStorage(),api.getPotentialPackages()]);
 inventory.value=s;
 available.value=p.filter(p=>p.state==='installed'&&!p.error).map(p=>p.potentialId);
 selected.value=[]; exportIds.value=exportIds.value.filter(id=>available.value.includes(id));
}
async function action(fn:()=>Promise<void>){
 if(busy.value)return; busy.value=true; error.value=''; notice.value='';
 try{await fn();}catch(e){error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;}
}
async function show(){expanded.value=!expanded.value;if(expanded.value)await action(load);}
async function cleanup(){
 if(!inventory.value)return;
 await action(async()=>{
  const r=await api.cleanupPotentialStorage({ids:[...selected.value],inventorySha256:inventory.value!.inventorySha256},props.locale);
  if(r){notice.value=t('已清理 ','Cleaned ')+size(r.bytes);await load();}
 });
}
async function importCollection(){await action(async()=>{const r=await api.importPotentialCollection();if(r)notice.value=t(`已导入 ${r.imported.length} 个模型。`,`Imported ${r.imported.length} models.`);await load();});}
async function exportCollection(){await action(async()=>{const r=await api.exportPotentialCollection([...exportIds.value]);if(r){notice.value=t('模型包已保存到：','Model bundle saved to: ')+r.path;exportDetails.value=false;}});}
const remove=api.onPotentialCatalogChanged(()=>{if(expanded.value&&!busy.value)void action(load);});onUnmounted(remove);
</script>
<template>
 <section class="potential-storage model-tools-panel" data-testid="potential-storage">
  <button class="model-tools-toggle" data-testid="storage-toggle" aria-controls="storage-content" :aria-expanded="expanded" @click="show">
   <span class="model-tools-icon"><HardDrive :size="20"/></span>
   <span class="model-tools-heading"><strong>{{t('存储与离线迁移','Storage & offline transfer')}}</strong><span>{{t('查看空间占用，清理缓存，迁移已安装的模型。','Check storage, clear caches and transfer installed models.')}}</span></span>
   <ChevronDown :size="18" class="model-tools-chevron" :class="{expanded}"/>
  </button>
  <div v-if="expanded" id="storage-content" class="model-tools-body" data-testid="storage-content" :aria-busy="busy">
   <div class="storage-overview">
    <div class="storage-metrics" data-testid="storage-metrics">
     <div><span>{{t('模型与环境文件','Model & environment files')}}</span><strong>{{inventory?size(inventory.totalBytes):'—'}}</strong></div>
     <div class="reclaimable"><span>{{t('可清理空间','Available to clean')}}</span><strong>{{inventory?size(inventory.reclaimableBytes):'—'}}</strong></div>
    </div>
    <div class="storage-summary-actions">
     <button class="secondary-button" :disabled="busy" :aria-label="t('刷新空间统计','Refresh storage usage')" @click="action(load)"><RefreshCw :size="14" :class="{spinning:busy}"/>{{t('刷新','Refresh')}}</button>
     <button class="primary-button" data-testid="storage-details-open" :disabled="busy||!inventory" @click="details=true">{{t('管理空间','Manage storage')}}<ArrowRight :size="14"/></button>
    </div>
   </div>
   <p class="model-tools-note">{{t('仅清理模型缓存和未完成的下载。项目文件、计算结果与运行环境会保留。','Cleanup covers model caches and incomplete downloads. Project files, results and compute environments are kept.')}}</p>
   <section class="transfer-section">
    <div class="storage-section-heading"><h3>{{t('离线迁移','Offline transfer')}}</h3><span>{{t('在电脑之间迁移模型，无需重新下载。','Move models between computers without downloading again.')}}</span></div>
    <div class="transfer-grid">
     <button class="transfer-card" :disabled="busy" data-testid="collection-import" @click="importCollection">
      <span class="model-tools-icon"><Download :size="19"/></span><span><strong>{{t('导入模型包','Import model bundle')}}</strong><small>{{t('选择从 MaterialsX 导出的离线模型包。','Choose an offline bundle exported by MaterialsX.')}}</small></span><ArrowRight :size="16"/>
     </button>
     <button class="transfer-card" :disabled="busy||!inventory" data-testid="collection-export-open" @click="exportDetails=true">
      <span class="model-tools-icon"><Upload :size="19"/></span><span><strong>{{t('导出模型包','Export model bundle')}}</strong><small>{{t('选择已安装模型，打包后供其他电脑导入。','Bundle installed models for another computer.')}}</small></span><ArrowRight :size="16"/>
     </button>
    </div>
    <p class="model-tools-note">{{t('模型包不包含计算环境。接收电脑需使用支持这些模型的 MaterialsX 版本，并备好相应环境。','Bundles contain model files only. The receiving computer needs a compatible MaterialsX version and compute environment.')}}</p>
   </section>
   <details class="storage-advanced">
    <summary>{{t('目录备份与结果检查','Catalog backup & result checks')}}</summary>
    <div class="advanced-tools">
     <div><strong>{{t('备份模型目录','Back up the model catalog')}}</strong><p>{{t('保存当前签名目录，用于离线导入。此文件不含模型权重。','Save the signed catalog for offline import. Model weights are not included.')}}</p><button class="secondary-button" :disabled="busy" data-testid="catalog-export" @click="action(async()=>{if(await api.exportPotentialCatalog())notice=t('模型目录已导出。','Model catalog exported.');})">{{t('导出目录','Export catalog')}}</button></div>
     <div><strong>{{t('检查计算记录','Check a calculation record')}}</strong><p>{{t('打开复现回执，检查所需模型和依赖是否与当前版本兼容。','Open a reproduction receipt to check model and dependency compatibility.')}}</p><button class="secondary-button" :disabled="busy" data-testid="receipt-inspect" @click="action(async()=>{receipt=await api.inspectScientificReceipt();})">{{t('打开回执','Open receipt')}}</button></div>
    </div>
    <article v-if="receipt" class="receipt-card" data-testid="receipt-summary"><strong>{{name(receipt.potentialId)}} · {{receipt.task}}</strong><p>{{receipt.compatible?t('模型与依赖记录和当前版本兼容。','Recorded models and dependencies are compatible with this version.'):t('当前版本不兼容，请准备原始模型与匹配的依赖。','Incompatible with this version. Original models and matching dependencies are required.')}}</p><p class="model-tools-note">{{t('已校验回执文件，未核验原始结果文件。兼容检查不代表结果验证，跨平台计算也可能存在数值差异。','The receipt file was checked; original result files were not. Compatibility does not validate results, and values may differ across platforms.')}}</p><p v-if="receipt.legacySourceRevisionUnknown">{{t('此记录未保存代码版本，需要进一步核实。','The code version was not recorded and needs verification.')}}</p></article>
   </details>
   <p class="storage-footnote">{{t('按文件大小统计，实际磁盘占用可能不同。','File sizes are shown; actual disk usage may differ.')}}<span v-if="inventory"> · {{t('更新于 ','Updated at ')}}{{new Date(inventory.scannedAt).toLocaleTimeString(locale==='zh'?'zh-CN':'en',{hour:'2-digit',minute:'2-digit'})}}</span></p>
  </div>
  <div v-if="busy||notice||error" class="storage-feedback" aria-live="polite">
   <p v-if="busy" role="status"><RefreshCw :size="14" class="spinning"/>{{inventory?t('正在处理…','Working…'):t('正在统计空间占用…','Calculating storage usage…')}}</p>
   <p v-if="notice" role="status"><Check :size="15"/>{{notice}}</p>
   <div v-if="error" role="alert"><p>{{t('操作未完成，请刷新后重试。','Could not complete the operation. Refresh and try again.')}}</p><details><summary>{{t('查看错误详情','Error details')}}</summary><code>{{error}}</code></details></div>
  </div>
  <el-drawer v-model="details" :with-header="false" direction="rtl" size="min(600px, 100vw)" class="model-details-drawer">
   <div class="storage-drawer" data-testid="storage-details">
    <div class="skill-detail-heading"><div class="skill-detail-title"><span class="skill-detail-icon"><HardDrive :size="21"/></span><h2>{{t('管理存储空间','Manage storage')}}</h2></div><button class="icon-button" :aria-label="t('关闭空间管理','Close storage management')" @click="details=false"><X :size="18"/></button></div>
    <p class="model-tools-note">{{t('选择要清理的文件，确认后删除。删除模型后，可再次下载或导入。','Select files to remove, then confirm. Removed models can be downloaded or imported again.')}}</p>
    <div class="storage-section-heading"><h3>{{t('可清理文件','Removable files')}}</h3><button class="storage-text-button" :disabled="busy||!removable.length" @click="selected=selected.length===removable.length?[]:removable.map(i=>i.id)">{{selected.length===removable.length&&removable.length?t('取消全选','Clear selection'):t('全选','Select all')}}</button></div>
    <div v-if="!removable.length" class="storage-empty">{{t('没有可清理的缓存。','No removable caches.')}}</div>
    <label v-for="item in removable" :key="item.id" class="storage-file-row selectable" :class="{selected:selected.includes(item.id)}" :data-storage-id="item.id">
     <input v-model="selected" type="checkbox" :value="item.id" :disabled="busy"/><span class="storage-file-info"><strong>{{itemName(item)}}</strong><small>{{kindLabel(item)}}</small><small v-if="item.kind==='partial'">{{t('清理后需重新下载。','You will need to restart this download.')}}</small><small v-if="item.kind==='quarantine'">{{item.reason[locale]}}</small></span><span class="storage-file-size">{{size(item.bytes)}}</span>
    </label>
    <details class="storage-protected"><summary><Lock :size="13"/>{{t('保留的文件','Files kept')}} <span>{{protectedItems.length}}</span></summary><p class="model-tools-note">{{t('这些文件用于运行计算、校验来源或正在使用，无法在此清理。','These files support computation or source checks, or are currently in use. They cannot be removed here.')}}</p><article v-for="item in protectedItems" :key="item.id" class="storage-file-row" :data-storage-id="item.id"><Lock :size="14"/><span class="storage-file-info"><strong>{{itemName(item)}}</strong><small>{{protectionReason(item)}}</small></span><span class="storage-file-size">{{size(item.bytes)}}</span></article></details>
    <div class="storage-drawer-footer"><span>{{t(`已选 ${selected.length} 项`,`Selected ${selected.length} files`)}}<strong>{{size(selectedBytes)}}</strong></span><button class="primary-button" data-testid="storage-cleanup" :disabled="busy||!selected.length" @click="cleanup">{{t('确认清理…','Review cleanup…')}}</button></div>
    <p v-if="notice" class="model-tools-note" role="status">{{notice}}</p><p v-if="error" class="model-tools-note" role="alert">{{error}}</p>
   </div>
  </el-drawer>
  <el-drawer v-model="exportDetails" :with-header="false" direction="rtl" size="min(600px, 100vw)" class="model-details-drawer">
   <div class="storage-drawer" data-testid="collection-export-details">
    <div class="skill-detail-heading"><div class="skill-detail-title"><span class="skill-detail-icon"><Upload :size="21"/></span><h2>{{t('导出模型包','Export model bundle')}}</h2></div><button class="icon-button" :aria-label="t('关闭模型导出','Close model export')" @click="exportDetails=false"><X :size="18"/></button></div>
    <p class="model-tools-note">{{t('选择已安装的扩展模型。核心模型随安装程序提供，无需在此导出。','Select installed extension models. Core models come with the installer and do not need to be exported here.')}}</p>
    <div class="storage-section-heading"><h3>{{t('可导出的模型','Available models')}}</h3><button class="storage-text-button" :disabled="busy||!available.length" @click="exportIds=exportIds.length===available.length?[]:[...available]">{{exportIds.length===available.length&&available.length?t('取消全选','Clear selection'):t('全选','Select all')}}</button></div>
    <label v-for="id in available" :key="id" class="storage-file-row selectable" :class="{selected:exportIds.includes(id)}" :data-export-id="id"><input v-model="exportIds" type="checkbox" :value="id" :disabled="busy"/><span class="storage-file-info"><strong>{{name(id)}}</strong><small>{{id}}</small></span><span v-if="exportBytes(id)!==undefined" class="storage-file-size">{{size(exportBytes(id)!)}}</span></label>
    <div v-if="!available.length" class="storage-empty">{{t('还没有已安装的扩展模型。请先在下载管理中安装模型。','No installed extension models yet. Install one from Downloads first.')}}</div>
    <details class="storage-advanced"><summary>{{t('模型包包含什么？','What is included?')}}</summary><p class="model-tools-note">{{t('包含模型文件、许可声明、文件校验信息和依赖版本记录，不包含计算环境。','Model files, license notices, file checksums and dependency versions are included. Compute environments are not included.')}}</p></details>
    <div class="storage-drawer-footer"><span>{{t(`已选 ${exportIds.length} 个模型`,`Selected ${exportIds.length} models`)}}</span><button class="primary-button" data-testid="collection-export" :disabled="busy||!exportIds.length" @click="exportCollection">{{t('导出模型包','Export bundle')}}</button></div>
    <p v-if="busy" role="status" class="model-tools-note">{{t('正在导出…','Exporting…')}}</p><p v-if="error" role="alert" class="model-tools-note">{{error}}</p>
   </div>
  </el-drawer>
 </section>
</template>
<style scoped>
.storage-overview{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:4px 0 16px}
.storage-metrics{display:flex;gap:44px;flex:1;min-width:0}.storage-metrics>div{display:grid;gap:7px;min-width:0}.storage-metrics span{font-size:12px;color:var(--muted)}.storage-metrics strong{font-size:26px;line-height:1.25;font-weight:600;letter-spacing:-.025em;font-variant-numeric:tabular-nums}.reclaimable strong{color:var(--accent)}
.storage-summary-actions{display:flex;gap:8px;flex-wrap:wrap}.storage-section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 14px}.storage-section-heading h3{margin:0;font-size:14px;font-weight:600}.storage-section-heading>span{color:var(--muted);font-size:12px}
.transfer-section{margin-top:24px;padding-top:22px;border-top:1px solid var(--line)}.transfer-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.transfer-card{display:grid;grid-template-columns:38px minmax(0,1fr) 16px;gap:12px;align-items:center;text-align:left;padding:18px 16px;border:1px solid var(--line);border-radius:10px;background:var(--catalog-background);color:var(--text);cursor:pointer}.transfer-card:hover:not(:disabled){border-color:var(--accent);background:var(--accent-bg)}.transfer-card strong{font-size:13px;display:block}.transfer-card small{display:block;margin-top:6px;color:var(--muted);font-size:12px;line-height:1.6}.transfer-card>svg{color:var(--dim)}
.storage-advanced{margin-top:20px;border-top:1px solid var(--line);padding-top:16px}.storage-advanced summary,.storage-protected summary{font-size:12px;color:var(--muted);cursor:pointer}.advanced-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding-top:16px}.advanced-tools strong{font-size:13px}.advanced-tools p{font-size:12px;line-height:1.6;color:var(--muted);margin:6px 0 12px}.storage-footnote{font-size:11px;color:var(--dim);margin:20px 0 0;line-height:1.6}
.storage-feedback{padding:0 22px 16px;font-size:12px;color:var(--muted)}.storage-feedback p{display:flex;align-items:center;gap:8px;margin:6px 0;overflow-wrap:anywhere}.storage-feedback [role=alert]{color:var(--danger)}.storage-feedback code{overflow-wrap:anywhere}.storage-feedback summary{cursor:pointer}
.storage-drawer{color:var(--text);padding:24px}.storage-drawer .skill-detail-heading{padding:0 0 20px;gap:12px}.storage-drawer .storage-section-heading{margin-top:24px}.storage-text-button{border:0;background:transparent;color:var(--accent);font-size:12px;cursor:pointer;padding:4px}.storage-file-row{display:flex;gap:12px;align-items:center;min-width:0;padding:14px 12px;margin:8px 0;border:1px solid var(--line);border-radius:9px;background:var(--catalog-surface)}.storage-file-row.selectable{cursor:pointer}.storage-file-row.selected{border-color:var(--accent);background:var(--accent-bg)}.storage-file-row.selectable:hover{border-color:var(--accent)}.storage-file-row input{accent-color:var(--accent);width:16px;height:16px;flex-shrink:0;margin:0}.storage-file-info{min-width:0;flex:1;display:grid;gap:5px}.storage-file-info strong{font-size:13px;font-weight:600;overflow-wrap:anywhere}.storage-file-info small{color:var(--muted);font-size:11px;line-height:1.6;overflow-wrap:anywhere}.storage-file-size{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}.storage-protected{margin-top:24px}.storage-protected summary>svg{vertical-align:middle;margin-right:5px}.storage-protected summary>span{margin-left:6px;color:var(--dim)}.storage-protected .storage-file-row>svg{color:var(--dim);flex-shrink:0}.storage-empty{padding:24px 16px;text-align:center;color:var(--muted);font-size:12px;border:1px dashed var(--line);border-radius:9px;line-height:1.7}
.storage-drawer-footer{position:sticky;bottom:-24px;display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:24px;padding:16px 0;background:var(--el-drawer-bg-color,var(--panel));border-top:1px solid var(--line)}.storage-drawer-footer>span{display:grid;gap:4px;font-size:12px;color:var(--muted)}.storage-drawer-footer strong{font-size:15px;color:var(--text)}.receipt-card{margin-top:18px;border:1px solid var(--line);border-radius:9px;padding:16px}.receipt-card strong{display:block;font-size:13px;overflow-wrap:anywhere}.receipt-card p{font-size:12px;line-height:1.7}
.spinning{animation:storage-spin 1.2s linear infinite}@keyframes storage-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinning{animation:none}}
@media(max-width:1100px){.storage-overview{flex-wrap:wrap}.storage-metrics{flex-basis:100%;gap:28px}.storage-summary-actions{width:100%;justify-content:flex-end}.transfer-grid,.advanced-tools{grid-template-columns:minmax(0,1fr)}}
@media(max-width:760px){.storage-metrics strong{font-size:22px}.storage-metrics{gap:22px}.storage-metrics span{font-size:11px}.storage-file-row{flex-wrap:wrap}.storage-file-size{margin-left:auto}}
</style>
