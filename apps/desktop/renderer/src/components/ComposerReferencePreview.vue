<script setup lang="ts">
import type {ReferenceCandidate} from '../utils/reference-candidates';
defineProps<{references:ReferenceCandidate[]}>();
</script>
<template>
 <div v-if="references.length" class="composer-references" data-testid="composer-references" aria-label="本轮引用资源">
  <details v-for="ref in references" :key="ref.kind+ref.id">
   <summary><span>{{ref.kind}}</span><strong>{{ref.label}}</strong><small>{{ref.status}}</small></summary>
   <p>ID：{{ref.id}}<br>版本 / Version：{{ref.version}}<br>读取范围 / Read range：{{ref.range}}</p>
  </details>
  <small class="reference-note">发送时会核对项目和版本；引用不会自动增加权限。</small>
 </div>
</template>
<style scoped>
.composer-references{display:grid;gap:5px;width:100%;min-width:0;max-height:148px;overflow:auto;margin-bottom:9px;color:var(--muted);font-size:12px}
.composer-references details{min-width:0;border:1px solid var(--line);border-radius:8px;background:var(--panel-2)}
summary{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(0,auto);align-items:center;gap:9px;min-width:0;padding:8px 11px;cursor:pointer}
summary strong{min-width:0;overflow:hidden;color:var(--text);font-size:12px;text-overflow:ellipsis;white-space:nowrap}
summary span{padding:2px 5px;border-radius:4px;background:var(--panel-3);font-size:10px;text-transform:uppercase}
summary small{max-width:230px;overflow:hidden;color:var(--muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
p{overflow-wrap:anywhere;line-height:1.6;margin:0;padding:8px 11px;border-top:1px solid var(--line-soft)}
.reference-note{display:block;overflow-wrap:anywhere;color:var(--muted);font-size:11px;line-height:1.45}
@media(max-width:620px){summary{grid-template-columns:auto minmax(0,1fr)}summary small{grid-column:2;max-width:100%}}
</style>
