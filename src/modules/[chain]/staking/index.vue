<script lang="ts" setup>
import {
  useBaseStore,
  useBlockchain,
  useFormatter,
  useMintStore,
  useStakingStore,
  useTxDialog,
} from '@/stores';
import { computed } from '@vue/reactivity';
import { onMounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import type { Key, SlashingParam, Validator } from '@/types';
import { formatSeconds } from '@/libs/utils';

const staking = useStakingStore();
const base = useBaseStore();
const format = useFormatter();
const dialog = useTxDialog();
const chainStore = useBlockchain();
const mintStore = useMintStore();

const cache = JSON.parse(localStorage.getItem('avatars') || '{}');
const avatars = ref(cache || {});
const latest = ref({} as Record<string, number>);
const yesterday = ref({} as Record<string, number>);
const tab = ref<'active' | 'inactive'>('active');
const unbondList = ref([] as Validator[]);
const slashing = ref({} as SlashingParam);

// ======== Featured config (edit sesukamu) ========
const FEATURED_MONIKERS = [
  'crxanode', // moniker validator kamu
  // 'Fluxen', 'Indonode', dst...
];

const FEATURED_ADDRESSES = [
  'paxivaloper1d4d4z8n6km92p4f7afy4u4rqgyumv45u468tln', // operator address validator kamu
  // tambahkan address lain jika perlu
];
// ================================================

onMounted(() => {
  staking.fetchUnbondingValdiators().then((res) => {
    unbondList.value = res.concat(unbondList.value);
  });
  staking.fetchInacitveValdiators().then((res) => {
    unbondList.value = unbondList.value.concat(res);
  });
  chainStore.rpc.getSlashingParams().then((res) => {
    slashing.value = res.params;
  });

  // Optional debug
  setTimeout(() => {
    console.log('=== DAFTAR SEMUA VALIDATOR ===');
    staking.validators.forEach((validator, index) => {
      console.log(`${index + 1}. Moniker: "${validator.description?.moniker}"`);
      console.log(`   Website: "${validator.description?.website || 'N/A'}"`);
      console.log(`   Address: "${validator.operator_address}"`);
      console.log(`   Jailed: ${validator.jailed}`);
      console.log('   ---');
    });
  }, 1500);
});

async function fetchChange(blockWindow: number = 14400) {
  let page = 0;

  let height = Number(base.latest?.block?.header?.height || 0);
  if (height > blockWindow) {
    height -= blockWindow;
  } else {
    height = 1;
  }

  // voting power 24h lalu
  while (page < staking.validators.length && height > 0) {
    // @ts-ignore
    await base.fetchValidatorByHeight(height, page).then((x) => {
      x.validators.forEach((v: any) => {
        yesterday.value[v.pub_key.key] = Number(v.voting_power);
      });
    });
    page += 100;
  }

  page = 0;
  // voting power saat ini
  while (page < staking.validators.length) {
    // @ts-ignore
    await base.fetchLatestValidators(page).then((x) => {
      x.validators.forEach((v: any) => {
        latest.value[v.pub_key.key] = Number(v.voting_power);
      });
    });
    page += 100;
  }
}

const changes = computed(() => {
  const out = {} as Record<string, number>;
  Object.keys(latest.value).forEach((k) => {
    const l = latest.value[k] || 0;
    const y = yesterday.value[k] || 0;
    out[k] = l - y;
  });
  return out;
});

const change24 = (entry: { consensus_pubkey: Key; tokens: string }) => {
  const txt = entry.consensus_pubkey.key;
  const latestValue = latest.value[txt];
  if (!latestValue) return 0;

  const displayTokens = format.tokenAmountNumber({
    amount: parseInt(entry.tokens, 10).toString(),
    denom: staking.params.bond_denom,
  });
  const coefficient = displayTokens / latestValue;
  return changes.value[txt] * coefficient;
};

const change24Text = (entry: { consensus_pubkey: Key; tokens: string }) => {
  if (!entry) return '';
  const v = change24(entry);
  return v && v !== 0 ? format.showChanges(v) : '';
};

const change24Color = (entry: { consensus_pubkey: Key; tokens: string }) => {
  if (!entry) return '';
  const v = change24(entry);
  if (v > 0) return 'text-success';
  if (v < 0) return 'text-error';
  return '';
};

const calculateRank = function (position: number) {
  let sum = 0;
  for (let i = 0; i < position; i++) {
    sum += Number(staking.validators[i]?.delegator_shares);
  }
  const percent = sum / staking.totalPower;

  switch (true) {
    case tab.value === 'active' && percent < 0.33:
      return 'error';
    case tab.value === 'active' && percent < 0.67:
      return 'warning';
    default:
      return 'primary';
  }
};

// Cek featured berdasarkan endpoint (provider), moniker & website
function isFeatured(
  endpoints: string[],
  who?: { website?: string; moniker: string }
) {
  if (!endpoints || !who) return false;

  return endpoints.some((endpoint) => {
    const endpointLower = endpoint.toLowerCase().trim();
    const monikerLower = (who.moniker || '').toLowerCase().trim();
    const website = (who.website || '').toLowerCase().trim();

    const checks = {
      exactMatch: monikerLower === endpointLower,
      monikerContains: monikerLower.includes(endpointLower),
      endpointContains: endpointLower.includes(monikerLower),
      websiteContains: website.includes(endpointLower),
      websiteDomainMatch: website.includes(endpointLower + '.'),
    };

    return Object.values(checks).some(Boolean);
  });
}

// ============ FEATURED LIST (selalu ada di atas) ============
const featuredList = computed(() => {
  const endpointProviders = (chainStore.current?.endpoints?.rest || [])
    .map((x: any) => x.provider)
    .filter(Boolean) as string[];

  // satukan sumber "kata kunci"
  const monikerKeywords = Array.from(
    new Set([...endpointProviders, ...FEATURED_MONIKERS])
  ).filter(Boolean) as string[];

  // Filter by moniker/website
  const byMonikerOrWebsite = staking.validators.filter((v) =>
    isFeatured(monikerKeywords, v.description)
  );

  // Filter by operator address (whitelist hard)
  const byAddress = staking.validators.filter((v) =>
    FEATURED_ADDRESSES.includes(v.operator_address)
  );

  // Gabungkan & dedup by operator address
  const merged = [...byMonikerOrWebsite, ...byAddress].filter(
    (v, i, arr) =>
      arr.findIndex((t) => t.operator_address === v.operator_address) === i
  );

  // Map ke bentuk tampil
  return merged.map((x) => ({
    v: x,
    rank: 'primary',
    logo: logo(x.description.identity),
  }));
});
// ============================================================

const list = computed(() => {
  if (tab.value === 'active') {
    return staking.validators.map((x, i) => ({
      v: x,
      rank: calculateRank(i),
      logo: logo(x.description.identity),
    }));
  }
  // inactive
  return unbondList.value.map((x) => ({
    v: x,
    rank: 'primary',
    logo: logo(x.description.identity),
  }));
});

const fetchAvatar = (identity: string) => {
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
        } else throw new Error(`failed to fetch avatar for ${identity}`);
      })
      .catch(() => resolve());
  });
};

const loadAvatar = (identity: string) => {
  fetchAvatar(identity).then(() => {
    localStorage.setItem('avatars', JSON.stringify(avatars.value));
  });
};

const loadAvatars = () => {
  const promises = staking.validators.map((validator) => {
    const identity = validator.description?.identity;
    if (identity && !avatars.value[identity]) {
      return fetchAvatar(identity);
    } else {
      return Promise.resolve();
    }
  });

  Promise.all(promises).then(() =>
    localStorage.setItem('avatars', JSON.stringify(avatars.value))
  );
};

const logo = (identity?: string) => {
  if (!identity || !avatars.value[identity]) return '';
  const url = avatars.value[identity] || '';
  return url.startsWith('http')
    ? url
    : `https://s3.amazonaws.com/keybase_processed_uploads/${url}`;
};

// Tambahkan di atas/sekitar helper lain
const FALLBACK_SVG = '/help-circle-outline.svg';

// Fallback aman saat <img> error (ts-friendly)
const onAvatarError = (val?: Validator, e?: Event) => {
  const el = e?.target as HTMLImageElement | undefined;
  if (el && el.src !== location.origin + FALLBACK_SVG) {
    el.src = FALLBACK_SVG;
  }
  const id = val?.description?.identity;
  if (id) {
    avatars.value[id] = ''; // kosongkan agar selalu pakai fallback next time
    localStorage.setItem('avatars', JSON.stringify(avatars.value));
  }
};

const loaded = ref(false);
base.$subscribe((_, s) => {
  if (s.recents.length >= 2 && loaded.value === false) {
    loaded.value = true;
    const diff_time =
      Date.parse(s.recents[1].block.header.time) -
      Date.parse(s.recents[0].block.header.time);
    const diff_height =
      Number(s.recents[1].block.header.height) -
      Number(s.recents[0].block.header.height);
    const block_window = Number(
      Number((86400 * 1000 * diff_height) / diff_time).toFixed(0)
    );
    fetchChange(block_window);
  }
});

loadAvatars();
</script>

<template>
  <div>
    <!-- KPIs -->
    <div
      class="bg-base-100 rounded-xl grid sm:grid-cols-1 md:grid-cols-4 gap-3 p-4 shadow-sm"
    >
      <div class="flex items-center gap-3">
        <div
          class="relative w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center"
        >
          <Icon class="text-success" icon="mdi:trending-up" size="28" />
          <div class="absolute inset-0 opacity-10 bg-success"></div>
        </div>
        <div>
          <div class="font-semibold leading-tight">
            {{ format.percent(mintStore.inflation) }}
          </div>
          <div class="text-xs opacity-70">{{ $t('staking.inflation') }}</div>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <div
          class="relative w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center"
        >
          <Icon class="text-primary" icon="mdi:lock-open-outline" size="28" />
          <div class="absolute inset-0 opacity-10 bg-primary"></div>
        </div>
        <div>
          <div class="font-semibold leading-tight">
            {{ formatSeconds(staking.params?.unbonding_time) }}
          </div>
          <div class="text-xs opacity-70">
            {{ $t('staking.unbonding_time') }}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <div
          class="relative w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center"
        >
          <Icon class="text-error" icon="mdi:alert-octagon-outline" size="28" />
          <div class="absolute inset-0 opacity-10 bg-error"></div>
        </div>
        <div>
          <div class="font-semibold leading-tight">
            {{ format.percent(slashing.slash_fraction_double_sign) }}
          </div>
          <div class="text-xs opacity-70">
            {{ $t('staking.double_sign_slashing') }}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <div
          class="relative w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center"
        >
          <Icon class="text-error" icon="mdi:pause" size="28" />
          <div class="absolute inset-0 opacity-10 bg-error"></div>
        </div>
        <div>
          <div class="font-semibold leading-tight">
            {{ format.percent(slashing.slash_fraction_downtime) }}
          </div>
          <div class="text-xs opacity-70">
            {{ $t('staking.downtime_slashing') }}
          </div>
        </div>
      </div>
    </div>

    <!-- Featured (selalu di atas) -->
    <div
      v-if="featuredList.length"
      class="mt-5 bg-base-100 rounded-xl shadow-sm border border-base-200/60"
    >
      <div class="flex items-center justify-between px-4 py-3">
        <div class="flex items-center gap-2">
          <h3 class="text-base font-semibold">Featured Validators</h3>
          <span class="badge badge-primary badge-sm">Featured</span>
        </div>
        <div class="text-xs opacity-70">Showing {{ featuredList.length }}</div>
      </div>

      <div class="overflow-x-auto">
        <table class="table w-full">
          <thead
            class="bg-base-200/70 sticky top-0 backdrop-blur supports-[backdrop-filter]:bg-base-200/60"
          >
            <tr>
              <th class="uppercase text-xs tracking-wide w-14">
                {{ $t('staking.rank') }}
              </th>
              <th class="uppercase text-xs tracking-wide">
                {{ $t('staking.validator') }}
              </th>
              <th class="uppercase text-xs tracking-wide text-right">
                {{ $t('staking.voting_power') }}
              </th>
              <th class="uppercase text-xs tracking-wide text-right">
                {{ $t('staking.24h_changes') }}
              </th>
              <th class="uppercase text-xs tracking-wide text-right">
                {{ $t('staking.commission') }}
              </th>
              <th class="uppercase text-xs tracking-wide text-center">
                {{ $t('staking.actions') }}
              </th>
            </tr>
          </thead>
          <tbody class="[&>tr:nth-child(even)]:bg-base-200/30">
            <tr
              v-for="({ v, logo }, i) in featuredList"
              :key="`featured-${v.operator_address}`"
              class="hover:bg-base-200/60"
            >
              <td>
                <div
                  class="text-[11px] relative px-2 py-1 rounded-full w-fit text-primary/90 bg-primary/10"
                >
                  {{ i + 1 }}
                </div>
              </td>

              <td>
                <div class="flex items-center gap-3 max-w-[360px]">
                  <div class="avatar">
                    <div
                      class="w-9 h-9 rounded-full ring-1 ring-base-300 overflow-hidden"
                    >
                      <img
                        v-if="logo"
                        :src="logo"
                        class="object-cover w-full h-full"
                        @error="
                          () => {
                            const id = v.description?.identity;
                            if (id) loadAvatar(id);
                          }
                        "
                      />
                      <img
                        v-else
                        src="/human.png"
                        alt="help-circle"
                        class="object-cover w-full h-full opacity-60"
                      />
                    </div>
                  </div>

                  <div class="min-w-0">
                    <!-- Moniker elegan + hover -->
                    <RouterLink
                      :to="{
                        name: 'chain-staking-validator',
                        params: { validator: v.operator_address },
                      }"
                      class="font-medium text-sm text-base-content hover:text-primary transition-colors truncate"
                      :title="v.description?.moniker"
                    >
                      {{ v.description?.moniker }}
                    </RouterLink>
                    <div class="text-xs opacity-70 truncate">
                      {{
                        v.description?.website || v.description?.identity || '-'
                      }}
                    </div>
                  </div>
                </div>
              </td>

              <td class="text-right">
                <div class="flex flex-col items-end">
                  <div class="text-sm font-medium tabular-nums">
                    {{
                      format.formatToken(
                        {
                          amount: parseInt(v.tokens).toString(),
                          denom: staking.params.bond_denom,
                        },
                        true,
                        '0,0'
                      )
                    }}
                  </div>
                  <div class="text-[11px] opacity-70 tabular-nums">
                    {{
                      format.calculatePercent(
                        v.delegator_shares,
                        staking.totalPower
                      )
                    }}
                  </div>
                </div>
              </td>

              <td
                class="text-right text-xs tabular-nums"
                :class="change24Color(v)"
              >
                {{ change24Text(v) || '—' }}
              </td>

              <td class="text-right">
                <span class="badge badge-outline badge-sm">
                  {{
                    format.formatCommissionRate(
                      v.commission?.commission_rates?.rate
                    )
                  }}
                </span>
              </td>

              <td class="text-center">
                <div
                  v-if="v.jailed"
                  class="badge badge-error gap-1 text-white badge-sm"
                >
                  {{ $t('staking.jailed') }}
                </div>
                <label
                  v-else
                  for="delegate"
                  class="btn btn-xs btn-primary rounded-md capitalize"
                  @click="
                    dialog.open('delegate', {
                      validator_address: v.operator_address,
                    })
                  "
                >
                  {{ $t('account.btn_delegate') }}
                </label>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Header list utama -->
    <div class="flex items-center justify-between py-4">
      <div class="tabs tabs-boxed bg-transparent">
        <a
          class="tab text-gray-500"
          :class="{ 'tab-active': tab === 'active' }"
          @click="tab = 'active'"
        >
          {{ $t('staking.active') }}
        </a>
        <a
          class="tab text-gray-500"
          :class="{ 'tab-active': tab === 'inactive' }"
          @click="tab = 'inactive'"
        >
          {{ $t('staking.inactive') }}
        </a>
      </div>
      <div class="text-sm opacity-70">
        {{ list.length }}/{{ staking.params.max_validators }}
      </div>
    </div>

    <!-- List utama -->
    <div class="bg-base-100 rounded-xl shadow-sm border border-base-200/60">
      <div class="overflow-x-auto rounded-xl">
        <table class="table staking-table w-full">
          <thead
            class="bg-base-200/70 sticky top-0 backdrop-blur supports-[backdrop-filter]:bg-base-200/60"
          >
            <tr>
              <th class="uppercase text-xs tracking-wide w-14">
                {{ $t('staking.rank') }}
              </th>
              <th class="uppercase text-xs tracking-wide">
                {{ $t('staking.validator') }}
              </th>
              <th class="uppercase text-xs tracking-wide text-right">
                {{ $t('staking.voting_power') }}
              </th>
              <th class="uppercase text-xs tracking-wide text-right">
                {{ $t('staking.24h_changes') }}
              </th>
              <th class="uppercase text-xs tracking-wide text-right">
                {{ $t('staking.commission') }}
              </th>
              <th class="uppercase text-xs tracking-wide text-center">
                {{ $t('staking.actions') }}
              </th>
            </tr>
          </thead>
          <tbody class="[&>tr:nth-child(even)]:bg-base-200/30">
            <tr
              v-for="({ v, rank, logo }, i) in list"
              :key="v.operator_address"
              class="hover:bg-base-200/60 transition-colors"
            >
              <td>
                <div
                  class="text-[11px] relative px-2 py-1 rounded-full w-fit"
                  :class="{
                    'text-error/90 bg-error/10': rank === 'error',
                    'text-warning/90 bg-warning/10': rank === 'warning',
                    'text-primary/90 bg-primary/10': rank === 'primary',
                  }"
                >
                  {{ i + 1 }}
                </div>
              </td>

              <td>
                <div class="flex items-center gap-3 max-w-[360px]">
                  <div class="avatar">
                    <div
                      class="w-9 h-9 rounded-full ring-1 ring-base-300 overflow-hidden"
                    >
                      <img
                        v-if="logo"
                        :src="logo"
                        class="object-cover w-full h-full"
                        @error="
                          () => {
                            const id = v.description?.identity;
                            if (id) loadAvatar(id);
                          }
                        "
                      />
                      <img
                        v-else 
                        src="/human.png"
                        alt="help-circle"
                        class="object-cover w-full h-full opacity-60"
                      />
                    </div>
                  </div>

                  <div class="min-w-0">
                    <!-- Moniker elegan + hover -->
                    <RouterLink
                      :to="{
                        name: 'chain-staking-validator',
                        params: { validator: v.operator_address },
                      }"
                      class="font-medium text-sm text-base-content hover:text-primary transition-colors truncate"
                      :title="v.description?.moniker"
                    >
                      {{ v.description?.moniker }}
                    </RouterLink>
                    <div class="text-xs opacity-70 truncate">
                      {{
                        v.description?.website || v.description?.identity || '-'
                      }}
                    </div>
                  </div>
                </div>
              </td>

              <td class="text-right">
                <div class="flex flex-col items-end">
                  <div class="text-sm font-medium tabular-nums">
                    {{
                      format.formatToken(
                        {
                          amount: parseInt(v.tokens).toString(),
                          denom: staking.params.bond_denom,
                        },
                        true,
                        '0,0'
                      )
                    }}
                  </div>
                  <div class="text-[11px] opacity-70 tabular-nums">
                    {{
                      format.calculatePercent(
                        v.delegator_shares,
                        staking.totalPower
                      )
                    }}
                  </div>
                </div>
              </td>

              <td
                class="text-right text-xs tabular-nums"
                :class="change24Color(v)"
              >
                {{ change24Text(v) || '—' }}
              </td>

              <td class="text-right">
                <span class="badge badge-outline badge-sm">
                  {{
                    format.formatCommissionRate(
                      v.commission?.commission_rates?.rate
                    )
                  }}
                </span>
              </td>

              <td class="text-center">
                <div
                  v-if="v.jailed"
                  class="badge badge-error gap-1 text-white badge-sm"
                >
                  {{ $t('staking.jailed') }}
                </div>
                <label
                  v-else
                  for="delegate"
                  class="btn btn-xs btn-primary rounded-md capitalize"
                  @click="
                    dialog.open('delegate', {
                      validator_address: v.operator_address,
                    })
                  "
                >
                  {{ $t('account.btn_delegate') }}
                </label>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="px-4 py-3 flex items-center gap-3">
        <div
          class="text-[11px] relative py-1 px-3 rounded-md w-fit text-error/90 bg-error/10"
        >
          {{ $t('staking.top') }} 33%
        </div>
        <div
          class="text-[11px] relative py-1 px-3 rounded-md w-fit text-warning/90 bg-warning/10"
        >
          {{ $t('staking.top') }} 67%
        </div>
        <div class="text-xs opacity-70 hidden md:block">
          {{ $t('staking.description') }}
        </div>
      </div>
    </div>
  </div>
</template>

<route>
  {
    meta: {
      i18n: 'staking',
      order: 3
    }
  }
</route>

<style>
/* rapikan padding tanpa mengubah komponen lain */
.staking-table.table :where(th, td) {
  padding: 10px 8px;
  background: transparent;
}

.tabular-nums {
  font-variant-numeric: tabular-nums;
}
</style>
