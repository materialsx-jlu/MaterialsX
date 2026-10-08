<script setup lang="ts">
import {ref,watch,onUnmounted,computed} from 'vue';
import {ElDrawer} from 'element-plus';
import MarkdownContent from './MarkdownContent.vue';
import type {DeliveryRecord} from '../../../../../packages/contracts/src/research-project.js';
const props=defineProps<{projectId:string|null;content:string;locale:'zh'|'en'}>();
const records=ref<DeliveryRecord[]>([]),preview=ref(''),kind=ref(''),error=ref('');let generation=0;
const t=(zh:string,en:string)=>props.locale==='zh'?zh:en;
watch(()=>[props.projectId,props.content],async()=>{const current=++generation;records.value=[];if(!props.projectId||!/[a-f0-9]{8}-[a-f0-9-]{27,}/i.test(props.content))return;
 try{const deliveries=await window.materialsx.listResearchDeliveries(props.projectId);if(current===generation)records.value=deliveries.filter(d=>props.content.includes(d.id));}catch{/* Message text cannot grant ownership of an artifact. */}
},{immediate:true});onUnmounted(()=>generation++);
async function show(d:DeliveryRecord,k:'table'|'chart'|'report'){error.value='';try{if(!props.projectId)return;preview.value=await window.materialsx.previewResearchArtifact(props.projectId,d.id,k);kind.value=k;}catch(e){error.value=String(e);}}
const svg=computed(()=>kind.value==='chart'?'data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(preview.value))):'');
</script>
<template>
 <article v-for="d in records" :key="d.id" class="research-artifact"><strong>{{t('研究交付','Research deliverables')}}</strong><p>{{d.status}} · {{t('科学结论待复核','Scientific conclusions need review')}}</p><div class="buttons"><button v-for="a in d.artifacts.filter(a=>a.kind!=='image')" :key="a.path" @click="show(d,a.kind as 'table'|'chart'|'report')">{{({table:t('数据表','Table'),chart:t('概览图','Overview'),report:t('报告','Report'),image:t('图片','Image')})[a.kind]}}</button></div><p v-if="d.limitations.length" class="muted">{{d.limitations.join(' · ')}}</p></article>
 <p v-if="error" role="alert">{{error}}</p>
 <ElDrawer :model-value="!!preview" :title="t('研究产物预览','Research artifact preview')" size="min(1080px,96vw)" @update:model-value="preview=''"><MarkdownContent v-if="kind==='report'" :content="preview"/><img v-else-if="kind==='chart'" :src="svg" alt="Source overview"/><pre v-else>{{preview}}</pre></ElDrawer>
</template>
<style scoped>
.research-artifact{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:16px;margin:12px 0;color:var(--text);min-width:0;overflow-wrap:anywhere}.research-artifact p{font-size:12px;line-height:1.6}.buttons{display:flex;gap:8px;flex-wrap:wrap}button{background:var(--panel-2);color:var(--text);border:1px solid var(--line);padding:8px 12px;border-radius:8px;cursor:pointer}.muted{color:var(--muted)}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text);font-size:12px}
</style>
