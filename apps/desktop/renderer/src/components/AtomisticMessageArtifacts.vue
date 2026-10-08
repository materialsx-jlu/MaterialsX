<script setup lang="ts">
import { ref,watch,onUnmounted } from "vue";
import type { ScientificSnapshot as AtomisticSnapshot } from "../../../../../packages/contracts/src/atomistic-dynamics.js";
import AtomicArtifactCard from "./AtomicArtifactCard.vue";
import { readReferencedAtomicRuns } from "../utils/atomic-viewer";
const props=defineProps<{projectId:string|null;content:string;locale:"zh"|"en"}>();
const runs=ref<AtomisticSnapshot[]>([]);let generation=0;
watch(()=>[props.projectId,props.content],async()=>{
 const current=++generation;runs.value=[];if(!props.projectId||!/[a-f0-9]{8}-[a-f0-9-]{27,}/i.test(props.content))return;
 try{const jobs=await readReferencedAtomicRuns(props.projectId);if(current===generation)runs.value=jobs.filter(run=>run.job.status==="completed"&&(props.content.includes(run.job.id)||run.artifacts.some(a=>props.content.includes(a.id))));}catch{/* A text reference cannot authorize unregistered artifacts. */}
},{immediate:true});
onUnmounted(()=>generation++);
</script>
<template><AtomicArtifactCard v-for="run in runs" :key="run.job.id" :run="run" :locale="locale" /></template>
