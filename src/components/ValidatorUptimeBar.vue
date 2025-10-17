<script lang="ts" setup>
import type { PropType } from 'vue';

const props = defineProps({
  blocks: { type: Array as PropType<{ height: string; color: string }[]> },
});

</script>
<template>
  <div class="bg-base-200 p-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
    <div class="flex flex-nowrap gap-0.5 items-center">
      <div class="tooltip flex-auto" v-for="(item, index) in props.blocks" :key="index" :data-tip="item.height">
        <div style="height: 20px;" class="rounded-sm" :class="item.color">&nbsp;</div>
      </div>
    </div>
  </div>
</template>

<style></style>
