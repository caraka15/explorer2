<script lang="ts" setup>
import { useBlockchain, useFormatter, useStakingStore, useTxDialog } from '@/stores';
import DynamicComponent from '@/components/dynamic/DynamicComponent.vue';
import DonutChart from '@/components/charts/DonutChart.vue';
import { computed, ref } from '@vue/reactivity';
import { onMounted, watch } from 'vue';
import { Icon } from '@iconify/vue';

import type { AuthAccount, Delegation, TxResponse, DelegatorRewards, UnbondingResponses } from '@/types';
import type { Coin } from '@cosmjs/amino';
import Countdown from '@/components/Countdown.vue';
import { fromBase64 } from '@cosmjs/encoding';

const props = defineProps(['address', 'chain']);
const textDecoder = new TextDecoder();

const blockchain = useBlockchain();
const stakingStore = useStakingStore();
const dialog = useTxDialog();
const format = useFormatter();
const account = ref({} as AuthAccount);
const txs = ref([] as TxResponse[]);
const delegations = ref([] as Delegation[]);
const rewards = ref({} as DelegatorRewards);
const balances = ref([] as Coin[]);
const recentReceived = ref([] as TxResponse[]);
const unbonding = ref([] as UnbondingResponses[]);
const unbondingTotal = ref(0);
const chart = {};
const txSortOrder = ref<'latest' | 'oldest'>('latest');
const receivedSortOrder = ref<'latest' | 'oldest'>('latest');
const txLoading = ref(false);
const receivedLoading = ref(false);
onMounted(() => {
  loadAccount(props.address);
});

const bondDenom = computed(() => stakingStore.params?.bond_denom || blockchain.current?.assets?.[0]?.base || '');

const balanceAggregate = computed(() => aggregateBalances(bondDenom.value));
const delegationAggregate = computed(() => aggregateDelegations(bondDenom.value));
const rewardsAggregate = computed(() => aggregateRewards(bondDenom.value));
const unbondingAggregate = computed(() => aggregateUnbonding(bondDenom.value));

const balanceDisplayAmount = computed(() => displayAmount(balanceAggregate.value));
const delegationDisplayAmount = computed(() => displayAmount(delegationAggregate.value));
const rewardsDisplayAmount = computed(() => displayAmount(rewardsAggregate.value));
const unbondingDisplayAmount = computed(() => displayAmount(unbondingAggregate.value));

const totalAmountByCategory = computed(() => [
  balanceDisplayAmount.value,
  delegationDisplayAmount.value,
  rewardsDisplayAmount.value,
  unbondingDisplayAmount.value,
]);

const labels = ['Balance', 'Delegation', 'Reward', 'Unbonding'];

const totalAmount = computed(() => totalAmountByCategory.value.reduce((sum, value) => sum + value, 0));

const totalValue = computed(() => {
  let value = 0;
  delegations.value?.forEach((x) => {
    value += format.tokenValueNumber(x.balance);
  });
  rewards.value?.total?.forEach((x) => {
    value += format.tokenValueNumber(x);
  });
  balances.value?.forEach((x) => {
    value += format.tokenValueNumber(x);
  });
  unbonding.value?.forEach((x) => {
    x.entries?.forEach((y) => {
      value += format.tokenValueNumber({ amount: y.balance, denom: stakingStore.params.bond_denom });
    });
  });
  return format.formatNumber(value, '0,0.00');
});

const assetSummaries = computed(() => {
  const total = totalAmount.value;
  const entries = [
    {
      key: 'balance',
      labelKey: 'account.balance',
      icon: 'mdi-wallet',
      iconClass: 'text-info',
      bgClass: 'bg-info',
      coin: balanceAggregate.value,
      amount: balanceDisplayAmount.value,
    },
    {
      key: 'delegation',
      labelKey: 'account.delegations',
      icon: 'mdi-account-arrow-left',
      iconClass: 'text-warning',
      bgClass: 'bg-warning',
      coin: delegationAggregate.value,
      amount: delegationDisplayAmount.value,
    },
    {
      key: 'reward',
      labelKey: 'account.rewards',
      icon: 'mdi-trophy-outline',
      iconClass: 'text-success',
      bgClass: 'bg-success',
      coin: rewardsAggregate.value,
      amount: rewardsDisplayAmount.value,
    },
    {
      key: 'unbonding',
      labelKey: 'account.unbonding_delegations',
      icon: 'mdi-account-arrow-right',
      iconClass: 'text-error',
      bgClass: 'bg-error',
      coin: unbondingAggregate.value,
      amount: unbondingDisplayAmount.value,
    },
  ];

  return entries.map((entry) => ({
    key: entry.key,
    labelKey: entry.labelKey,
    icon: entry.icon,
    iconClass: entry.iconClass,
    bgClass: entry.bgClass,
    amountLabel: formatSummaryAmount(entry.coin),
    percent: format.calculatePercent(entry.amount, total),
    valueLabel: formatSummaryValue(entry.coin),
  }));
});

const sortedTxs = computed(() => sortTransactions(txs.value, txSortOrder.value));
const sortedReceived = computed(() => sortTransactions(recentReceived.value, receivedSortOrder.value));

function loadAccount(address: string) {
  blockchain.rpc.getAuthAccount(address).then((x) => {
    account.value = x.account;
  });
  blockchain.rpc.getDistributionDelegatorRewards(address).then((x) => {
    rewards.value = x;
  });
  blockchain.rpc.getStakingDelegations(address).then((x) => {
    delegations.value = x.delegation_responses;
  });
  blockchain.rpc.getBankBalances(address).then((x) => {
    balances.value = x.balances;
  });
  blockchain.rpc.getStakingDelegatorUnbonding(address).then((x) => {
    unbondingTotal.value = 0;
    unbonding.value = x.unbonding_responses;
    x.unbonding_responses?.forEach((y) => {
      y.entries.forEach((z) => {
        unbondingTotal.value += Number(z.balance);
      });
    });
  });

  void loadTransactions(address);
  void loadRecentReceived(address);
}

function updateEvent() {
  loadAccount(props.address);
}

function toTimestamp(value?: string) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isNaN(time) ? 0 : time;
}

function sortTransactions(list: TxResponse[] | undefined, order: 'latest' | 'oldest') {
  const source = Array.isArray(list) ? list : [];
  return [...source].sort((a, b) => {
    const diff = toTimestamp(a?.timestamp) - toTimestamp(b?.timestamp);
    return order === 'latest' ? -diff : diff;
  });
}

async function loadTransactions(address: string) {
  txLoading.value = true;
  try {
    const orderParam = txSortOrder.value === 'latest' ? 2 : 1;
    const query = `?order_by=${orderParam}&events=message.sender='${address}'&pagination.limit=100`;
    const response = await blockchain.rpc.getTxs(query, {});
    txs.value = response.tx_responses || [];
  } finally {
    txLoading.value = false;
  }
}

async function loadRecentReceived(address: string) {
  receivedLoading.value = true;
  try {
    const orderParam = receivedSortOrder.value === 'latest' ? 2 : 1;
    const query = `?order_by=${orderParam}&events=transfer.recipient='${address}'&pagination.limit=100`;
    const response = await blockchain.rpc.getTxs(query, {});
    recentReceived.value = response.tx_responses || [];
  } finally {
    receivedLoading.value = false;
  }
}

function setTxSort(order: 'latest' | 'oldest') {
  if (txSortOrder.value !== order) {
    txSortOrder.value = order;
  }
}

function setReceivedSort(order: 'latest' | 'oldest') {
  if (receivedSortOrder.value !== order) {
    receivedSortOrder.value = order;
  }
}

function aggregateBalances(denom: string) {
  if (!denom) return undefined;
  let total = 0n;
  balances.value?.forEach((coin) => {
    if (coin?.denom === denom) {
      total += BigInt(coin.amount || '0');
    }
  });
  return { denom, amount: total.toString() };
}

function aggregateDelegations(denom: string) {
  if (!denom) return undefined;
  let total = 0n;
  delegations.value?.forEach((delegation) => {
    if (delegation?.balance?.denom === denom) {
      total += BigInt(delegation.balance.amount || '0');
    }
  });
  return { denom, amount: total.toString() };
}

function aggregateRewards(denom: string) {
  if (!denom) return undefined;
  let total = 0n;
  rewards.value?.total?.forEach((reward) => {
    if (reward?.denom === denom) {
      total += BigInt(reward.amount || '0');
    }
  });
  return { denom, amount: total.toString() };
}

function aggregateUnbonding(denom: string) {
  if (!denom) return undefined;
  let total = 0n;
  unbonding.value?.forEach((item) => {
    item.entries?.forEach((entry) => {
      if (entry?.balance) {
        total += BigInt(entry.balance || '0');
      }
    });
  });
  return { denom, amount: total.toString() };
}

function displayAmount(coin?: Coin) {
  if (!coin) return 0;
  return format.tokenDisplayNumber(coin);
}

function formatSummaryAmount(coin?: Coin) {
  if (!coin) return '0';
  const amount = format.tokenDisplayNumber(coin);
  const formattedAmount =
    !amount ? '0' : format.formatNumber(amount, '0,0.[000000]') || amount.toString();
  const denom = format.tokenDisplayDenom(coin.denom) || coin.denom;
  return `${formattedAmount} ${denom.toUpperCase()}`;
}

function formatSummaryValue(coin?: Coin) {
  if (!coin) return '0';
  const value = format.tokenValue(coin);
  return value || '0';
}

watch(txSortOrder, () => {
  if (props.address) {
    loadTransactions(props.address);
  }
});

watch(receivedSortOrder, () => {
  if (props.address) {
    loadRecentReceived(props.address);
  }
});

function decodeAttribute(raw?: string) {
  if (!raw) return '';
  try {
    const decoded = textDecoder.decode(fromBase64(raw));
    return decoded;
  } catch (err) {
    return raw;
  }
}

function attributeMatches(rawKey: string, expected: string) {
  const decoded = decodeAttribute(rawKey);
  return decoded === expected || rawKey === expected;
}

function mapAmount(events: { type: string; attributes: { key: string; value: string }[] }[]) {
  if (!events) return [];
  const transferTotals = collectTransferAmounts(events);
  if (transferTotals.length > 0) return transferTotals.map(formatEventCoin);

  const coinReceivedTotals = collectCoinReceivedAmounts(events);
  if (coinReceivedTotals.length > 0) return coinReceivedTotals.map(formatEventCoin);

  return [];
}

function collectTransferAmounts(events: { type: string; attributes: { key: string; value: string }[] }[]) {
  const totals: Record<string, bigint> = {};
  events
    .filter((event) => {
      const type = decodeAttribute(event.type);
      return type === 'transfer' || event.type === 'transfer';
    })
    .forEach((event) => {
      let currentRecipient = '';
      event.attributes?.forEach((attr) => {
        const key = decodeAttribute(attr.key);
        const value = decodeAttribute(attr.value);
        if (key === 'recipient') {
          currentRecipient = value;
        } else if (key === 'amount' && currentRecipient === props.address) {
          addAmountsToTotals(value, totals);
          currentRecipient = '';
        }
      });
    });
  return Object.entries(totals).map(([denom, amount]) => ({ denom, amount }));
}

function collectCoinReceivedAmounts(events: { type: string; attributes: { key: string; value: string }[] }[]) {
  const totals: Record<string, bigint> = {};
  const coinReceivedEvent = events.find(
    (event) => decodeAttribute(event.type) === 'coin_received' || event.type === 'coin_received'
  );
  coinReceivedEvent?.attributes
    ?.filter((attr) => attributeMatches(attr.key, 'amount'))
    .forEach((attr) => {
      const value = decodeAttribute(attr.value);
      addAmountsToTotals(value, totals);
    });
  return Object.entries(totals).map(([denom, amount]) => ({ denom, amount }));
}

function addAmountsToTotals(value: string, totals: Record<string, bigint>) {
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const match = entry.match(/^(\d+)([a-zA-Z0-9/]+)$/);
      if (!match) return;
      const [, amountStr, denom] = match;
      const bigintAmount = BigInt(amountStr);
      totals[denom] = (totals[denom] || 0n) + bigintAmount;
    });
}

function formatEventCoin(coin: { denom: string; amount: bigint }) {
  const exponent = format.exponentForDenom(coin.denom) || 0;
  const numericAmount = Number(coin.amount) / Math.pow(10, exponent);
  const formattedAmount =
    numericAmount === 0
      ? '0'
      : format.formatNumber(numericAmount, '0,0.[000000]') || numericAmount.toString();
  const displayDenom = format.tokenDisplayDenom(coin.denom) || coin.denom;
  return `${formattedAmount} ${displayDenom.toUpperCase()}`;
}
</script>
<template>
  <div v-if="account">
    <!-- address -->
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow">
      <div class="flex items-center">
        <!-- img -->
        <div class="inline-flex relative w-11 h-11 rounded-md">
          <div class="w-11 h-11 absolute rounded-md opacity-10 bg-primary"></div>
          <div class="w-full inline-flex items-center align-middle flex-none justify-center">
            <Icon icon="mdi-qrcode" class="text-primary" style="width: 27px; height: 27px" />
          </div>
        </div>
        <!-- content -->
        <div class="flex flex-1 flex-col truncate pl-4">
          <h2 class="text-sm card-title">{{ $t('account.address') }}:</h2>
          <span class="text-xs truncate"> {{ address }}</span>
        </div>
      </div>
    </div>

    <!-- Assets -->
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow">
      <div class="flex justify-between">
        <h2 class="card-title mb-4">{{ $t('account.assets') }}</h2>
        <!-- button -->
        <div class="flex justify-end mb-4 pr-5">
          <label for="send" class="btn btn-primary btn-sm mr-2" @click="dialog.open('send', {}, updateEvent)">{{
            $t('account.btn_send')
          }}</label>
          <label
            for="transfer"
            class="btn btn-primary btn-sm"
            @click="
              dialog.open(
                'transfer',
                {
                  chain_name: blockchain.current?.prettyName,
                },
                updateEvent
              )
            "
            >{{ $t('account.btn_transfer') }}</label
          >
        </div>
      </div>
      <div class="grid md:!grid-cols-3">
        <div class="md:!col-span-1">
          <DonutChart :series="totalAmountByCategory" :labels="labels" />
        </div>
        <div class="mt-4 md:!col-span-2 md:!mt-0 md:!ml-4">
          <div class="space-y-3">
            <div
              v-for="summary in assetSummaries"
              :key="summary.key"
              class="flex items-center px-4 py-3 rounded-lg border border-base-200 bg-base-100"
            >
              <div class="w-9 h-9 rounded overflow-hidden flex items-center justify-center relative mr-4">
                <Icon :icon="summary.icon" :class="summary.iconClass" size="20" />
                <div class="absolute top-0 bottom-0 left-0 right-0 opacity-20" :class="summary.bgClass"></div>
              </div>
              <div class="flex-1">
                <div class="text-xs uppercase text-base-content/60">
                  {{ $t(summary.labelKey) }}
                </div>
                <div class="text-sm font-semibold">
                  {{ summary.amountLabel }}
                </div>
                <div class="text-xs text-base-content/60">
                  {{ summary.percent }}
                </div>
              </div>
              <div class="text-xs truncate relative py-1 px-3 rounded-full w-fit text-primary dark:invert">
                <span class="inset-x-0 inset-y-0 opacity-10 absolute" :class="summary.bgClass"></span>
                ${{ summary.valueLabel }}
              </div>
            </div>
          </div>
          <div class="mt-4 text-lg font-semibold mr-5 pl-5 border-t pt-4 text-right">
            {{ $t('account.total_value') }}: ${{ totalValue }}
          </div>
        </div>
      </div>
    </div>

    <!-- Delegations -->
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow">
      <div class="flex justify-between">
        <h2 class="card-title mb-4">{{ $t('account.delegations') }}</h2>
        <div class="flex justify-end mb-4">
          <label for="delegate" class="btn btn-primary btn-sm mr-2" @click="dialog.open('delegate', {}, updateEvent)">{{
            $t('account.btn_delegate')
          }}</label>
          <label for="withdraw" class="btn btn-primary btn-sm" @click="dialog.open('withdraw', {}, updateEvent)">{{
            $t('account.btn_withdraw')
          }}</label>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="table w-full text-sm table-zebra">
          <thead>
            <tr>
              <th class="py-3">{{ $t('account.validator') }}</th>
              <th class="py-3">{{ $t('account.delegation') }}</th>
              <th class="py-3">{{ $t('account.rewards') }}</th>
              <th class="py-3">{{ $t('account.action') }}</th>
            </tr>
          </thead>
          <tbody class="text-sm">
            <tr v-if="delegations.length === 0">
              <td colspan="10">
                <div class="text-center">{{ $t('account.no_delegations') }}</div>
              </td>
            </tr>
            <tr v-for="(v, index) in delegations" :key="index">
              <td class="text-caption text-primary py-3">
                <RouterLink :to="`/${chain}/staking/${v.delegation.validator_address}`">{{
                  format.validatorFromBech32(v.delegation.validator_address) || v.delegation.validator_address
                }}</RouterLink>
              </td>
              <td class="py-3">
                {{ format.formatToken(v.balance, true, '0,0.[000000]') }}
              </td>
              <td class="py-3">
                {{
                  format.formatTokens(
                    rewards?.rewards?.find((x) => x.validator_address === v.delegation.validator_address)?.reward
                  )
                }}
              </td>
              <td class="py-3">
                <div v-if="v.balance" class="flex justify-end">
                  <label
                    for="delegate"
                    class="btn btn-primary btn-xs mr-2"
                    @click="
                      dialog.open(
                        'delegate',
                        {
                          validator_address: v.delegation.validator_address,
                        },
                        updateEvent
                      )
                    "
                    >{{ $t('account.btn_delegate') }}</label
                  >
                  <label
                    for="redelegate"
                    class="btn btn-primary btn-xs mr-2"
                    @click="
                      dialog.open(
                        'redelegate',
                        {
                          validator_address: v.delegation.validator_address,
                        },
                        updateEvent
                      )
                    "
                    >{{ $t('account.btn_redelegate') }}</label
                  >
                  <label
                    for="unbond"
                    class="btn btn-primary btn-xs"
                    @click="
                      dialog.open(
                        'unbond',
                        {
                          validator_address: v.delegation.validator_address,
                        },
                        updateEvent
                      )
                    "
                    >{{ $t('account.btn_unbond') }}</label
                  >
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Unbonding Delegations -->
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow" v-if="unbonding && unbonding.length > 0">
      <h2 class="card-title mb-4">{{ $t('account.unbonding_delegations') }}</h2>
      <div class="overflow-x-auto">
        <table class="table text-sm w-full">
          <thead>
            <tr>
              <th class="py-3">{{ $t('account.creation_height') }}</th>
              <th class="py-3">{{ $t('account.initial_balance') }}</th>
              <th class="py-3">{{ $t('account.balance') }}</th>
              <th class="py-3">{{ $t('account.completion_time') }}</th>
            </tr>
          </thead>
          <tbody class="text-sm" v-for="(v, index) in unbonding" :key="index">
            <tr>
              <td class="text-caption text-primary py-3 bg-slate-200" colspan="10">
                <RouterLink :to="`/${chain}/staking/${v.validator_address}`">{{ v.validator_address }}</RouterLink>
              </td>
            </tr>
            <tr v-for="entry in v.entries">
              <td class="py-3">{{ entry.creation_height }}</td>
              <td class="py-3">
                {{
                  format.formatToken(
                    {
                      amount: entry.initial_balance,
                      denom: stakingStore.params.bond_denom,
                    },
                    true,
                    '0,0.[00]'
                  )
                }}
              </td>
              <td class="py-3">
                {{
                  format.formatToken(
                    {
                      amount: entry.balance,
                      denom: stakingStore.params.bond_denom,
                    },
                    true,
                    '0,0.[00]'
                  )
                }}
              </td>
              <td class="py-3">
                <Countdown :time="new Date(entry.completion_time).getTime() - new Date().getTime()" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Transactions -->
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 class="card-title mb-0">{{ $t('account.transactions') }}</h2>
        <div class="tabs tabs-boxed bg-transparent text-xs md:text-sm">
          <button
            class="tab tab-sm"
            :class="{ 'tab-active': txSortOrder === 'latest' }"
            @click="setTxSort('latest')"
          >
            Latest
          </button>
          <button
            class="tab tab-sm"
            :class="{ 'tab-active': txSortOrder === 'oldest' }"
            @click="setTxSort('oldest')"
          >
            Oldest
          </button>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="table w-full text-sm">
          <thead>
            <tr>
              <th class="py-3">{{ $t('account.height') }}</th>
              <th class="py-3">{{ $t('account.hash') }}</th>
              <th class="py-3">{{ $t('account.messages') }}</th>
              <th class="py-3">{{ $t('account.time') }}</th>
            </tr>
          </thead>
          <tbody class="text-sm">
            <tr v-if="txLoading">
              <td colspan="10">
                <div class="flex justify-center py-6">
                  <span class="loading loading-spinner loading-sm"></span>
                </div>
              </td>
            </tr>
            <tr v-else-if="sortedTxs.length === 0">
              <td colspan="10">
                <div class="text-center">{{ $t('account.no_transactions') }}</div>
              </td>
            </tr>
            <tr v-for="(v, index) in sortedTxs" :key="v.txhash || `${v.height}-${index}`">
              <td class="text-sm py-3">
                <RouterLink
                  :to="`/${chain}/block/${v.height}`"
                  class="text-primary dark:invert"
                  >{{ v.height }}</RouterLink
                >
              </td>
              <td class="truncate py-3" style="max-width: 200px">
                <RouterLink
                  :to="`/${chain}/tx/${v.txhash}`"
                  class="text-primary dark:invert"
                >
                  {{ v.txhash }}
                </RouterLink>
              </td>
              <td class="flex items-center py-3">
                <div class="mr-2">
                  {{ format.messages(v.tx.body.messages) }}
                </div>
                <Icon v-if="v.code === 0" icon="mdi-check" class="text-success text-lg" />
                <Icon v-else icon="mdi-multiply" class="text-error text-lg" />
              </td>
              <td class="py-3">
                {{ format.toLocaleDate(v.timestamp) }}
                <span class="text-xs">({{ format.toDay(v.timestamp, 'from') }})</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Received -->
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 class="card-title mb-0">{{ $t('account.received') }}</h2>
        <div class="tabs tabs-boxed bg-transparent text-xs md:text-sm">
          <button
            class="tab tab-sm"
            :class="{ 'tab-active': receivedSortOrder === 'latest' }"
            @click="setReceivedSort('latest')"
          >
            Latest
          </button>
          <button
            class="tab tab-sm"
            :class="{ 'tab-active': receivedSortOrder === 'oldest' }"
            @click="setReceivedSort('oldest')"
          >
            Oldest
          </button>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="table w-full text-sm">
          <thead>
            <tr>
              <th class="py-3">{{ $t('account.height') }}</th>
              <th class="py-3">{{ $t('account.hash') }}</th>
              <th class="py-3">{{ $t('account.amount') }}</th>
              <th class="py-3">{{ $t('account.time') }}</th>
            </tr>
          </thead>
          <tbody class="text-sm">
            <tr v-if="receivedLoading">
              <td colspan="10">
                <div class="flex justify-center py-6">
                  <span class="loading loading-spinner loading-sm"></span>
                </div>
              </td>
            </tr>
            <tr v-else-if="sortedReceived.length === 0">
              <td colspan="10">
                <div class="text-center">{{ $t('account.no_transactions') }}</div>
              </td>
            </tr>
            <tr v-for="(v, index) in sortedReceived" :key="v.txhash || `${v.height}-${index}`">
              <td class="text-sm py-3">
                <RouterLink
                  :to="`/${chain}/block/${v.height}`"
                  class="text-primary dark:invert"
                  >{{ v.height }}</RouterLink
                >
              </td>
              <td class="truncate py-3" style="max-width: 200px">
                <RouterLink
                  :to="`/${chain}/tx/${v.txhash}`"
                  class="text-primary dark:invert"
                >
                  {{ v.txhash }}
                </RouterLink>
              </td>
              <td class="flex items-center py-3">
                <div class="mr-2">
                  {{ mapAmount(v.events)?.join(', ') }}
                </div>
                <Icon v-if="v.code === 0" icon="mdi-check" class="text-success text-lg" />
                <Icon v-else icon="mdi-multiply" class="text-error text-lg" />
              </td>
              <td class="py-3">
                {{ format.toLocaleDate(v.timestamp) }}
                <span class="text-xs">({{ format.toDay(v.timestamp, 'from') }})</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Account -->
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow">
      <h2 class="card-title mb-4">{{ $t('account.acc') }}</h2>
      <DynamicComponent :value="account" />
    </div>
  </div>
  <div v-else class="text-no text-sm">{{ $t('account.error') }}</div>
</template>
