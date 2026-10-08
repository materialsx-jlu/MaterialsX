<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { Check, Copy } from "@lucide/vue";
import { ElMessage } from "element-plus";

const props = defineProps<{ content: string; kind: "user" | "assistant" }>();
const copied = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

async function copy(): Promise<void> {
  try {
    let copiedToClipboard = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(props.content);
        copiedToClipboard = true;
      } catch {
        // Packaged desktop builds can deny the modern API; try the local fallback.
      }
    }
    if (!copiedToClipboard) {
      const field = document.createElement("textarea");
      field.value = props.content;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      let success = false;
      try {
        field.select();
        success = document.execCommand("copy");
      } finally {
        field.remove();
      }
      if (!success) throw new Error("Clipboard unavailable");
    }
    copied.value = true;
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    ElMessage.error("复制失败，请检查系统剪贴板权限");
  }
}
onUnmounted(() => { if (resetTimer) clearTimeout(resetTimer); });
</script>

<template>
  <button class="message-copy" type="button" :aria-label="copied ? '已复制' : kind === 'user' ? '复制提问' : '复制回复'" :title="copied ? '已复制' : '复制内容'" @click="copy">
    <Check v-if="copied" :size="15" /><Copy v-else :size="15" />
    <span>{{ copied ? "已复制" : "复制" }}</span>
  </button>
</template>

<style scoped>
.message-copy{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:64px;height:29px;margin-left:auto;padding:0 8px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--muted);font-size:11px;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
.message-copy:hover{border-color:var(--line);background:var(--panel-2);color:var(--text)}
.message-copy:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style>
