<script setup lang="ts">
import { useDashboard } from '@/stores/useDashboard';
import { NetworkType } from '@/types/chaindata';
import { Icon } from '@iconify/vue';
import { computed } from 'vue';

const dashboard = useDashboard();

const isTestnet = computed(() => dashboard.networkType === NetworkType.Testnet);

function toggle() {
  dashboard.toggleNetworkType();
  window.location.href = '/';
}
</script>

<template>
  <button
    class="btn btn-sm btn-primary m-1 lowercase !inline-flex text-xs md:!text-sm"
    @click="toggle"
  >
    <Icon icon="mdi:swap-horizontal" />
    <span class="ml-1 hidden md:block">
      {{ isTestnet ? 'Testnet' : 'Mainnet' }}
    </span>
  </button>
</template>
