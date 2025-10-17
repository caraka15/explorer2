<script setup lang="ts">
import { parseCoins } from '@cosmjs/stargate';
import {
  useBankStore,
  useBlockchain,
  useDistributionStore,
  useFormatter,
  useMintStore,
  useStakingStore,
  useTxDialog,
  useBaseStore,
} from '@/stores';
import { onMounted, computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import CommissionRate from '@/components/ValidatorCommissionRate.vue';
import {
  consensusPubkeyToHexAddress,
  operatorAddressToAccount,
  pubKeyToValcons,
  valconsToBase64,
} from '@/libs';
import {
  PageRequest,
} from '@/types';
import type {
  Coin,
  Delegation,
  PaginatedDelegations,
  PaginatedTxs,
  Validator,
  SlashingParam,
  SigningInfo,
  Block,
} from '@/types';
import PaginationBar from '@/components/PaginationBar.vue';
import { fromBase64, toBase64, fromHex } from '@cosmjs/encoding';
import { stringToUint8Array, uint8ArrayToString } from '@/libs/utils';
import UptimeBar from '@/components/UptimeBar.vue';

const props = defineProps(['validator', 'chain']);

const staking = useStakingStore();
const blockchain = useBlockchain();
const format = useFormatter();
const dialog = useTxDialog();
const page = new PageRequest();
const baseStore = useBaseStore();

const validator: string = props.validator;

const v = ref({} as Validator);
const cache = JSON.parse(localStorage.getItem('avatars') || '{}');
const avatars = ref(cache || {});
const identity = ref('');
const rewards = ref([] as Coin[] | undefined);
const commission = ref([] as Coin[] | undefined);
const delegations = ref({} as PaginatedDelegations);
const addresses = ref(
  {} as {
    account: string;
    operAddress: string;
    hex: string;
    valCons: string;
  }
);
const selfBonded = ref({} as Delegation);

const latest = ref(0);
const slashingParam = ref({} as SlashingParam);
const signingInfo = ref({} as Record<string, SigningInfo>);
interface BlockColor {
  height: string;
  color: string;
}
const blockColors = ref({} as Record<string, BlockColor[]>);

function padding(blocks: BlockColor[] = []) {
  const raw = Array(50)
    .fill({ height: '0', color: 'bg-secondary' } as BlockColor)
    .concat(blocks);
  return raw.slice(raw.length - 50);
}

function fillblock(b: Block, direction: string = 'end') {
  const hex = consensusPubkeyToHexAddress(v.value.consensus_pubkey);
  const base64 = toBase64(fromHex(hex));
  const sig = b.block.last_commit?.signatures.find(
    (s) => s.validator_address === base64
  );
  const block = blockColors.value[base64] || [];
  let color = {
    height: b.block.header.height,
    color: 'bg-red-500',
  };
  if (sig) {
    color = {
      height: b.block.header.height,
      color:
        sig.block_id_flag === 'BLOCK_ID_FLAG_COMMIT'
          ? 'bg-green-500'
          : 'bg-yellow-500',
    };
  }
  if (direction === 'end') {
    block.unshift(color);
    if (block.length > 50) block.pop(); // Remove the last element
  } else {
    block.unshift(color);
    if (block.length > 50) block.pop(); // Keep consistent for initial fill
  }
  blockColors.value[base64] = block;
}

function updateTotalSigningInfo() {
  blockchain.rpc.getSlashingSigningInfos().then((x) => {
    x.info?.forEach((i) => {
      signingInfo.value[valconsToBase64(i.address)] = i;
    });
  });
}

const uptime = computed(() => {
  const hex = consensusPubkeyToHexAddress(v.value.consensus_pubkey);
  const base64 = toBase64(fromHex(hex));
  const window = Number(slashingParam.value.signed_blocks_window || 0);
  const signing = signingInfo.value[base64];
  const uptime =
    signing && window > 0
      ? (window - Number(signing.missed_blocks_counter)) / window
      : undefined;
  return {
    blocks: padding(blockColors.value[base64] || []),
    uptime: uptime,
    missed_blocks_counter: signing?.missed_blocks_counter,
  };
});

addresses.value.account = operatorAddressToAccount(validator);
// load self bond
staking
  .fetchValidatorDelegation(validator, addresses.value.account)
  .then((x) => {
    if (x) {
      selfBonded.value = x.delegation_response;
    }
  });

const txs = ref({} as PaginatedTxs);

blockchain.rpc.getTxsBySender(addresses.value.account).then((x) => {
  txs.value = x;
});

const apr = computed(() => {
  const rate = Number(v.value.commission?.commission_rates.rate || 0);
  const inflation = useMintStore().inflation;
  const communityTax = Number(useDistributionStore().params.community_tax);
  const bondedRatio =
    Number(staking.pool.bonded_tokens) / Number(useBankStore().supply.amount);

  return format.percent(
    ((1 - communityTax) * (1 - rate) * Number(inflation)) / bondedRatio
  );
});

const selfRate = computed(() => {
  if (selfBonded.value.balance?.amount) {
    return format.calculatePercent(
      selfBonded.value.balance.amount,
      v.value.tokens
    );
  }
  return '-';
});

const logo = (identity?: string) => {
  if (!identity) return '';
  const url = avatars.value[identity] || '';
  return url.startsWith('http')
    ? url
    : `https://s3.amazonaws.com/keybase_processed_uploads/${url}`;
};

const fetchAvatar = (identity: string) => {
  // fetch avatar from keybase
  return new Promise<void>((resolve) => {
    staking
      .keybase(identity)
      .then((d) => {
        if (Array.isArray(d.them) && d.them.length > 0) {
          const uri = String(d.them[0]?.pictures?.primary?.url).replace(
            'https://s3.amazonaws.com/keybase_processed_uploads/',
            ''
          );

          avatars.value[identity] = uri;
          resolve();
        } else throw new Error(`failed to fetch avatar for ${identity}.`);
      })
      .catch(() => {
        resolve();
      });
  });
};

const loadAvatar = (identity: string) => {
  // fetches avatar from keybase and stores it in localStorage
  fetchAvatar(identity).then(() => {
    localStorage.setItem('avatars', JSON.stringify(avatars.value));
  });
};

onMounted(() => {
  if (validator) {
    staking.fetchValidator(validator).then((res) => {
      v.value = res.validator;
      identity.value = res.validator?.description?.identity || '';
      if (identity.value && !avatars.value[identity.value])
        loadAvatar(identity.value);

      addresses.value.hex = consensusPubkeyToHexAddress(
        v.value.consensus_pubkey
      );
      addresses.value.valCons = pubKeyToValcons(
        v.value.consensus_pubkey,
        blockchain.current?.bech32ConsensusPrefix || ''
      );
    });
    blockchain.rpc
      .getDistributionValidatorOutstandingRewards(validator)
      .then((res) => {
        rewards.value = res.rewards?.rewards?.sort(
          (a, b) => Number(b.amount) - Number(a.amount)
        );
        res.rewards?.rewards?.forEach((x) => {
          if (x.denom.startsWith('ibc/')) {
            format.fetchDenomTrace(x.denom);
          }
        });
      });
    blockchain.rpc.getDistributionValidatorCommission(validator).then((res) => {
      commission.value = res.commission?.commission?.sort(
        (a, b) => Number(b.amount) - Number(a.amount)
      );
      res.commission?.commission?.forEach((x) => {
        if (x.denom.startsWith('ibc/')) {
          format.fetchDenomTrace(x.denom);
        }
      });
    });

    // delegations disabled by default (perf)
    // pageload(1)
  }
  blockchain.rpc.getSlashingParams().then((x) => {
    slashingParam.value = x.params;
  });
  updateTotalSigningInfo();
  baseStore.recents?.forEach((b) => {
    fillblock(b, 'start');
  });

  baseStore.$subscribe((_, state) => {
    const newHeight = Number(state.latest?.block?.header?.height || 0);
    if (newHeight > latest.value) {
      latest.value = newHeight;
      fillblock(state.latest);
    }
  });
});
let showCopyToast = ref(0);
const copyWebsite = async (url: string) => {
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    showCopyToast.value = 1;
    setTimeout(() => (showCopyToast.value = 0), 1000);
  } catch {
    showCopyToast.value = 2;
    setTimeout(() => (showCopyToast.value = 0), 1000);
  }
};
const tipMsg = computed(() => {
  return showCopyToast.value === 2
    ? { class: 'error', msg: 'Copy Error!' }
    : { class: 'success', msg: 'Copy Success!' };
});

function pageload(p: number) {
  page.setPage(p);
  page.limit = 10;

  blockchain.rpc
    .getStakingValidatorsDelegations(validator, page)
    .then((res) => {
      delegations.value = res;
    });
}

const events = ref({} as PaginatedTxs);

enum EventType {
  Delegate = 'delegate',
  Unbond = 'unbond',
}

const selectedEventType = ref(EventType.Delegate);

function loadPowerEvents(p: number, type: EventType) {
  selectedEventType.value = type;
  page.setPage(p);
  page.setPageSize(5);
  blockchain.rpc
    .getTxs(
      "?order_by=2&events={type}.validator='{validator}'",
      { type: selectedEventType.value, validator },
      page
    )
    .then((res) => {
      events.value = res;
    });
}

function pagePowerEvents(page: number) {
  loadPowerEvents(page, selectedEventType.value);
}

pagePowerEvents(1);

function mapEvents(
  events: { type: string; attributes: { key: string; value: string }[] }[]
) {
  const attributes = events
    .filter((x) => x.type === selectedEventType.value)
    .filter(
      (x) =>
        x.attributes.findIndex(
          (attr) =>
            attr.value === validator ||
            attr.value === toBase64(stringToUint8Array(validator))
        ) > -1
    )
    .map((x) => {
      const output = {} as { [key: string]: string };
      if (x.attributes.findIndex((a) => a.key === `amount`) > -1) {
        x.attributes.forEach((attr) => {
          output[attr.key] = attr.value;
        });
      } else {
        x.attributes.forEach((attr) => {
          output[uint8ArrayToString(fromBase64(attr.key))] = uint8ArrayToString(
            fromBase64(attr.value)
          );
        });
      }
      return output;
    });

  const coinsAsString = attributes.map((x: any) => x.amount).join(',');
  const coins = parseCoins(coinsAsString);
  return coins.map((coin) => format.formatToken(coin)).join(', ');
}

function mapDelegators(messages: any[]) {
  if (!messages) return [];
  return Array.from(
    new Set(messages.map((x) => x.delegator_address || x.grantee))
  );
}
</script>

<template>
  <div>
    <!-- KARTU PROFIL VALIDATOR -->
    <div
      class="bg-base-100 rounded-xl shadow-sm border border-base-200/60 px-4 pt-3 pb-4"
    >
      <div class="grid md:grid-cols-2 gap-6 pt-2 pb-1">
        <!-- Kiri: Avatar + Nama + CTA -->
        <div class="flex gap-4">
          <!-- Avatar -->
          <div
            class="relative rounded-xl ring-1 ring-transparent overflow-hidden shrink-0 w-32 h-32 md:w-32 md:h-32 bg-transparent"
          >
            <img
              v-if="
                identity &&
                avatars[identity] &&
                avatars[identity] !== 'undefined'
              "
              :src="logo(identity)"
              loading="lazy"
              decoding="async"
              class="object-cover w-full h-full bg-transparent"
              @error="() => loadAvatar(identity)"
            />
            <img
              v-else
              src="/help-circle-outline.svg"
              alt="help-circle"
              class="object-cover w-full h-full bg-transparent"
            />
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <h3
                class="text-xl font-semibold text-base-content truncate"
                :title="v.description?.moniker"
              >
                {{ v.description?.moniker || '-' }}
              </h3>
              <span
                v-if="v.jailed"
                class="badge badge-error badge-sm text-white"
                title="Validator jailed"
                >Jailed</span
              >
            </div>
            <div class="text-xs opacity-70 mb-3 truncate">
              {{ v.description?.identity || '-' }}
            </div>

            <label
              for="delegate"
              class="btn btn-primary btn-sm rounded-md w-auto inline-flex self-start"
              @click="
                dialog.open('delegate', {
                  validator_address: v.operator_address,
                })
              "
            >
              {{ $t('account.btn_delegate') }}
            </label>
          </div>
        </div>

        <!-- Kanan: Metrik ringkas -->
        <div class="grid grid-cols-2 gap-3 md:gap-4">
          <div class="flex gap-3 items-center">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center border border-base-300"
            >
              <Icon icon="mdi-coin" class="text-2xl" />
            </div>
            <div class="flex flex-col min-w-0">
              <div class="font-semibold leading-tight whitespace-nowrap">
                {{
                  format.formatToken2({
                    amount: v.tokens,
                    denom: staking.params.bond_denom,
                  })
                }}
              </div>
              <div class="text-xs opacity-70">
                {{ $t('staking.total_bonded') }}
              </div>
            </div>
          </div>

          <div class="flex gap-3 items-center">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center border border-base-300"
            >
              <Icon icon="mdi-percent" class="text-2xl" />
            </div>
            <div class="flex flex-col min-w-0">
              <div class="font-semibold leading-tight whitespace-nowrap">
                {{ format.formatToken(selfBonded.balance) }} ({{ selfRate }})
              </div>
              <div class="text-xs opacity-70">
                {{ $t('staking.self_bonded') }}
              </div>
            </div>
          </div>

          <div class="flex gap-3 items-center">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center border border-base-300"
            >
              <Icon icon="mdi-account-tie" class="text-2xl" />
            </div>
            <div class="flex flex-col min-w-0">
              <div class="font-semibold leading-tight whitespace-nowrap">
                {{ v.min_self_delegation }} {{ staking.params.bond_denom }}
              </div>
              <div class="text-xs opacity-70">{{ $t('staking.min_self') }}</div>
            </div>
          </div>

          <div class="flex gap-3 items-center">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center border border-base-300"
            >
              <Icon icon="mdi-finance" class="text-2xl" />
            </div>
            <div class="flex flex-col min-w-0">
              <div class="font-semibold leading-tight whitespace-nowrap">
                {{ apr }}
              </div>
              <div class="text-xs opacity-70">
                {{ $t('staking.annual_profit') }}
              </div>
            </div>
          </div>

          <div class="flex gap-3 items-center">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center border border-base-300"
            >
              <Icon
                icon="mdi:arrow-down-bold-circle-outline"
                class="text-2xl"
              />
            </div>
            <div class="flex flex-col min-w-0">
              <div class="font-semibold leading-tight whitespace-nowrap">
                {{ v.unbonding_height }}
              </div>
              <div class="text-xs opacity-70">
                {{ $t('staking.unbonding_height') }}
              </div>
            </div>
          </div>

          <div class="flex gap-3 items-center">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center border border-base-300"
            >
              <Icon icon="mdi-clock" class="text-2xl" />
            </div>
            <div class="flex flex-col min-w-0">
              <div class="font-semibold leading-tight whitespace-nowrap">
                <template
                  v-if="
                    v.unbonding_time && !v.unbonding_time.startsWith('1970')
                  "
                >
                  {{ format.toDay(v.unbonding_time, 'from') }}
                </template>
                <template v-else>—</template>
              </div>
              <div class="text-xs opacity-70">
                {{ $t('staking.unbonding_time') }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- About + Status + Liquid Staking -->
      <div class="grid md:grid-cols-3 gap-4 mt-4">
        <div class="bg-base-100 border border-base-300 rounded-xl p-3.5">
          <p class="text-sm font-semibold mb-2 opacity-90">
            {{ $t('staking.about_us') }}
          </p>
          <div class="space-y-2">
            <div class="flex items-center flex-wrap gap-2">
              <Icon icon="mdi-web" class="text-lg opacity-80" />
              <span class="font-semibold mr-2"
                >{{ $t('staking.website') }}:</span
              >
              <a
                :href="v?.description?.website || '#'"
                :class="
                  v?.description?.website
                    ? 'link no-underline hover:underline hover:text-primary'
                    : 'opacity-60 cursor-default'
                "
                target="_blank"
                rel="noopener"
              >
                {{ v.description?.website || '-' }}
              </a>
              <Icon
                v-if="v?.description?.website"
                icon="mdi:content-copy"
                class="ml-2 cursor-pointer opacity-70 hover:opacity-100"
                @click="copyWebsite(v.description?.website || '')"
                title="Copy"
              />
            </div>

            <div class="flex items-center flex-wrap gap-2">
              <Icon icon="mdi-email-outline" class="text-lg opacity-80" />
              <span class="font-semibold mr-2"
                >{{ $t('staking.contact') }}:</span
              >
              <a
                v-if="v.description?.security_contact"
                :href="'mailto:' + v.description.security_contact"
                class="link no-underline hover:underline hover:text-primary"
              >
                {{ v.description?.security_contact }}
              </a>
              <span v-else class="opacity-60">-</span>
            </div>
          </div>
        </div>

        <div class="bg-base-100 border border-base-300 rounded-xl p-3.5">
          <p class="text-sm font-semibold mb-2 opacity-90">
            {{ $t('staking.validator_status') }}
          </p>
          <div class="space-y-2">
            <div class="flex items-center flex-wrap gap-2">
              <Icon
                icon="mdi-shield-account-outline"
                class="text-lg opacity-80"
              />
              <span class="font-semibold mr-2"
                >{{ $t('staking.status') }}:</span
              >
              <span class="badge badge-outline badge-sm">
                {{ String(v.status).replace('BOND_STATUS_', '') }}
              </span>
            </div>
            <div class="flex items-center flex-wrap gap-2">
              <Icon
                icon="mdi-shield-alert-outline"
                class="text-lg opacity-80"
              />
              <span class="font-semibold mr-2"
                >{{ $t('staking.jailed') }}:</span
              >
              <span :class="v.jailed ? 'text-error font-medium' : 'opacity-80'">
                {{ v.jailed ? 'Yes' : 'No' }}
              </span>
            </div>
          </div>
        </div>

        <div class="bg-base-100 border border-base-300 rounded-xl p-3.5">
          <p class="text-sm font-semibold mb-2 opacity-90">
            {{ $t('staking.liquid_staking') }}
          </p>
          <div class="space-y-2">
            <div class="flex items-center flex-wrap gap-2">
              <Icon icon="mdi-lock" class="text-lg opacity-80" />
              <span class="font-semibold mr-2"
                >{{ $t('staking.validator_bond_share') }}:</span
              >
              <span>
                {{
                  format.formatToken(
                    {
                      amount: v.validator_bond_shares,
                      denom: staking.params.bond_denom,
                    },
                    false
                  )
                }}
              </span>
            </div>
            <div class="flex items-center flex-wrap gap-2">
              <Icon icon="mdi-waves-arrow-right" class="text-lg opacity-80" />
              <span class="font-semibold mr-2"
                >{{ $t('staking.liquid_staking_shares') }}:</span
              >
              <span>
                {{
                  format.formatToken(
                    {
                      amount: v.liquid_shares,
                      denom: staking.params.bond_denom,
                    },
                    false
                  )
                }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="v.description?.details"
        class="text-sm px-2 pt-3 mt-3 border-t border-base-200/60"
      >
        {{ v.description?.details }}
      </div>
    </div>

    <!-- KOMISI & REWARDS + ADDRESS -->
    <div class="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
      <div>
        <CommissionRate :commission="v.commission" />
      </div>

      <div
        class="bg-base-100 rounded-xl shadow-sm border border-base-200/60 relative overflow-auto"
      >
        <div class="text-base font-semibold px-3 py-2">
          {{ $t('staking.commissions_&_rewards') }}
        </div>
        <div
          class="px-4 mt-1 flex flex-col justify-between pb-4 max-h-72"
          style="height: calc(100% - 50px)"
        >
          <div class="overflow-auto flex-1">
            <div class="text-sm mb-2">{{ $t('staking.commissions') }}</div>
            <div class="flex flex-wrap">
              <div
                v-for="(i, k) in commission"
                :key="`commission-${k}`"
                class="mr-1 mb-1 badge badge-outline badge-sm"
              >
                {{ format.formatToken2(i) }}
              </div>
            </div>

            <div class="text-sm mb-2 mt-3">
              {{ $t('staking.outstanding') }} {{ $t('account.rewards') }}
            </div>
            <div class="flex flex-wrap">
              <div
                v-for="(i, k) in rewards"
                :key="`reward-${k}`"
                class="mr-1 mb-1 badge badge-outline badge-sm"
              >
                {{ format.formatToken2(i) }}
              </div>
            </div>
          </div>

          <div class="pt-3">
            <label
              for="withdraw_commission"
              class="btn btn-primary w-full rounded-md"
              @click="
                dialog.open('withdraw_commission', {
                  validator_address: v.operator_address,
                })
              "
            >
              {{ $t('account.btn_withdraw') }}
            </label>
          </div>
        </div>
      </div>

      <div
        class="bg-base-100 rounded-xl shadow-sm border border-base-200/60 overflow-x-auto"
      >
        <div class="text-base font-semibold px-3 py-2">
          {{ $t('staking.addresses') }}
        </div>
        <div class="px-4 pb-4 space-y-3">
          <div>
            <div class="text-sm flex items-center gap-2">
              {{ $t('staking.account_addr') }}
              <Icon
                icon="mdi:content-copy"
                class="cursor-pointer opacity-70 hover:opacity-100"
                v-show="addresses.account"
                @click="copyWebsite(addresses.account || '')"
              />
            </div>
            <RouterLink
              class="text-xs link break-all"
              :to="`/${chain}/account/${addresses.account}`"
            >
              {{ addresses.account }}
            </RouterLink>
          </div>

          <div>
            <div class="text-sm flex items-center gap-2">
              {{ $t('staking.operator_addr') }}
              <Icon
                icon="mdi:content-copy"
                class="cursor-pointer opacity-70 hover:opacity-100"
                v-show="v.operator_address"
                @click="copyWebsite(v.operator_address || '')"
              />
            </div>
            <div class="text-xs break-all">{{ v.operator_address }}</div>
          </div>

          <div>
            <div class="text-sm flex items-center gap-2">
              {{ $t('staking.hex_addr') }}
              <Icon
                icon="mdi:content-copy"
                class="cursor-pointer opacity-70 hover:opacity-100"
                v-show="addresses.hex"
                @click="copyWebsite(addresses.hex || '')"
              />
            </div>
            <div class="text-xs break-all">{{ addresses.hex }}</div>
          </div>

          <div>
            <div class="text-sm flex items-center gap-2">
              {{ $t('staking.signer_addr') }}
              <Icon
                icon="mdi:content-copy"
                class="cursor-pointer opacity-70 hover:opacity-100"
                v-show="addresses.valCons"
                @click="copyWebsite(addresses.valCons || '')"
              />
            </div>
            <div class="text-xs break-all">{{ addresses.valCons }}</div>
          </div>

          <div>
            <div class="text-sm flex items-center gap-2">
              {{ $t('staking.consensus_pub_key') }}
              <Icon
                icon="mdi:content-copy"
                class="cursor-pointer opacity-70 hover:opacity-100"
                v-show="v.consensus_pubkey"
                @click="copyWebsite(JSON.stringify(v.consensus_pubkey) || '')"
              />
            </div>
            <div class="text-xs break-all">{{ v.consensus_pubkey }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- UPTIME CARD -->
    <div v-if="v.status === 'BOND_STATUS_BONDED'" class="mt-3 bg-base-100 rounded-xl shadow-sm border border-base-200/60">
        <div class="text-base font-semibold px-3 py-2">Uptime</div>
        <div class="p-4">
            <UptimeBar :blocks="uptime.blocks" />
            <div class="flex justify-between items-center mt-2 text-sm">
                <div>
                    Uptime: {{ format.percent(uptime.uptime) }}
                </div>
                <div>
                    Missed Blocks: {{ uptime.missed_blocks_counter }}
                </div>
            </div>
        </div>
    </div>

    <!-- DELEGATIONS -->
    <div
      v-if="delegations.delegation_responses"
      class="mt-5 bg-base-100 rounded-xl shadow-sm border border-base-200/60"
    >
      <div
        class="bg-base-100 px-3 py-2 text-neutral-content rounded-t-xl flex items-center justify-between"
      >
        <span>{{ $t('account.delegations') }}</span>
        <span class="text-sm opacity-80">
          {{ delegations.delegation_responses?.length || 0 }} /
          {{ delegations.pagination?.total || 0 }}
        </span>
      </div>

      <div class="rounded overflow-auto">
        <table class="table w-full">
          <!-- THEAD ABU-ABU (bukan hitam) -->
          <thead
            class="bg-base-200/70 sticky top-0 backdrop-blur supports-[backdrop-filter]:bg-base-200/60"
          >
            <tr>
              <th class="text-left pl-4 text-xs uppercase tracking-wide">
                {{ $t('account.delegator') }}
              </th>
              <th class="text-left pl-4 text-xs uppercase tracking-wide">
                {{ $t('account.delegation') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="{
                balance,
                delegation,
              } in delegations.delegation_responses"
              :key="delegation?.delegator_address"
              class="hover:bg-base-200/40"
            >
              <td class="text-sm pl-4">
                <span class="font-mono link">{{
                  delegation.delegator_address
                }}</span>
              </td>
              <td class="pl-4 truncate">{{ format.formatToken(balance) }}</td>
            </tr>
          </tbody>
        </table>
        <PaginationBar
          :total="delegations.pagination?.total"
          :limit="page.limit"
          :callback="pageload"
        />
      </div>
    </div>

    <!-- TRANSACTIONS -->
    <div
      class="mt-5 bg-base-100 rounded-xl shadow-sm border border-base-200/60"
    >
      <div class="bg-base-100 px-3 py-2 text-neutral-content rounded-t-xl">
        {{ $t('account.transactions') }}
      </div>

      <div class="rounded overflow-auto">
        <table class="table w-full">
          <thead
            class="bg-base-200/70 sticky top-0 backdrop-blur supports-[backdrop-filter]:bg-base-200/60"
          >
            <tr>
              <th class="text-left pl-4 text-xs uppercase tracking-wide">
                {{ $t('account.height') }}
              </th>
              <th class="text-left pl-4 text-xs uppercase tracking-wide">
                {{ $t('account.hash') }}
              </th>
              <th
                class="text-left pl-4 text-xs uppercase tracking-wide"
                width="40%"
              >
                {{ $t('account.messages') }}
              </th>
              <th class="text-left pl-4 text-xs uppercase tracking-wide">
                {{ $t('account.time') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(item, i) in txs.tx_responses"
              :key="item.txhash"
              class="hover:bg-base-200/40"
            >
              <td class="text-sm pl-4">
                <RouterLink
                  class="link no-underline hover:underline"
                  :to="`/${props.chain}/block/${item.height}`"
                  >{{ item.height }}</RouterLink
                >
              </td>
              <td class="pl-4 truncate max-w-[220px]">
                <RouterLink
                  class="link no-underline hover:underline"
                  :to="`/${props.chain}/tx/${item.txhash}`"
                  >{{ item.txhash }}</RouterLink
                >
              </td>
              <td class="pl-4">
                <div class="flex items-center">
                  <span class="mr-2">{{
                    format.messages(item.tx.body.messages)
                  }}</span>
                  <Icon
                    v-if="item.code === 0"
                    icon="mdi-check"
                    class="text-success"
                  />
                  <Icon v-else icon="mdi-multiply" class="text-error" />
                </div>
              </td>
              <td class="pl-4 whitespace-nowrap">
                {{ format.toDay(item.timestamp, 'from') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- POWER EVENTS -->
    <div
      class="mt-5 bg-base-100 rounded-xl shadow-sm border border-base-200/60"
    >
      <div
        class="bg-base-100 px-3 py-2 text-neutral-content rounded-t-xl flex items-center justify-between"
      >
        <span>Voting Power Events</span>
        <div class="tabs tabs-boxed bg-transparent">
          <a
            class="tab text-gray-200"
            :class="{ 'tab-active': selectedEventType === EventType.Delegate }"
            @click="loadPowerEvents(1, EventType.Delegate)"
            >{{ $t('account.btn_delegate') }}</a
          >
          <a
            class="tab text-gray-200"
            :class="{ 'tab-active': selectedEventType === EventType.Unbond }"
            @click="loadPowerEvents(1, EventType.Unbond)"
            >{{ $t('account.btn_unbond') }}</a
          >
        </div>
      </div>

      <div class="rounded overflow-auto">
        <table class="table w-full">
          <thead
            class="bg-base-200/70 sticky top-0 backdrop-blur supports-[backdrop-filter]:bg-base-200/60"
          >
            <tr>
              <th class="text-left pl-4 text-xs uppercase tracking-wide">
                {{ $t('account.delegator') }}
              </th>
              <th class="text-left pl-4 text-xs uppercase tracking-wide">
                {{ $t('account.amount') }}
              </th>
              <th class="text-left pl-4 text-xs uppercase tracking-wide">
                {{ $t('account.height') }} / {{ $t('account.time') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(item, i) in events.tx_responses"
              :key="item.txhash"
              class="hover:bg-base-200/40"
            >
              <td class="pr-2 truncate max-w-[260px] pl-4">
                <RouterLink
                  v-for="d in mapDelegators(item.tx?.body?.messages)"
                  :key="d"
                  class="link no-underline hover:underline"
                  :to="`/${props.chain}/account/${d}`"
                >
                  {{ d }}
                </RouterLink>
              </td>
              <td class="pl-4">
                <div
                  class="flex items-center"
                  :class="{
                    'text-success': selectedEventType === EventType.Delegate,
                    'text-error': selectedEventType === EventType.Unbond,
                  }"
                >
                  <RouterLink
                    class="link no-underline hover:underline"
                    :to="`/${props.chain}/tx/${item.txhash}`"
                  >
                    <span class="mr-2"
                      >{{
                        selectedEventType === EventType.Delegate ? '+' : '-'
                      }}
                      {{ mapEvents(item.events) }}</span
                    >
                  </RouterLink>
                  <Icon
                    v-if="item.code === 0"
                    icon="mdi-check"
                    class="text-success"
                  />
                  <Icon v-else icon="mdi-multiply" class="text-error" />
                </div>
              </td>
              <td class="pl-4 whitespace-nowrap">
                <RouterLink
                  class="link no-underline hover:underline"
                  :to="`/${props.chain}/block/${item.height}`"
                  >{{ item.height }}</RouterLink
                >
                <div class="text-xs opacity-70">
                  {{ format.toDay(item.timestamp, 'from') }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <PaginationBar
          :total="events.pagination?.total"
          :limit="page.limit"
          :callback="pagePowerEvents"
        />
      </div>
    </div>

    <!-- Toasts -->
    <div class="toast" v-show="showCopyToast === 1">
      <div class="alert alert-success">
        <div class="text-xs md:text-sm">
          <span>{{ tipMsg.msg }}</span>
        </div>
      </div>
    </div>
    <div class="toast" v-show="showCopyToast === 2">
      <div class="alert alert-error">
        <div class="text-xs md:text-sm">
          <span>{{ tipMsg.msg }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
