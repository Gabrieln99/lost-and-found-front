<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ZeroAddress } from 'ethers'
import { useWalletStore } from '@/stores/wallet'
import { fetchListing, ListingContractError } from '@/services/listingContract'
import { useListingMetadata } from '@/composables/useListingMetadata'
import { useListingActions } from '@/composables/useListingActions'
import { shortenAddress } from '@/utils/address'
import ListingMessageThread from '@/components/ListingMessageThread.vue'
import Button from '@/components/ui/Button.vue'
import Alert from '@/components/ui/Alert.vue'
import Badge from '@/components/ui/Badge.vue'

const route = useRoute()
const wallet = useWalletStore()

// A valid listing id is a non-negative decimal integer. Anything else
// ('abc', '-1', '1.5', '0x1', '') is treated as "not found".
const parsedId = computed(() => {
  const raw = route.params.id
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
})

const walletBlockReason = computed(() => {
  if (!wallet.isConnected) return 'Connect your wallet to view this listing.'
  if (!wallet.isCorrectNetwork) return 'Switch to Sepolia to view this listing.'
  if (!wallet.contract) return 'The contract address is not configured yet.'
  return ''
})

const listing = ref(null)
const loading = ref(false)
const loadError = ref('')
const notFound = ref(false)

async function load() {
  if (parsedId.value === null) {
    notFound.value = true
    return
  }
  if (walletBlockReason.value) return // the wallet-gate hint renders instead

  loading.value = true
  loadError.value = ''
  notFound.value = false
  listing.value = null
  try {
    const count = await wallet.contract.listingCount() // bigint
    if (BigInt(parsedId.value) >= count) {
      notFound.value = true
      return
    }
    const fetched = await fetchListing(wallet.contract, parsedId.value)
    // fetchListing does not throw for an unset id -- Solidity's mapping
    // getter returns a zero struct. Treat that as missing.
    if (!fetched || fetched.owner === ZeroAddress || fetched.createdAt === 0n) {
      notFound.value = true
      return
    }
    listing.value = fetched
  } catch (err) {
    loadError.value =
      err instanceof ListingContractError ? err.message : 'Failed to load this listing.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(
  () => wallet.contract,
  (contract, previous) => {
    if (contract && contract !== previous) load()
  },
)
watch(parsedId, load)

const { metadata, metadataError, loadingMetadata } = useListingMetadata(
  () => listing.value?.itemCID ?? '',
)

const {
  currentListing,
  statusLabel,
  rewardEth,
  canReportFound,
  canCancelListing,
  canConfirmRecovery,
  canRejectReport,
  canMessageThread,
  actionStatus,
  actionError,
  actionSuccessMessage,
  isActing,
  reportFoundLabel,
  cancelListingLabel,
  confirmRecoveryLabel,
  rejectReportLabel,
  onReportFound,
  onCancelListing,
  onConfirmRecovery,
  onRejectReport,
  cancelAction,
} = useListingActions(() => listing.value)

const statusTone = computed(
  () => ['success', 'warning', 'info', 'neutral'][currentListing.value.status] ?? 'neutral',
)

const hasFinder = computed(
  () => currentListing.value.finder && currentListing.value.finder !== ZeroAddress,
)
</script>

<template>
  <div class="flex flex-col gap-5">
    <RouterLink to="/browse" class="text-sm">&larr; Back to listings</RouterLink>

    <p v-if="notFound" class="not-found text-sm text-muted">
      Listing #{{ route.params.id }} doesn't exist.
    </p>

    <Alert v-else-if="walletBlockReason" tone="warning">{{ walletBlockReason }}</Alert>

    <p v-else-if="loading" class="text-sm text-muted">Loading listing…</p>

    <Alert v-else-if="loadError" tone="danger" class="load-error">{{ loadError }}</Alert>

    <article v-else-if="listing" class="listing-detail flex flex-col gap-4">
      <div
        class="grid aspect-[4/3] max-w-xl place-items-center overflow-hidden rounded-lg bg-surface-soft"
      >
        <img
          v-if="metadata?.image"
          :src="metadata.image"
          :alt="metadata.description || 'Listing photo'"
          class="h-full w-full object-cover"
        />
        <div v-else class="text-sm text-muted">
          {{ loadingMetadata ? 'Loading…' : 'No image' }}
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <Badge :tone="statusTone">{{ statusLabel }}</Badge>
      </div>

      <h1 class="title text-2xl font-bold tracking-tight">
        {{ metadata?.title || 'Untitled listing' }}
      </h1>

      <p v-if="metadataError" class="text-sm text-danger">{{ metadataError }}</p>
      <template v-else>
        <p class="description text-sm">
          <strong class="font-medium text-muted">Description:</strong> {{ metadata?.description }}
        </p>
        <p class="location text-sm">
          <strong class="font-medium text-muted">Location:</strong> {{ metadata?.location }}
        </p>
      </template>

      <p class="reward text-sm">
        <strong class="font-medium text-muted">Reward:</strong> {{ rewardEth }} ETH
      </p>
      <p class="owner font-mono text-xs break-all text-muted">
        <strong class="font-medium">Owner:</strong> {{ shortenAddress(currentListing.owner) }}
      </p>
      <p v-if="hasFinder" class="finder font-mono text-xs break-all text-muted">
        <strong class="font-medium">Finder:</strong> {{ shortenAddress(currentListing.finder) }}
      </p>

      <div class="detail-actions flex flex-wrap gap-2">
        <Button
          v-if="canReportFound"
          class="report-found-button"
          variant="secondary"
          :disabled="isActing"
          @click="onReportFound"
        >
          {{ reportFoundLabel }}
        </Button>
        <Button
          v-if="canCancelListing"
          class="cancel-listing-button"
          variant="secondary"
          :disabled="isActing"
          @click="onCancelListing"
        >
          {{ cancelListingLabel }}
        </Button>
        <Button
          v-if="canConfirmRecovery"
          class="confirm-recovery-button"
          variant="success"
          :disabled="isActing"
          @click="onConfirmRecovery"
        >
          {{ confirmRecoveryLabel }}
        </Button>
        <Button
          v-if="canRejectReport"
          class="reject-report-button"
          variant="warning"
          :disabled="isActing"
          @click="onRejectReport"
        >
          {{ rejectReportLabel }}
        </Button>
        <Button
          v-if="actionStatus === 'awaiting-signature'"
          class="action-cancel-button"
          variant="secondary"
          size="sm"
          @click="cancelAction"
        >
          Cancel
        </Button>
      </div>

      <Alert v-if="actionError" tone="danger" class="action-error">{{ actionError }}</Alert>
      <Alert v-if="actionStatus === 'success'" tone="success" class="action-success">
        {{ actionSuccessMessage }}
      </Alert>

      <ListingMessageThread v-if="canMessageThread" :listing="currentListing" />
    </article>
  </div>
</template>
