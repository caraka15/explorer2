<script lang="ts" setup>
import { computed, type PropType } from 'vue';

const props = defineProps({
  blocks: { type: Array as PropType<{ height: string; color: string }[]> },
});

const firstRow = computed(() => props.blocks?.slice(0, 50));
const secondRow = computed(() => props.blocks?.slice(50, 100));

</script>
<template>
  <div class="bg-base-200 p-2 rounded-lg border border-gray-200 dark:border-gray-700">
    <div class="flex flex-wrap gap-1 items-center mb-1">
      <div class="cursor-default" v-for="(item, index) in firstRow" :key="index">
        <div class="tooltip" :data-tip="item.height">
          <div class="w-2 h-2 rounded-full" :class="item.color">&nbsp;</div>
        </div>
      </div>
    </div>
    <div class="flex flex-wrap gap-1 items-center">
      <div class="cursor-default" v-for="(item, index) in secondRow" :key="index">
        <div class="tooltip" :data-tip="item.height">
          <div class="w-2 h-2 rounded-full" :class="item.color">&nbsp;</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style></style>
