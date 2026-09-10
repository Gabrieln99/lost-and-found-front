<script setup>
import { ref, computed, onMounted, watch, toRaw } from 'vue'
import { formatEther } from 'ethers'
import { useWalletStore } from '@/stores/wallet'
import { fetchAllListings, STATUS_LABELS, ListingContractError } from '@/services/listingContract'
import ListingCard from '@/components/ListingCard.vue'
import Button from '@/components/ui/Button.vue'
import Alert from '@/components/ui/Alert.vue'

const wallet = useWalletStore()

const walletBlockReason = computed(() => {
  if (!wallet.isConnected) return 'Connect your wallet to view your profile.'
  if (!wallet.isCorrectNetwork) return 'Switch to Sepolia to view your profile.'
  if (!wallet.contract) return 'The contract address is not configured yet.'
  return ''
})

// --- copy address ---
const copied = ref(false)
let copiedTimer = null

async function copyAddress() {
  try {
    await navigator.clipboard.writeText(wallet.address)
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // Clipboard API unavailable or blocked -- the address is shown in full
    // anyway, so just skip the convenience copy.
  }
}

// --- Sepolia balance ---
const balance = ref(null)
const balanceLoading = ref(false)
const balanceError = ref('')

async function loadBalance() {
  if (!wallet.contract || !wallet.address) return
  balanceLoading.value = true
  balanceError.value = ''
  try {
    // toRaw() for the same reason as ListingCard's messaging code: reading
    // through the Pinia-reactive proxy of the ethers provider trips its
    // private-field brand checks.
    const provider = toRaw(wallet.contract).runner.provider
    balance.value = formatEther(await provider.getBalance(wallet.address))
  } catch {
    balanceError.value = 'Could not load your balance.'
  } finally {
    balanceLoading.value = false
  }
}

// --- listings owned / found by this wallet ---
const listings = ref([])
const loading = ref(false)
const loadError = ref('')

async function loadListings() {
  if (!wallet.contract) return
  loading.value = true
  loadError.value = ''
  try {
    const all = await fetchAllListings(wallet.contract)
    listings.value = all.slice().reverse() // newest first
  } catch (err) {
    loadError.value = err instanceof ListingContractError ? err.message : 'Failed to load listings.'
  } finally {
    loading.value = false
  }
}

const myAddress = computed(() => (wallet.address ?? '').toLowerCase())

const myListings = computed(() =>
  listings.value.filter((l) => l.owner.toLowerCase() === myAddress.value),
)

const myFoundReports = computed(() =>
  listings.value.filter((l) => l.finder.toLowerCase() === myAddress.value),
)

// ["1 Open", "2 Reported", ...] for whichever statuses are present.
function statusBreakdown(items) {
  const counts = items.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1
    return acc
  }, {})
  return STATUS_LABELS.map((label, i) => (counts[i] ? `${counts[i]} ${label}` : null)).filter(Boolean)
}

const myListingsBreakdown = computed(() => statusBreakdown(myListings.value))
const myFoundReportsBreakdown = computed(() => statusBreakdown(myFoundReports.value))

const etherscanUrl = computed(() => `https://sepolia.etherscan.io/address/${wallet.address}`)

function loadAll() {
  loadBalance()
  loadListings()
}

onMounted(loadAll)

watch(
  () => wallet.contract,
  (newContract, oldContract) => {
    if (newContract && newContract !== oldContract) loadAll()
  },
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-2xl font-bold tracking-tight">My Profile</h1>

    <Alert v-if="walletBlockReason" tone="warning">{{ walletBlockReason }}</Alert>

    <template v-else>
      <div class="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div class="flex flex-wrap items-center gap-3">
          <span class="font-mono text-sm break-all">{{ wallet.address }}</span>
          <Button variant="secondary" size="sm" @click="copyAddress">
            {{ copied ? 'Copied' : 'Copy' }}
          </Button>
        </div>

        <p class="text-sm">
          <span class="font-medium text-muted">Sepolia balance:</span>
          <span v-if="balanceLoading" class="text-muted"> loading…</span>
          <span v-else-if="balanceError" class="text-danger"> {{ balanceError }}</span>
          <span v-else-if="balance !== null" class="font-mono"> {{ balance }} ETH</span>
        </p>

        <a
          class="text-sm"
          :href="etherscanUrl"
          target="_blank"
          rel="noopener"
        >
          View full transaction history on Etherscan ↗
        </a>
      </div>

      <p v-if="loading" class="text-sm text-muted">Loading your listings…</p>
      <Alert v-else-if="loadError" tone="danger">{{ loadError }}</Alert>

      <template v-else>
        <section class="my-listings flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <h2 class="text-lg font-semibold">My Listings ({{ myListings.length }})</h2>
            <p v-if="myListingsBreakdown.length" class="text-sm text-muted">
              {{ myListingsBreakdown.join(' · ') }}
            </p>
          </div>
          <p v-if="myListings.length === 0" class="text-sm text-muted">
            You haven't published any listings yet.
          </p>
          <div
            v-else
            class="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]"
          >
            <ListingCard v-for="listing in myListings" :key="listing.id" :listing="listing" />
          </div>
        </section>

        <section class="my-found-reports flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <h2 class="text-lg font-semibold">My Found Reports ({{ myFoundReports.length }})</h2>
            <p v-if="myFoundReportsBreakdown.length" class="text-sm text-muted">
              {{ myFoundReportsBreakdown.join(' · ') }}
            </p>
          </div>
          <p v-if="myFoundReports.length === 0" class="text-sm text-muted">
            You haven't reported finding anything yet.
          </p>
          <div
            v-else
            class="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]"
          >
            <ListingCard v-for="listing in myFoundReports" :key="listing.id" :listing="listing" />
          </div>
        </section>
      </template>
    </template>
  </div>
</template>
