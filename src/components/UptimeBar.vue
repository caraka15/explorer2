<script lang="ts" setup>
import type { PropType } from 'vue';

const props = defineProps({
  blocks: { type: Array as PropType<{ height: string; color: string }[]> },
});
</script>
<template>
  <div class="flex gap-1 items-center">
    <div class="cursor-default" v-for="(item, index) in blocks" :key="index">
      <div class="tooltip" :data-tip="item.height">
        <div class="w-2 h-2 rounded-full" :class="item.color">&nbsp;</div>
      </div>
    </div>
  </div>
</template>

<style></style>