<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { formatEther } from 'ethers'
import { useWalletStore } from '@/stores/wallet'
import {
  STATUS_LABELS,
  sendReportFoundTx,
  waitForReportFoundReceipt,
  fetchListing,
  ListingContractError,
} from '@/services/listingContract'
import { fetchListingMetadata, IpfsMetadataError } from '@/services/ipfsMetadata'
import { createCancelGate, ignoreLateSettlement, CancelledError } from '@/utils/cancelGate'

const props = defineProps({
  listing: { type: Object, required: true },
})

const wallet = useWalletStore()

// Local, updatable copy of the listing so a successful "report found" can
// refresh this card's status/finder in place, without the parent having to
// re-fetch the whole list.
const currentListing = ref({ ...props.listing })
watch(
  () => props.listing,
  (value) => {
    currentListing.value = { ...value }
  },
)

const statusLabel = computed(() => STATUS_LABELS[currentListing.value.status] ?? 'Unknown')
const statusClass = computed(() => `status-${statusLabel.value.toLowerCase()}`)
const rewardEth = computed(() => formatEther(currentListing.value.reward))

const metadata = ref(null)
const metadataError = ref('')
const loadingMetadata = ref(true)

onMounted(async () => {
  try {
    metadata.value = await fetchListingMetadata(props.listing.itemCID)
  } catch (err) {
    metadataError.value =
      err instanceof IpfsMetadataError ? err.message : 'Failed to load listing details.'
  } finally {
    loadingMetadata.value = false
  }
})

// Open listings can be reported by anyone except their own owner.
const canReportFound = computed(() => {
  if (currentListing.value.status !== 0) return false
  if (!wallet.address || !wallet.contract) return false
  return wallet.address.toLowerCase() !== currentListing.value.owner.toLowerCase()
})

const reportStatus = ref('idle')
const reportError = ref('')

const isReporting = computed(() =>
  ['awaiting-signature', 'awaiting-confirmation'].includes(reportStatus.value),
)

const reportButtonLabel = computed(() => {
  switch (reportStatus.value) {
    case 'awaiting-signature':
      return 'Waiting for you to confirm in your wallet...'
    case 'awaiting-confirmation':
      return 'Waiting for confirmation on-chain...'
    default:
      return 'Report Found'
  }
})

// Lets a manual Cancel click (during awaiting-signature only) abandon the
// in-flight wallet request immediately, instead of making the user wait
// out the full wallet-response timeout. The request itself isn't actually
// abortable, so it may still be hanging in the background -- see
// ignoreLateSettlement.
let cancelGate = null

async function onReportFound() {
  reportError.value = ''
  cancelGate = createCancelGate()

  try {
    reportStatus.value = 'awaiting-signature'
    const sendPromise = sendReportFoundTx(wallet.contract, currentListing.value.id)
    ignoreLateSettlement(sendPromise)
    const tx = await Promise.race([sendPromise, cancelGate.promise])

    reportStatus.value = 'awaiting-confirmation'
    await waitForReportFoundReceipt(tx)

    currentListing.value = await fetchListing(wallet.contract, currentListing.value.id)
    reportStatus.value = 'success'
  } catch (err) {
    if (err instanceof CancelledError) {
      reportStatus.value = 'idle'
      return
    }
    reportStatus.value = 'error'
    reportError.value =
      err instanceof ListingContractError ? err.message : err?.message || 'Failed to report the item as found.'
  } finally {
    cancelGate = null
  }
}

function cancelReportFound() {
  cancelGate?.cancel()
}
</script>

<template>
  <article class="listing-card" :class="statusClass">
    <div class="listing-image">
      <img
        v-if="metadata?.image"
        :src="metadata.image"
        :alt="metadata.description || 'Listing photo'"
      />
      <div v-else class="image-placeholder">
        {{ loadingMetadata ? 'Loading…' : 'No image' }}
      </div>
    </div>

    <div class="listing-body">
      <span class="status-badge">{{ statusLabel }}</span>

      <p v-if="loadingMetadata" class="loading">Loading details…</p>
      <template v-else-if="metadataError">
        <p class="metadata-error">{{ metadataError }}</p>
        <p class="item-cid">CID: {{ currentListing.itemCID }}</p>
      </template>
      <template v-else>
        <h3 v-if="metadata.title" class="title">{{ metadata.title }}</h3>
        <p class="description"><strong>Description:</strong> {{ metadata.description }}</p>
        <p class="location"><strong>Location:</strong> {{ metadata.location }}</p>
      </template>

      <p class="reward"><strong>Reward:</strong> {{ rewardEth }} ETH</p>

      <div v-if="canReportFound" class="report-found">
        <button type="button" class="report-found-button" :disabled="isReporting" @click="onReportFound">
          {{ reportButtonLabel }}
        </button>
        <button
          v-if="reportStatus === 'awaiting-signature'"
          type="button"
          class="report-cancel-button"
          @click="cancelReportFound"
        >
          Cancel
        </button>
        <p v-if="reportError" class="report-error">{{ reportError }}</p>
      </div>

      <p v-if="reportStatus === 'success'" class="report-success">
        You reported this item as found. Waiting for the owner to confirm.
      </p>
    </div>
  </article>
</template>

<style scoped>
.listing-card {
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.listing-image {
  aspect-ratio: 4 / 3;
  background: var(--color-background-soft);
  display: flex;
  align-items: center;
  justify-content: center;
}

.listing-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-placeholder {
  color: var(--color-text);
  opacity: 0.6;
  font-size: 0.85rem;
}

.listing-body {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.status-badge {
  display: inline-block;
  align-self: flex-start;
  font-size: 0.75rem;
  font-weight: bold;
  padding: 0.15rem 0.5rem;
  border-radius: 1rem;
  background: var(--color-background-soft);
}

.status-open .status-badge {
  background: #dff3e0;
  color: #1e7a34;
}

.status-reported .status-badge {
  background: #fff2cc;
  color: #a15c00;
}

.status-resolved .status-badge {
  background: #dbe7ff;
  color: #1a4fa0;
}

.status-cancelled .status-badge,
.status-cancelled .description,
.status-cancelled .location {
  background: #eee;
  color: #888;
}

.listing-card.status-cancelled,
.listing-card.status-resolved {
  opacity: 0.7;
}

.title {
  margin: 0;
  font-size: 1rem;
}

.metadata-error {
  color: #b3261e;
  font-size: 0.85rem;
}

.item-cid {
  font-family: monospace;
  font-size: 0.75rem;
  word-break: break-all;
  opacity: 0.7;
}

.reward {
  font-weight: bold;
}

.report-found {
  margin-top: 0.25rem;
}

.report-found-button {
  width: 100%;
}

.report-cancel-button {
  width: 100%;
  margin-top: 0.35rem;
  background: transparent;
  border: 1px solid var(--color-border);
  color: inherit;
}

.report-error {
  color: #b3261e;
  font-size: 0.85rem;
  margin: 0.25rem 0 0;
}

.report-success {
  color: #1e7a34;
  font-size: 0.85rem;
}
</style>
