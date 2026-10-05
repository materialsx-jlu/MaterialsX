<script setup lang="ts">
import {ref,watch,onUnmounted} from 'vue';
import type {EngineSessionRef} from '../../../../../packages/contracts/src/engine-selection.js';
const props=defineProps<{taskId:string|undefined;projectId:string|null;locale:'zh'|'en'}>();
const session=ref<EngineSessionRef|null>(null);let generation=0;
watch(()=>[props.taskId,props.projectId],async()=>{
 const current=++generation;session.value=null;if(!props.taskId||!props.projectId)return;
 try{const actual=await window.materialsx.getEngineSession(props.taskId);if(current===generation&&actual?.task.projectId===props.projectId)session.value=actual;}catch{/* Do not infer historical identity from current settings. */}
},{immediate:true});onUnmounted(()=>generation++);
</script>
<template>
 <span v-if="session" class="execution-identity" data-testid="execution-identity" :title="locale==='zh'?'本轮实际执行配置，切换设置不会改变历史记录':'Actual execution configuration; later settings do not change history'">
  {{session.connection.modelId}} · {{session.selection.engine==='codex'?'Codex App Server':'Pi'}} {{session.selection.engineVersion}} · {{session.connection.source==='local'?(locale==='zh'?'本地':'Local'):(locale==='zh'?'平台':'Platform')}} · {{session.connection.protocol}}
 </span>
</template>
<style scoped>
.execution-identity{display:block;font-size:11px;line-height:1.6;color:var(--muted);max-width:100%;overflow-wrap:anywhere}
</style>
