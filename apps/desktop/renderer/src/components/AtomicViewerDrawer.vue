<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { ElDrawer } from "element-plus";
import { atomicViewRequest, closeAtomicView } from "../utils/atomic-viewer";
import { appearanceTheme } from "../utils/appearance";
import { atomicViewPayloadSchema, atomicFrameEventSchema, atomicFrameCommandSchema, type AtomicViewPayload } from "../../../../../packages/contracts/src/atomic-viewer.js";
import { displayAtoms, cellEdges, angle, distance } from "../../../../../packages/atomistic/src/viewer-geometry.js";
import type { z } from "zod";
import type { atomicViewerConfigSchema } from "../../../../../packages/contracts/src/atomistic.js";
import { scientificSnapshotSchema as atomisticSnapshotSchema, type ScientificSnapshot as AtomisticSnapshot } from "../../../../../packages/contracts/src/atomistic-dynamics.js";
const props=defineProps<{locale:"zh"|"en";projectId:string|null}>();
const t=(zh:string,en:string)=>props.locale==="zh"?zh:en;
const visible=computed({get:()=>atomicViewRequest.value!==null,set:(v:boolean)=>{if(!v)closeAtomicView();}});
const payload=ref<AtomicViewPayload|null>(null),loading=ref(false),error=ref(""),frameError=ref(""),notice=ref("");
const run=ref<AtomisticSnapshot|null>(null);
const frame=ref<HTMLIFrameElement|null>(null),ready=ref(false),rendered=ref(false),exporting=ref(false),selected=ref<number[]>([]);
const colors=ref<Record<string,string>>({}),bondCount=ref(0),limited=ref(false),unsupported=ref<string[]>([]),page=ref(0),frameKey=ref(0);
const config=ref<z.infer<typeof atomicViewerConfigSchema>>({artifactId:"initial",style:"ball-stick",showCell:true,showInferredBonds:true,supercell:[1,1,1],frame:0,colorBy:"element"});
const frameUrl=new URL("atomic-viewer.html",window.location.href).href;
let generation=0,drawTimer:ReturnType<typeof setTimeout>|undefined,bootTimer:ReturnType<typeof setTimeout>|undefined;
const geometry=computed(()=>{try{if(payload.value&&config.value.showCell)cellEdges(payload.value.structure.cell,config.value.supercell);return {atoms:payload.value?displayAtoms(payload.value.structure,config.value.supercell,payload.value.forcesEvPerAngstrom):[],error:""};}catch(e){return {atoms:[],error:String(e)}}});
const atoms=computed(()=>geometry.value.error && payload.value ? payload.value.structure.atoms.map((a,sourceIndex)=>({...a,sourceIndex,replica:[0,0,0] as [number,number,number],forceMagnitude:null})) : geometry.value.atoms);
const picked=computed(()=>selected.value.map(i=>atoms.value[i]).filter(a=>!!a));
const maxForce=computed(()=>Math.max(0,...atoms.value.map(a=>a.forceMagnitude??0)));
const distanceValue=computed(()=>picked.value.length>=2?distance(picked.value[0]!.position,picked.value[1]!.position).toFixed(5):null);
const angleValue=computed(()=>picked.value.length===3?angle(picked.value[0]!.position,picked.value[1]!.position,picked.value[2]!.position):null);
const rows=computed(()=>atoms.value.slice(page.value*50,(page.value+1)*50));
function send(command:unknown){frame.value?.contentWindow?.postMessage(atomicFrameCommandSchema.parse(command),"*");}
function draw(){if(ready.value&&payload.value&&!geometry.value.error)send({type:"scene",payload:payload.value,config:config.value,theme:appearanceTheme.value});}
async function load(){const request=atomicViewRequest.value;const version=++generation;ready.value=false;rendered.value=false;payload.value=null;run.value=null;error.value="";frameError.value="";notice.value="";selected.value=[];exporting.value=false;page.value=0;
 if(bootTimer)clearTimeout(bootTimer);
 if(!request)return;loading.value=true;
 try{const [view,snapshot]=await Promise.all([window.materialsx.readAtomicView(request),request.kind==='artifact'?window.materialsx.getAtomisticRun(request.projectId,request.runId):Promise.resolve(null)]);
  const result=atomicViewPayloadSchema.parse(view);if(version!==generation)return;run.value=snapshot?atomisticSnapshotSchema.parse(snapshot):null;
  config.value={artifactId:request.kind==="import"?result.structure.source.artifactId:request.artifactId,style:"ball-stick",showCell:result.structure.pbc.some(Boolean),showInferredBonds:true,supercell:[1,1,1],frame:0,colorBy:"element"};payload.value=result;
 }catch(e){if(version===generation)error.value=String(e);}finally{if(version===generation)loading.value=false;}}
async function exportSource(){const request=atomicViewRequest.value;if(!request)return;const version=generation;exporting.value=true;
 try{const saved=await window.materialsx.exportAtomicStructure(request);if(version===generation)notice.value=saved?t("已导出原始结构文件。","Original structure exported."):t("已取消导出。","Export cancelled.");}catch(e){if(version===generation)error.value=String(e);}finally{if(version===generation)exporting.value=false;}}
async function receive(event:MessageEvent){if(event.source!==frame.value?.contentWindow||!(event.origin===location.origin||(location.protocol==="file:"&&event.origin==="null")))return;
 const parsed=atomicFrameEventSchema.safeParse(event.data);if(!parsed.success)return;const value=parsed.data;
 if(value.type==="ready"){if(bootTimer)clearTimeout(bootTimer);ready.value=true;draw();}
 else if(value.type==="rendered"){rendered.value=true;bondCount.value=value.bonds;limited.value=value.limited;unsupported.value=value.unsupported;colors.value=value.colors;}
 else if(value.type==="selected")selected.value=value.indices;
 else if(value.type==="error"){frameError.value=value.message;rendered.value=false;exporting.value=false;}
 else if(value.type==="png"&&exporting.value&&atomicViewRequest.value){const request=atomicViewRequest.value;const version=generation;
  try{const saved=await window.materialsx.exportAtomicPng({request,png:value.png});if(version===generation)notice.value=saved?t("PNG 已保存到所选位置。","PNG saved."):t("已取消导出。","Export cancelled.");}catch(e){if(version===generation)error.value=String(e);}finally{if(version===generation)exporting.value=false;}}
}
watch(atomicViewRequest,()=>{send({type:"dispose"});void load();});
watch(()=>props.projectId,()=>closeAtomicView());
watch([config,appearanceTheme],()=>{if(drawTimer)clearTimeout(drawTimer);drawTimer=setTimeout(draw,40);},{deep:true});
watch(()=>config.value.supercell.join(","),()=>{selected.value=[];page.value=0;});
onMounted(()=>{window.addEventListener("message",receive);void load();});
onUnmounted(()=>{send({type:"dispose"});window.removeEventListener("message",receive);generation++;if(drawTimer)clearTimeout(drawTimer);if(bootTimer)clearTimeout(bootTimer);});
function retry(){ready.value=false;rendered.value=false;frameError.value="";frameKey.value++;}
function frameLoaded(){if(bootTimer)clearTimeout(bootTimer);if(!ready.value)bootTimer=setTimeout(()=>{if(!ready.value)frameError.value="VIEWER_INITIALIZATION_TIMEOUT";},8000);}
async function windowReveal(path:string){try{await window.materialsx.revealArtifact(path);}catch(e){error.value=String(e);}}
</script>
<template>
 <el-drawer v-model="visible" direction="rtl" size="min(960px, 96vw)" class="atomic-viewer-drawer" :with-header="false" destroy-on-close>
  <section data-testid="atomic-viewer-panel">
   <div class="heading"><div><span class="eyebrow">M6.2 · LOCAL 3D</span><h2>{{t('原子结构查看器','Atomic structure viewer')}}</h2></div><button class="icon-button" :aria-label="t('关闭结构查看器','Close structure viewer')" @click="closeAtomicView">×</button></div>
   <p v-if="loading" role="status">{{t('正在验证并读取本机结构…','Verifying and reading the local structure…')}}</p><p v-if="error" class="error" role="alert">{{error}}</p>
   <template v-if="payload">
    <p class="hint">{{payload.structure.atoms.length}} {{t('源原子','source atoms')}} · PBC {{payload.structure.pbc.map(v=>v?'T':'F').join(' ')}} · Å · {{payload.quality==='needs_review'?t('需科学复核','Needs scientific review'):t('导入结构，未计算','Imported, uncomputed')}}</p>
    <p v-for="issue in payload.structure.issues" :key="issue.code" :class="issue.severity==='blocking'?'error':'hint'">{{issue.code}} · {{issue.detail}}</p>
    <details v-if="run" class="run-details"><summary>{{t('计算参数与产物','Calculation parameters and artifacts')}} · {{run.plan.potentialId}}</summary>
     <p>{{t('总能量','Total energy')}} {{run.result?.energyEv.toFixed(8)}} eV · {{run.plan.task.kind}} · {{run.plan.device}} / {{run.plan.dtype}}</p>
     <p>{{t('预算','Budget')}}: {{run.plan.budget.maxAtoms}} {{t('原子','atoms')}} · {{run.plan.budget.maxWallSeconds}} s · {{run.plan.budget.maxMemoryMiB}} MiB · {{run.plan.budget.threads}} {{t('线程','threads')}}</p>
     <p>SHA256 {{run.plan.potentialSha256}}</p><p>{{t('选择依据','Selection origin')}}: {{run.plan.selectionEvidenceIds.join(', ')}}</p>
     <p v-if="run.result?.stress">{{t('应力','Stress')}} (xx, yy, zz, yz, xz, xy): {{run.result.stress.values.map(v=>v.toPrecision(5)).join(', ')}} eV/Å³ · {{t('拉伸为正','Positive tension')}}</p>
     <p class="hint">{{t('需科学复核：没有独立 DFT 参考标签。事件日志和 JSON 报告位于产物文件夹。','Needs scientific review: no independent DFT references. Event logs and JSON reports are in the artifact folder.')}}</p>
     <button class="secondary-button" @click="windowReveal(run.outputDirectory)">{{t('打开报告与日志','Reveal reports and logs')}}</button>
    </details>
    <div class="controls">
     <label>{{t('样式','Style')}} <select v-model="config.style" data-testid="viewer-style"><option value="ball-stick">{{t('球棍','Ball and stick')}}</option><option value="sphere">{{t('球','Spheres')}}</option><option value="stick">{{t('棒','Sticks')}}</option></select></label>
     <label><input v-model="config.showCell" type="checkbox" :disabled="!payload.structure.cell">{{payload.structure.pbc.some(Boolean)?t('晶胞边框','Cell borders'):t('显示盒边框（非周期）','Display box borders (nonperiodic)')}}</label>
     <label><input v-model="config.showInferredBonds" type="checkbox">{{t('推断邻接','Inferred adjacency')}}</label>
     <label>{{t('着色','Color')}} <select v-model="config.colorBy" data-testid="viewer-color"><option value="element">{{t('元素','Element')}}</option><option value="force-magnitude" :disabled="!payload.forcesEvPerAngstrom">{{t('力模长','Force magnitude')}}</option></select></label>
     <span v-for="(axis,i) in ['a','b','c']" :key="axis" class="axis">{{axis}} <select v-model.number="config.supercell[i]" :aria-label="`${t('显示超胞','Display supercell')} ${axis}`" :disabled="!payload.structure.pbc[i]"><option v-for="n in [1,2,3]" :key="n" :value="n" :disabled="payload.structure.atoms.length*config.supercell.reduce((s,k,j)=>s*(j===i?n:k),1)>4096">{{n}}</option></select></span>
    </div>
    <p v-if="payload.structure.pbc.some(Boolean)" class="hint">{{t('超胞仅复制显示坐标，源结构和计算数据保持不变。显示上限 4096 个原子。','Supercells copy display coordinates only. Source structures and calculations are preserved. Maximum 4096 displayed atoms.')}}</p>
    <p v-if="!payload.structure.pbc.some(Boolean)" class="hint">{{t('孤立分子：无周期复制。显示盒仅用于展示和导出，不代表晶胞或物理体积。','Isolated molecule: no periodic replication. The display box is for viewing/export, not a physical cell or volume.')}}</p>
    <div class="viewport" :data-ready="rendered">
     <iframe v-if="!frameError&&!geometry.error" :key="frameKey" ref="frame" :src="frameUrl" sandbox="allow-scripts allow-same-origin" :title="t('本地原子结构 3D','Local atomic structure 3D')" @load="frameLoaded" />
     <div v-else class="fallback"><strong>{{t('3D 暂不可用','3D unavailable')}}</strong><p>{{frameError||geometry.error}}</p><p>{{t('仍可读取下方坐标表和导出完整原始结构。','Coordinates and original structure export remain available.')}}</p><button class="secondary-button" @click="retry">{{t('重试查看器','Retry viewer')}}</button></div>
    </div>
    <p class="hint">{{t('拖动旋转；右键拖动或 Shift + 拖动平移；滚轮缩放；点击原子选择，最多三个。','Drag to rotate; right-drag or Shift-drag to pan; scroll to zoom; click up to three atoms.')}}</p>
    <div class="controls"><button class="secondary-button" :disabled="!rendered" @click="send({type:'reset'})">{{t('重置 / 适应视图','Reset / Fit view')}}</button><button class="secondary-button" :disabled="!rendered" @click="send({type:'select',index:null})">{{t('清除选择','Clear selection')}}</button><button class="secondary-button" :disabled="!rendered||exporting" @click="exporting=true;send({type:'png'})">{{t('导出 PNG','Export PNG')}}</button><button class="secondary-button" :disabled="exporting" @click="exportSource">{{run?.relaxation&&payload.structure.id!==run.structure.id?t('导出优化结构','Export optimized structure'):t('导出原始结构','Export original structure')}}</button></div>
    <p v-if="notice" class="hint" role="status">{{notice}}</p>
    <div v-if="config.colorBy==='element'" class="legend"><span v-for="(color,element) in colors" :key="element"><i :style="{background:color}" />{{element}}</span></div>
    <p v-else class="hint"><span class="force-scale" /> 0 → {{maxForce.toPrecision(5)}} eV/Å · {{t('颜色按本视图最大力自动缩放，请按绝对数值判断大小。','Colors scale to this view’s maximum force; assess magnitude using the absolute values.')}}</p>
    <p class="hint">{{config.showInferredBonds?t(`显示 ${bondCount} 条近邻连线：使用近似共价半径推断，不代表键级或计算结论；仅连接当前显示副本。`,`Showing ${bondCount} neighbor lines inferred from approximate covalent radii; these are display adjacency, not bond orders or computation results. Only displayed replicas are connected.`):t('邻接连线已关闭。','Adjacency lines disabled.')}} <span v-if="limited">{{t('密集邻接超过限制，已关闭连线。','Dense adjacency exceeded the limit; all lines disabled.')}}</span><span v-if="unsupported.length">{{t('以下元素未推断连线：','No inferred lines for:')}} {{unsupported.join(', ')}}</span></p>
    <div class="measurement" data-testid="atomic-measurement"><strong>{{t('点选原子 · 测量','Selected atoms · Measurements')}}</strong><p v-if="!picked.length" class="hint">{{t('可点选 3D 原子，或下方表格中的原子。','Pick atoms in 3D or in the coordinate table.')}}</p><p v-for="(a,i) in picked" :key="i">{{i+1}}. {{a.id}} · {{a.element}} · [{{a.replica.join(', ')}}] · ({{a.position.map(v=>v.toFixed(5)).join(', ')}}) Å <span v-if="a.forceMagnitude!==null">· |F| {{a.forceMagnitude.toPrecision(5)}} eV/Å</span></p>
     <p v-if="distanceValue">{{t('所选显示副本的笛卡尔距离','Cartesian distance between selected display replicas')}}: <strong>{{distanceValue}} Å</strong> <small>{{t('未应用最小镜像','No minimum-image transformation')}}</small></p><p v-if="picked.length===3">{{t('角度 1—2—3（以 2 为顶点）','Angle 1—2—3 (vertex 2)')}}: <strong>{{angleValue===null?t('重合坐标，角度未定义','Undefined for coincident coordinates'):angleValue.toFixed(4)+'°'}}</strong></p>
    </div>
    <details class="coordinates" open><summary>{{t('显示原子坐标','Displayed atomic coordinates')}} · {{atoms.length}}</summary><div class="table-wrap"><table><thead><tr><th>ID</th><th>{{t('元素','Element')}}</th><th>{{t('副本','Replica')}}</th><th>x / y / z (Å)</th><th>{{t('占位率','Occupancy')}}</th></tr></thead><tbody><tr v-for="(a,i) in rows" :key="page*50+i" :class="{selected:selected.includes(page*50+i)}"><td><button :disabled="!rendered" @click="send({type:'select',index:page*50+i})">{{a.id}}</button></td><td>{{a.element}}</td><td>{{a.replica.join(',')}}</td><td>{{a.position.map(v=>v.toFixed(5)).join(' / ')}}</td><td>{{a.occupancy}}</td></tr></tbody></table></div><div class="controls"><button class="secondary-button" :disabled="page===0" @click="page--">{{t('上一页','Previous')}}</button><span>{{page+1}} / {{Math.max(1,Math.ceil(atoms.length/50))}}</span><button class="secondary-button" :disabled="(page+1)*50>=atoms.length" @click="page++">{{t('下一页','Next')}}</button></div></details>
   </template>
  </section>
 </el-drawer>
</template>
<style scoped>
:global(.atomic-viewer-drawer){--el-drawer-bg-color:var(--panel);color:var(--text)}.heading,.controls,.legend{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.heading{justify-content:space-between}.heading h2{font-size:21px;margin:5px 0}.controls{margin:16px 0;font-size:13px}label,.axis{display:flex;align-items:center;gap:6px}select{padding:6px;border:1px solid var(--line);border-radius:7px;background:var(--panel-2);color:var(--text)}input{accent-color:var(--accent)}.viewport{height:clamp(300px,48vh,460px);border:1px solid var(--line);border-radius:12px;overflow:hidden;position:relative;background:var(--panel)}iframe{height:100%;width:100%;border:0}.hint,small{color:var(--muted);font-size:12px;line-height:1.7}.error{color:var(--danger,#d05252);font-size:13px;overflow-wrap:anywhere}.fallback{padding:24px;line-height:1.6}.legend{margin:14px 0;font-size:12px}.legend span{display:flex;align-items:center;gap:6px}.legend i{display:block;width:12px;height:12px;border:1px solid var(--muted);border-radius:50%}.force-scale{display:inline-block;width:100px;height:10px;background:linear-gradient(90deg,var(--accent),var(--danger));border-radius:5px;margin-right:10px}.measurement,.coordinates{border-top:1px solid var(--line);padding-top:16px;margin-top:16px;font-size:13px}.measurement p{overflow-wrap:anywhere;line-height:1.65}.run-details{font-size:12px;line-height:1.7;overflow-wrap:anywhere}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:9px 6px;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--muted)}td button{border:0;padding:3px;background:transparent;color:var(--accent);cursor:pointer}.selected td{background:var(--panel-3)}summary{cursor:pointer}.viewport[data-ready="false"]::after{content:'3D';position:absolute;top:12px;right:14px;color:var(--muted);pointer-events:none}
</style>
