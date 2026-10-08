<script setup lang="ts">
import {Copy} from '@lucide/vue';
defineProps<{examples:Array<{zh:string;en:string}>;locale:'zh'|'en'}>();
const emit=defineEmits<{'use':[prompt:string]}>();
</script>
<template>
 <div class="skill-example-list example-prompts">
  <article v-for="(example,index) in examples" :key="index" class="skill-example-card">
   <span class="skill-example-number">{{String(index+1).padStart(2,'0')}}</span>
   <p :lang="locale==='zh'?'zh-CN':'en'">{{example[locale]}}</p>
   <button class="skill-example-copy" :aria-label="locale==='zh'?`将示例 ${index+1} 填入输入框`:`Use example ${index+1} in chat`" @click="emit('use',example[locale])"><Copy :size="14"/>{{locale==='zh'?'填入输入框':'Use in chat'}}</button>
  </article>
 </div>
</template>
<style scoped>
.example-prompts{margin-top:12px;min-width:0}.skill-example-card{min-width:0;align-items:start}.skill-example-card p{grid-column:2;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;font-size:12px}.skill-example-copy{grid-column:2;max-width:100%;white-space:normal}
</style>
