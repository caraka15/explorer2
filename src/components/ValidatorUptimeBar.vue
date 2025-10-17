<script lang="ts" setup>
import type { PropType } from 'vue';

const props = defineProps({
  blocks: { type: Array as PropType<{ height: string; color: string }[]> },
});

const getTooltipText = (item: { height: string; color: string }) => {
  let status = '';
  if (item.color === 'bg-green-500') {
    status = 'Committed';
  } else if (item.color === 'bg-yellow-500') {
    status = 'Precommitted';
  } else if (item.color === 'bg-red-500') {
    status = 'Missed';
  }
  return `Block: ${item.height}\nStatus: ${status}`;
};

</script>
<template>
  <div class="bg-base-200 p-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
    <div class="flex flex-nowrap gap-0.5 items-center">
      <div class="tooltip flex-auto" v-for="(item, index) in props.blocks" :key="index" :data-tip="getTooltipText(item)">
        <div style="height: 20px;" class="rounded-sm" :class="item.color">&nbsp;</div>
      </div>
    </div>
  </div>
</template>

<style></style>
