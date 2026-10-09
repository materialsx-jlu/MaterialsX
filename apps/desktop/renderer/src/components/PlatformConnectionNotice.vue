<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref} from 'vue';
import type {PlatformConfiguration} from '../../../main/platform-configuration.js';

const state=ref<PlatformConfiguration|null>(null);
const message=computed(()=>{
  if(!state.value)return '正在检查平台连接…';
  if(state.value.connection==='unconfigured')return '此安装包尚未配置平台服务；本地模型仍可使用。';
  if(state.value.connection==='offline')return state.value.stale
    ? '平台暂不可达；所示目录信息可能已过期。购买、扣费与价格以恢复连接后的实时结果为准。本地模型仍可使用。'
    : '平台暂不可达；请检查网络或服务状态。本地模型仍可使用。';
  const availability=state.value.remote?.availability;
  if(availability?.models?.reason==='paused')return '云模型暂不可用；平台已暂停新调用。本地模型仍可使用。';
  if(availability?.payments?.reason==='paused')return '新订单暂不可用；已有订单和账单仍可查询。';
  return '';
});
let stop:()=>void=()=>{};
async function load(){state.value=await window.materialsx.getPlatformConfiguration().catch(()=>null)}
onMounted(()=>{void load();stop=window.materialsx.onPlatformConfigurationChanged(()=>void load())});
onUnmounted(()=>stop());
</script>
<template><p v-if="message" class="platform-connection-notice" role="status">{{message}}</p></template>
<style scoped>
.platform-connection-notice{margin:0 0 14px;padding:11px 14px;border:1px solid var(--line);border-radius:10px;background:var(--catalog-surface);color:var(--muted);font-size:13px;line-height:1.6;overflow-wrap:anywhere}
</style>
