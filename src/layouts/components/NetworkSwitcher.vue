<script setup lang="ts">
import { useDashboard } from '@/stores/useDashboard';
import { NetworkType } from '@/types/chaindata';
import { Icon } from '@iconify/vue';
import { computed } from 'vue';

const dashboard = useDashboard();

const mainnetDomain = 'explorer.crxanode.me';
const testnetDomain = 'testnet-explorer.crxanode.me';

const isTestnet = computed(() => dashboard.networkType === NetworkType.Testnet);

function toggle() {
  const newDomain = isTestnet.value ? mainnetDomain : testnetDomain;
  window.location.href = `https://${newDomain}`;
}
</script>

<template>
  <button
    class="btn btn-sm btn-primary m-1 lowercase !inline-flex text-xs md:!text-sm group"
    @click="toggle"
  >
    <Icon icon="mdi:swap-horizontal" />
    <span class="ml-1 w-0 group-hover:w-auto transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap md:w-auto">
      {{ isTestnet ? 'Mainnet' : 'Testnet' }}
    </span>
  </button>
</template>