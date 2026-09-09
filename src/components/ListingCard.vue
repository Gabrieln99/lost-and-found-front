<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { formatEther } from 'ethers'
import { useWalletStore } from '@/stores/wallet'
import {
  STATUS_LABELS,
  sendReportFoundTx,
  sendConfirmRecoveryTx,
  sendCancelListingTx,
  sendRejectReportTx,
  waitForActionReceipt,
  fetchListing,
  ListingContractError,
} from '@/services/listingContract'
import { fetchListingMetadata, IpfsMetadataError } from '@/services/ipfsMetadata'
import { createCancelGate, ignoreLateSettlement, CancelledError } from '@/utils/cancelGate'

const SIGNING_LABEL = 'Waiting for you to confirm in your wallet...'

// One entry per listing action available on this card. Centralizing the
// per-action copy (and which service function to call) here lets a single
// generic runAction() drive all four buttons through the identical
// awaiting-signature -> awaiting-confirmation -> success/error flow.
const ACTION_CONFIG = {
  reportFound: {
    idleLabel: 'Report Found',
    confirmingLabel: 'Waiting for confirmation on-chain...',
    successMessage: 'You reported this item as found. Waiting for the owner to confirm.',
    send: sendReportFoundTx,
  },
  confirmRecovery: {
    idleLabel: 'Confirm Recovery',
    // This releases escrowed ETH to the finder -- the copy should make
    // that unmistakable, not just read as a generic confirmation.
    confirmingLabel: 'Releasing the reward to the finder -- waiting for confirmation on-chain...',
    successMessage: 'Recovery confirmed -- the reward has been released to the finder.',
    send: sendConfirmRecoveryTx,
  },
  cancelListing: {
    idleLabel: 'Cancel Listing',
    confirmingLabel: 'Waiting for confirmation on-chain...',
    successMessage: 'Listing cancelled -- your reward has been refunded.',
    send: sendCancelListingTx,
  },
  rejectReport: {
    idleLabel: 'Reject Report',
    confirmingLabel: 'Waiting for confirmation on-chain...',
    successMessage: 'Report rejected -- the listing is open again.',
    send: sendRejectReportTx,
  },
}

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

const isOwner = computed(() => {
  if (!wallet.address) return false
  return wallet.address.toLowerCase() === currentListing.value.owner.toLowerCase()
})

// Open listings can be reported by anyone except their own owner.
const canReportFound = computed(() => {
  if (currentListing.value.status !== 0) return false
  if (!wallet.contract) return false
  return !isOwner.value
})

// Owner-only: reclaim the reward on an unclaimed (Open) listing before
// anyone reports it found.
const canCancelListing = computed(() => {
  if (currentListing.value.status !== 0) return false
  if (!wallet.contract) return false
  return isOwner.value
})

// Owner-only, on a Reported listing: these two are opposite actions --
// confirm the recovery (releases the reward) or reject a false/malicious
// report (returns the listing to Open). Both stay visible together so the
// owner can choose; they're kept visually distinct in the template/styles
// below so they aren't confused with each other.
const canConfirmRecovery = computed(() => {
  if (currentListing.value.status !== 1) return false
  if (!wallet.contract) return false
  return isOwner.value
})

const canRejectReport = computed(() => {
  if (currentListing.value.status !== 1) return false
  if (!wallet.contract) return false
  return isOwner.value
})

const actionKind = ref(null) // 'reportFound' | 'confirmRecovery' | 'cancelListing' | 'rejectReport' | null
const actionStatus = ref('idle')
const actionError = ref('')
const actionSuccessMessage = ref('')

const isActing = computed(() =>
  ['awaiting-signature', 'awaiting-confirmation'].includes(actionStatus.value),
)

function labelFor(kind) {
  const config = ACTION_CONFIG[kind]
  if (actionKind.value === kind) {
    if (actionStatus.value === 'awaiting-signature') return SIGNING_LABEL
    if (actionStatus.value === 'awaiting-confirmation') return config.confirmingLabel
  }
  return config.idleLabel
}

const reportFoundLabel = computed(() => labelFor('reportFound'))
const cancelListingLabel = computed(() => labelFor('cancelListing'))
const confirmRecoveryLabel = computed(() => labelFor('confirmRecovery'))
const rejectReportLabel = computed(() => labelFor('rejectReport'))

// Lets a manual Cancel click (during awaiting-signature only) abandon the
// in-flight wallet request immediately, instead of making the user wait
// out the full wallet-response timeout. The request itself isn't actually
// abortable, so it may still be hanging in the background -- see
// ignoreLateSettlement.
let cancelGate = null

async function runAction(kind) {
  const config = ACTION_CONFIG[kind]
  actionError.value = ''
  actionSuccessMessage.value = ''
  actionKind.value = kind
  cancelGate = createCancelGate()

  try {
    actionStatus.value = 'awaiting-signature'
    const sendPromise = config.send(wallet.contract, currentListing.value.id)
    ignoreLateSettlement(sendPromise)
    const tx = await Promise.race([sendPromise, cancelGate.promise])

    actionStatus.value = 'awaiting-confirmation'
    await waitForActionReceipt(tx)

    currentListing.value = await fetchListing(wallet.contract, currentListing.value.id)
    actionStatus.value = 'success'
    actionSuccessMessage.value = config.successMessage
  } catch (err) {
    if (err instanceof CancelledError) {
      actionStatus.value = 'idle'
      actionKind.value = null
      return
    }
    actionStatus.value = 'error'
    actionError.value =
      err instanceof ListingContractError ? err.message : err?.message || 'Action failed.'
  } finally {
    cancelGate = null
  }
}

function onReportFound() {
  return runAction('reportFound')
}
function onCancelListing() {
  return runAction('cancelListing')
}
function onConfirmRecovery() {
  return runAction('confirmRecovery')
}
function onRejectReport() {
  return runAction('rejectReport')
}

function cancelAction() {
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

      <div v-if="canReportFound" class="listing-action">
        <button
          type="button"
          class="report-found-button"
          :disabled="isActing"
          @click="onReportFound"
        >
          {{ reportFoundLabel }}
        </button>
      </div>

      <div v-if="canCancelListing" class="listing-action">
        <button
          type="button"
          class="cancel-listing-button"
          :disabled="isActing"
          @click="onCancelListing"
        >
          {{ cancelListingLabel }}
        </button>
      </div>

      <div v-if="canConfirmRecovery || canRejectReport" class="listing-action reported-actions">
        <button
          v-if="canConfirmRecovery"
          type="button"
          class="confirm-recovery-button"
          :disabled="isActing"
          @click="onConfirmRecovery"
        >
          {{ confirmRecoveryLabel }}
        </button>
        <button
          v-if="canRejectReport"
          type="button"
          class="reject-report-button"
          :disabled="isActing"
          @click="onRejectReport"
        >
          {{ rejectReportLabel }}
        </button>
      </div>

      <button
        v-if="actionStatus === 'awaiting-signature'"
        type="button"
        class="action-cancel-button"
        @click="cancelAction"
      >
        Cancel
      </button>

      <p v-if="actionError" class="action-error">{{ actionError }}</p>
      <p v-if="actionStatus === 'success'" class="action-success">{{ actionSuccessMessage }}</p>
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

.listing-action {
  margin-top: 0.25rem;
}

.listing-action button {
  width: 100%;
}

.report-found-button,
.cancel-listing-button {
  background: transparent;
  border: 1px solid var(--color-border);
  color: inherit;
}

/* Reported listings show two opposite owner actions side by side --
   visually distinct so they can't be confused: Confirm Recovery (releases
   the reward -- positive/primary) vs Reject Report (disputes the claim --
   warning/secondary). */
.reported-actions {
  display: flex;
  gap: 0.5rem;
}

.reported-actions button {
  flex: 1;
}

.confirm-recovery-button {
  background: #1e7a34;
  border: 1px solid #1e7a34;
  color: #fff;
  font-weight: bold;
}

.reject-report-button {
  background: transparent;
  border: 1px solid #a15c00;
  color: #a15c00;
}

.action-cancel-button {
  width: 100%;
  margin-top: 0.35rem;
  background: transparent;
  border: 1px solid var(--color-border);
  color: inherit;
}

.action-error {
  color: #b3261e;
  font-size: 0.85rem;
  margin: 0.25rem 0 0;
}

.action-success {
  color: #1e7a34;
  font-size: 0.85rem;
}
</style>
