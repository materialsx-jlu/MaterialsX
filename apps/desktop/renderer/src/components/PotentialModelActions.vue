<script setup lang="ts">
import {ref,computed,watch} from 'vue';
import {Download,FolderOpen,Play,Check,Upload,Pause} from '@lucide/vue';
import type {HubEntry} from '../../../../../packages/contracts/src/potential-hub.js';
import type {PotentialModelState} from '../../../../../packages/contracts/src/catalog-weights.js';
import type {CapabilityReceipt} from '../../../../../packages/contracts/src/potential-packages.js';
const props=defineProps<{entry:HubEntry;state:PotentialModelState|null;locale:'zh'|'en'}>();
const emit=defineEmits<{'refresh':[];'analyze':[id:string]}>();
const api=window.materialsx,t=(zh:string,en:string)=>props.locale==='zh'?zh:en;
const busy=ref(false),error=ref(''),receipt=ref<CapabilityReceipt|null>(null);
watch(()=>props.entry.id,()=>{error.value='';receipt.value=null;});
const labels:Record<string,[string,string]>={absent:['尚未下载','Not downloaded'],downloading:['正在下载','Downloading'],paused:['下载已暂停','Download paused'],downloaded:['已下载 · 尚未适配计算','Downloaded · compute adapter pending'],installed:['权重已安装','Checkpoint installed'],ready:['加载验证通过','Load check passed'],loading:['正在加载验证','Checking model load'],disabled:['已停用','Disabled'],failed:['下载或校验失败','Download or validation failed']};
const stateLabel=computed(()=>busy.value&&!['downloading','loading'].includes(props.state?.state??'')?t('正在处理…','Processing…'):props.state?labels[props.state.state]?.[props.locale==='zh'?0:1]:t('正在读取状态','Reading status'));
const size=(bytes:number|null)=>bytes===null?t('大小待确认','Size not available'):bytes>=1073741824?`${(bytes/1073741824).toFixed(2)} GiB`:`${(bytes/1048576).toFixed(2)} MiB`;
const message=(raw:string)=>{
 if(/TIMEOUT|fetch failed|ECONN/.test(raw))return t('连接模型来源超时或网络不可用。检查网络后重试；已保存的下载进度会保留。','The model source timed out or is unreachable. Check your connection and retry; saved download progress is retained.');
 if(/401|403|ACCESS_REQUIRED/.test(raw))return t('此来源需要访问授权。请在官方页面申请或下载后导入。','This source requires access approval. Visit the official page to apply or download for import.');
 if(/WITHDRAWN/.test(raw))return t('此模型已撤回，暂时不能下载或计算。','This model was withdrawn; downloading and computation are unavailable.');
 if(/IDENTITY|HASH|digest|MISMATCH/.test(raw))return t('模型文件校验失败，请清理下载缓存后重新下载。','Model verification failed. Clear its download cache and retry.');
 if(/BUSY|IN_USE/.test(raw))return t('当前有模型下载、加载或计算任务，请稍后重试。','A download, load check or calculation is in progress. Try again when it finishes.');
 if(/SPACE|TOO_LARGE/.test(raw))return t('可用空间不足或文件超过下载上限（3 GiB）。','Insufficient disk space or the file exceeds the 3 GiB download limit.');
 if(/RUNTIME|ENVIRONMENT|PYTHON|EXTENSION_PACKAGE/.test(raw))return t('模型需要匹配的计算环境，请查看下方环境说明。','This model needs its matching compute environment. See the environment notes below.');
 return t('操作未完成，请重试或查看详细信息。','The operation did not finish. Retry or view details.');
};
async function act(fn:()=>Promise<unknown>){busy.value=true;error.value='';try{await fn();}catch(e){const text=e instanceof Error?e.message:String(e);if(!/abort|cancel/i.test(text))error.value=text;}finally{busy.value=false;emit('refresh');window.dispatchEvent(new Event('materialsx:packages-changed'));}}
const download=()=>act(()=>props.state?.managedPackage?api.downloadPotentialPackage(props.entry.id):api.downloadCatalogWeight(props.entry.id));
const pause=()=>act(()=>props.state?.managedPackage?api.cancelPotentialDownload(props.entry.id):api.cancelCatalogWeight(props.entry.id));
const importFile=()=>act(()=>props.state?.managedPackage?api.importPotentialPackage(props.entry.id):api.importCatalogWeight(props.entry.id));
const load=()=>act(async()=>{receipt.value=await api.loadPotentialModel(props.entry.id);});
const clear=()=>act(async()=>{const inventory=await api.getPotentialStorage();const id=props.entry.id;const ids=inventory.items.filter(r=>r.removable&&(r.id===`package:${id}`||r.id===`partial:${id}`||r.id.startsWith(`catalog:${id}:`))).map(r=>r.id);if(!ids.length)throw Error('PACKAGE_IN_USE');await api.cleanupPotentialStorage({ids,inventorySha256:inventory.inventorySha256},props.locale);receipt.value=null;});
const environmentCommand=computed(()=>props.entry.id.includes('sevennet')?'npm run m610:runtime:dev':props.entry.id.includes('ani-')?'npm run m613:runtime':props.entry.id.includes('nep-')?'npm run m614:runtime':props.entry.id.includes('-d3-')?'npm run m615:runtime':'npm run m6:runtime:dev');
const hasFile=computed(()=>['downloaded','installed','ready'].includes(props.state?.state??''));
</script>
<template>
 <section class="model-install" data-testid="model-install" :data-model="entry.id" :aria-busy="busy">
  <div class="model-install-heading"><strong>{{t('下载与运行','Download & run')}}</strong><span class="install-state">{{stateLabel}}</span></div>
  <p v-if="state?.supported">{{state.runtimeReady?t('计算环境已就绪；计算时会自动加载模型。','The compute environment is ready. Models load automatically for each calculation.'):t('可下载权重。运行此模型还需要匹配的计算环境。','You can download the checkpoint. Running it also requires a matching compute environment.')}}</p>
  <p v-else-if="entry.entityType==='checkpoint'">{{t('可保存权重文件。此版本尚未接入 MaterialsX 计算，下载后不会自动获得运行能力。','Save the checkpoint locally. This version does not yet have a MaterialsX compute adapter; downloading does not enable calculations.')}}</p>
  <p v-else>{{t('这是模型系列或相关资源，请在具体版本中下载权重。','This is a model family or related resource. Choose a concrete version to download its checkpoint.')}}</p>
  <div v-if="state" class="install-file"><span>{{size(state.bytes)}} / {{size(state.totalBytes)}}</span><span v-if="hasFile">{{state.verifiedAgainstCatalog?t('目录指纹校验通过','Catalog fingerprint verified'):t('已记录本地指纹；上游指纹待核实','Local fingerprint recorded; upstream digest unverified')}}</span></div>
  <progress v-if="state?.state==='downloading'||state?.state==='paused'" :value="state.bytes" :max="state.totalBytes??undefined"/>
  <div class="install-actions">
   <button v-if="state?.canDownload&&!hasFile&&state.state!=='disabled'&&state.state!=='downloading'" class="primary-button" :disabled="busy" data-testid="model-download" @click="download"><Download :size="14"/>{{state.state==='paused'?t('继续下载','Resume download'):t('下载权重','Download checkpoint')}}</button>
   <button v-if="state?.state==='downloading'" class="secondary-button" data-testid="model-pause" @click="pause"><Pause :size="14"/>{{t('暂停下载','Pause download')}}</button>
   <button v-if="state?.canLoad" class="primary-button" :disabled="busy" data-testid="model-load" @click="load"><Check :size="14"/>{{t('加载验证','Check model load')}}</button>
   <button v-if="state?.supported&&state.runtimeReady&&hasFile" class="secondary-button" :disabled="busy" data-testid="model-analyze" @click="emit('analyze',entry.id)"><Play :size="14"/>{{t('分析结构','Analyze structure')}}</button>
   <button v-if="state?.canImport" class="secondary-button" :disabled="busy" data-testid="model-import" @click="importFile"><Upload :size="14"/>{{t('导入权重','Import checkpoint')}}</button>
   <button v-if="hasFile" class="secondary-button" :disabled="busy" data-testid="model-reveal" @click="act(()=>api.revealCatalogWeight(entry.id))"><FolderOpen :size="14"/>{{t('打开文件位置','Show in folder')}}</button>
   <button v-if="state?.state==='disabled'" class="secondary-button" :disabled="busy" @click="act(()=>api.disablePotentialPackage(entry.id,false))">{{t('启用模型','Enable model')}}</button>
   <button v-if="state?.cacheOwned&&state.state!=='downloading'&&state.state!=='loading'" class="secondary-button" :disabled="busy" data-testid="model-cleanup" @click="clear">{{t('清理下载文件','Clear downloaded files')}}</button>
  </div>
  <p v-if="entry.access==='gated'">{{t('此权重需要在官方平台取得访问授权。','This checkpoint requires access approval from its official platform.')}}</p>
  <details v-if="state?.supported&&!state.runtimeReady"><summary>{{t('如何准备计算环境','Prepare the compute environment')}}</summary><p>{{t('安装版使用随发行包提供的环境；开发版执行以下命令。','Installers use the bundled environment. For a development checkout, run:')}}</p><code>{{environmentCommand}}</code></details>
  <p v-if="receipt" class="load-result" data-testid="model-load-result">{{t('已实际加载','Loaded successfully')}} · CPU · {{receipt.elements.length}} {{t('种元素','elements')}} · {{size(receipt.loadedMemoryMiB*1048576)}}<br/>{{t('验证结束后释放内存，下次计算会重新加载。','Memory is released after validation; the next calculation loads the model again.')}}</p>
  <div v-if="error||state?.error" class="install-error" role="alert"><p>{{message(error||state!.error!)}}</p><details><summary>{{t('详细信息','Details')}}</summary><code>{{error||state?.error}}</code></details></div>
 </section>
</template>
<style scoped>
.model-install{min-width:0;margin:18px 28px;padding:16px;border:1px solid var(--line);border-radius:10px;background:var(--catalog-surface);color:var(--text)}.model-install-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.model-install-heading strong{font-size:13px}.install-state{font-size:11px;color:var(--muted)}.model-install p,details,.install-file{font-size:12px;line-height:1.75;color:var(--muted)}.install-file{display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap}.install-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.install-actions button{display:inline-flex;gap:6px;align-items:center;white-space:normal;font-size:12px}.model-install progress{width:100%;accent-color:var(--accent);margin-top:10px}.model-install details{margin-top:12px}.model-install code{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}.load-result{padding-top:12px;border-top:1px solid var(--line)}.install-error{margin-top:12px;color:var(--text)}.model-install summary{cursor:pointer}
</style>
