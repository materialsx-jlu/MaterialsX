<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { renderMarkdown } from "../plugins/markdown";

const props = withDefaults(
  defineProps<{
    content: string;
    streaming?: boolean;
  }>(),
  { streaming: false },
);

const html = ref("");
const linkError = ref("");
async function revealLink(event: MouseEvent): Promise<void> {
  const anchor = event.target instanceof Element ? event.target.closest("a") : null;
  const href = anchor?.getAttribute("href");
  if (!href || !/^(?:\/|[A-Za-z]:[\\/])/.test(href)) return;
  event.preventDefault();
  linkError.value = "";
  try { await window.materialsx.revealArtifact(decodeURIComponent(href)); }
  catch (error) { linkError.value = error instanceof Error ? error.message : String(error); }
}
let timer: ReturnType<typeof setTimeout> | undefined;
let pending = props.content;

function flush(): void {
  timer = undefined;
  html.value = renderMarkdown(pending);
}

watch(
  () => [props.content, props.streaming] as const,
  ([content, streaming]) => {
    pending = content;

    if (!streaming) {
      if (timer) clearTimeout(timer);
      flush();
      return;
    }

    if (!html.value) {
      flush();
      return;
    }

    // A model can emit many tiny deltas per second. Rendering at most once per
    // frame-sized interval keeps typing and scrolling responsive.
    if (!timer) timer = setTimeout(flush, 48);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <div :class="['markdown-content', { streaming }]" @click="revealLink" v-html="html" />
  <p v-if="linkError" role="alert">{{ linkError }}</p>
</template>
