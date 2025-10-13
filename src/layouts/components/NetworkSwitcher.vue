<script setup lang="ts">
import { useDashboard } from '@/stores/useDashboard';
import { NetworkType } from '@/types/chaindata';
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
  <div
    class="relative flex items-center w-36 h-8 bg-gray-200 dark:bg-gray-700 rounded-full cursor-pointer transition-colors duration-300 ease-in-out"
    @click="toggle"
  >
    <div
      class="absolute left-0 w-1/2 h-full bg-primary rounded-full shadow-md transform transition-transform duration-300 ease-in-out"
      :class="{ 'translate-x-full': isTestnet }"
    ></div>
    <div class="relative z-10 w-full flex justify-around text-xs font-semibold">
      <span :class="{ 'text-white': !isTestnet, 'text-gray-500': isTestnet }">Mainnet</span>
      <span :class="{ 'text-white': isTestnet, 'text-gray-500': !isTestnet }">Testnet</span>
    </div>
  </div>
</template>
