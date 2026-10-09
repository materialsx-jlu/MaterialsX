<script setup lang="ts">
import { MessageSquare, Plus } from '@lucide/vue';
import type { ConversationRecord, ProjectRecord } from '../../../../../packages/contracts/src/desktop.js';

defineProps<{project: ProjectRecord; conversations: ConversationRecord[]}>();
const emit = defineEmits<{select: [id: string]; create: []}>();
</script>

<template>
  <section class="catalog-view project-conversations-view">
    <div class="page-heading">
      <div><span class="eyebrow">PROJECT CONVERSATIONS</span><h1>{{ project.name }}</h1><p>此项目的全部会话 · {{ conversations.length }} 条</p></div>
      <button class="primary-button" @click="emit('create')"><Plus :size="15" />新建研究任务</button>
    </div>
    <div v-if="conversations.length" class="project-conversation-list">
      <button v-for="conversation in conversations" :key="conversation.id" class="project-conversation-row" @click="emit('select', conversation.id)">
        <span class="project-conversation-icon"><MessageSquare :size="17" /></span>
        <span class="project-conversation-copy"><strong>{{ conversation.title }}</strong><small>更新于 {{ new Date(conversation.updatedAt).toLocaleString('zh-CN') }}</small></span>
        <span aria-hidden="true">›</span>
      </button>
    </div>
    <div v-else class="empty-list"><MessageSquare :size="26" /><strong>还没有会话</strong><span>新建研究任务后，会话会保存在此项目中。</span></div>
  </section>
</template>

<style scoped>
.project-conversation-list{width:100%;max-width:1120px;margin:0 auto;border:1px solid var(--line);border-radius:9px;overflow:hidden;background:var(--catalog-surface)}
.project-conversation-row{display:flex;align-items:center;gap:14px;width:100%;min-height:76px;padding:15px 20px;border:0;border-bottom:1px solid var(--line-soft);background:transparent;color:var(--text);text-align:left;cursor:pointer}
.project-conversation-row:last-child{border-bottom:0}.project-conversation-row:hover,.project-conversation-row:focus-visible{background:var(--panel-3)}
.project-conversation-icon{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:8px;background:var(--accent-bg);color:var(--accent)}
.project-conversation-copy{display:grid;gap:5px;min-width:0;flex:1}.project-conversation-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}.project-conversation-copy small{color:var(--dim);font-size:11px}
.project-conversation-row>span:last-child{color:var(--dim);font-size:22px}
</style>
