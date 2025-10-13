<script lang="ts" setup>
import { computed, type PropType } from 'vue';

const props = defineProps({
  blocks: { type: Array as PropType<{ height: string; color: string }[]> },
});

const firstRow = computed(() => props.blocks?.slice(0, 25));
const secondRow = computed(() => props.blocks?.slice(25, 50));

</script>
<template>
  <div class="bg-base-200 pt-2 pb-0 rounded-lg border border-gray-200 dark:border-gray-700">
    <div class="flex flex-wrap justify-between items-center mb-0.5">
      <div class="cursor-default" v-for="(item, index) in firstRow" :key="index">
        <div class="tooltip" :data-tip="item.height">
          <div style="width: 10px; height: 10px;" class="rounded-sm" :class="item.color">&nbsp;</div>
        </div>
      </div>
    </div>
    <div class="flex flex-wrap justify-between items-center">
      <div class="cursor-default" v-for="(item, index) in secondRow" :key="index">
        <div class="tooltip" :data-tip="item.height">
          <div style="width: 10px; height: 10px;" class="rounded-sm" :class="item.color">&nbsp;</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style></style>
