<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import type { InstalledSkill } from '../../../../../packages/contracts/src/skill-installation.js';
import type { SkillSummary } from '../../../../../packages/contracts/src/desktop.js';
const props=defineProps<{locale:'zh'|'en';skills:SkillSummary[]}>();
const emit=defineEmits<{example:[prompt:string]}>();
const api=window.materialsx;
const t=(zh:string,en:string)=>props.locale==='zh'?zh:en;
const records=ref<InstalledSkill[]>([]),busy=ref(false),error=ref('');
const description=(r:InstalledSkill)=>{const summary=props.skills.find(s=>s.name===r.name&&s.category==='supervisor-local');return summary?(props.locale==='zh'?summary.descriptionZh:summary.descriptionEn):r.description[props.locale]};
const source=(r:InstalledSkill)=>props.skills.some(s=>s.name===r.name&&s.category==='supervisor-local')?'HKUSTDial/Supervisor-Skills · 207bc6f · 本机测试':r.source;
async function refresh(){records.value=await window.materialsx.listInstalledSkills();}
async function act(f:()=>Promise<void>){busy.value=true;error.value='';try{await f();await refresh();}catch(e){error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;}}
let remove:(()=>void)|undefined;
onMounted(()=>{void act(refresh);remove=window.materialsx.onSkillsChanged(()=>void act(refresh));});
onUnmounted(()=>remove?.());
</script>
<template>
  <section class="installed-skills-panel" data-testid="installed-skills">
    <div class="installed-heading"><strong>{{t('扩展 Skills','Extension Skills')}} <span>{{records.length}}</span></strong></div>
    <p>{{t('在对话中发送安装指令，完成后即可通过 @ 使用。支持 GitHub Skill 目录和本地文件夹；仅提供名称时，会查找内置目录及已知官方来源。','Send an install command in chat, then use the Skill through @. Supports GitHub Skill directories and local folders. Names are resolved from bundled and known official catalogs.')}}</p>
    <div class="installed-examples">
      <button class="skill-example-copy" @click="emit('example',t('安装 Skill frontend-design','Install Skill frontend-design'))">{{t('试用：按名称安装','Try: install by name')}}</button>
      <code>{{t('安装 Skill /绝对路径/我的-skill','Install Skill /absolute/path/my-skill')}}</code>
    </div>
    <div v-if="records.length" class="installed-list">
      <article v-for="r in records" :key="r.name">
        <div><strong>{{r.name}}</strong><p>{{description(r)}}</p><small>{{t('来源','Source')}}: {{source(r)}} · {{r.files.length}} {{t('个文件','files')}}</small></div>
        <div class="installed-actions">
          <button class="skill-example-copy" :disabled="!r.enabled" @click="emit('example',`@${r.name} `)">{{t('使用','Use')}}</button>
          <button class="skill-example-copy" :disabled="busy" @click="act(()=>api.enableInstalledSkill(r.name,!r.enabled))">{{r.enabled?t('停用','Disable'):t('启用','Enable')}}</button>
          <button class="skill-example-copy" :disabled="busy" @click="act(()=>api.removeInstalledSkill(r.name))">{{t('移除','Remove')}}</button>
        </div>
      </article>
    </div>
    <p class="installed-note">{{t('安装仅保存 Skill 文件，不执行脚本、不安装依赖。原始步骤与许可保持不变；未提供中文简介的扩展显示来源原文。移除的文件保留在本机回收目录。','Installation saves files without executing scripts or installing dependencies. Original instructions and licenses are preserved; untranslated descriptions use source text. Removed packages remain in a local trash directory.')}}</p>
    <p v-if="error" role="alert">{{error}}</p>
  </section>
</template>
<style scoped>
.installed-skills-panel{max-width:1120px;margin:16px auto;padding:16px;border:1px solid var(--line);border-radius:9px;background:var(--catalog-surface);color:var(--text);min-width:0}
.installed-heading strong{font-size:14px}.installed-heading span{font-weight:400;color:var(--muted);margin-left:8px}
p,small,code{font-size:12px;line-height:1.7;color:var(--muted);overflow-wrap:anywhere}p{margin:8px 0}.installed-examples,.installed-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.installed-list{display:grid;margin-top:14px}.installed-list article{display:flex;gap:16px;justify-content:space-between;align-items:center;padding:14px 0;border-top:1px solid var(--line);min-width:0}.installed-list article>div:first-child{min-width:0;flex:1}.installed-note{margin-bottom:0}
@media(max-width:760px){.installed-list article{align-items:flex-start;flex-direction:column}}
</style>
