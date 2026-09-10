<script setup>
import { ref, computed, watch, onMounted, onUnmounted, toRaw } from 'vue'
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
import {
  signMessageBody,
  signReadAuthorization,
  postMessage,
  fetchMessages,
  MessagingServiceError,
} from '@/services/messagingService'
import { createCancelGate, ignoreLateSettlement, CancelledError } from '@/utils/cancelGate'
import Button from '@/components/ui/Button.vue'
import Alert from '@/components/ui/Alert.vue'

// While a message thread is open, poll for new messages this often --
// reusing the same signed read-authorization each tick (see
// loadMessages/startPolling below), not re-signing per poll.
const POLL_INTERVAL_MS = 15_000

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

const isFinder = computed(() => {
  if (!wallet.address) return false
  return wallet.address.toLowerCase() === currentListing.value.finder.toLowerCase()
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

// Owner or finder, on a Reported listing: coordinate the handover via a
// simple signed chat. Not shown to anyone else, and not shown once the
// listing moves past Reported (Resolved/Cancelled) -- the handover is
// what this thread exists for.
const canMessageThread = computed(() => {
  if (currentListing.value.status !== 1) return false
  if (!wallet.contract) return false
  return isOwner.value || isFinder.value
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

// Hide (and stop polling) the moment this card is no longer eligible for
// messaging -- e.g. the owner confirms recovery while the thread happens
// to be open.
watch(canMessageThread, (allowed) => {
  if (!allowed) closeMessages()
})

const messagesOpen = ref(false)
const messages = ref([])
const messagesLoading = ref(false)
const messagesError = ref('')
// The signed read-authorization currently in use for polling. Cleared
// once it goes stale (a poll gets rejected) so the UI can prompt to
// re-sign rather than polling forever with a signature the backend will
// keep rejecting.
const readAuth = ref(null)

const newMessageBody = ref('')
const sendStatus = ref('idle') // idle | awaiting-signature | sending | error
const sendError = ref('')

let pollTimer = null
let readCancelGate = null
let sendCancelGate = null

function shortenAddress(address) {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function isSelf(address) {
  return Boolean(wallet.address) && address.toLowerCase() === wallet.address.toLowerCase()
}

function formatMessageTimestamp(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleString()
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    if (!readAuth.value) return
    try {
      messages.value = await fetchMessages(currentListing.value.id, readAuth.value)
    } catch (err) {
      // The signed read-authorization has likely gone stale (past the
      // backend's freshness window). Stop polling and require an
      // explicit re-sign rather than silently retrying forever or
      // popping an unprompted wallet request.
      stopPolling()
      readAuth.value = null
      messagesError.value =
        err instanceof MessagingServiceError ? err.message : 'Failed to refresh messages.'
    }
  }, POLL_INTERVAL_MS)
}

async function loadMessages() {
  messagesError.value = ''
  messagesLoading.value = true
  readCancelGate = createCancelGate()

  try {
    // toRaw() is required here, not cosmetic: wallet.contract is a Pinia
    // ref, so accessing .runner off it returns a Vue-reactive Proxy of
    // the real ethers Signer. ethers' Contract class avoids true private
    // class fields specifically to stay Proxy-safe, but JsonRpcSigner and
    // JsonRpcApiProvider (which BrowserProvider extends) do use real
    // `#privateFields` (e.g. #notReady) -- calling a method through the
    // reactive Proxy runs it with `this` set to the Proxy, and reading a
    // private field then throws "Cannot read private member #notReady
    // from an object whose class did not declare it" (confirmed via a
    // minimal Vue reactive()-wrapped repro reproducing the exact error).
    // Unwrapping back to the raw signer here sidesteps the whole issue.
    const signer = toRaw(wallet.contract).runner
    const signPromise = signReadAuthorization(signer, currentListing.value.id)
    ignoreLateSettlement(signPromise)
    readAuth.value = await Promise.race([signPromise, readCancelGate.promise])

    messages.value = await fetchMessages(currentListing.value.id, readAuth.value)
    startPolling()
  } catch (err) {
    if (err instanceof CancelledError) {
      messagesOpen.value = false
      return
    }
    messagesError.value =
      err instanceof MessagingServiceError ? err.message : 'Failed to load messages.'
  } finally {
    messagesLoading.value = false
    readCancelGate = null
  }
}

function cancelLoadMessages() {
  readCancelGate?.cancel()
}

function openMessages() {
  messagesOpen.value = true
  return loadMessages()
}

function closeMessages() {
  messagesOpen.value = false
  stopPolling()
  readAuth.value = null
}

function toggleMessages() {
  return messagesOpen.value ? closeMessages() : openMessages()
}

const isSendingMessage = computed(() =>
  ['awaiting-signature', 'sending'].includes(sendStatus.value),
)

const sendButtonLabel = computed(() => {
  switch (sendStatus.value) {
    case 'awaiting-signature':
      return SIGNING_LABEL
    case 'sending':
      return 'Sending...'
    default:
      return 'Send'
  }
})

async function onSendMessage() {
  const body = newMessageBody.value.trim()
  if (!body) return

  sendError.value = ''
  sendCancelGate = createCancelGate()

  try {
    sendStatus.value = 'awaiting-signature'
    // toRaw() is required here -- see loadMessages()'s identical line for why.
    const signer = toRaw(wallet.contract).runner
    const signPromise = signMessageBody(signer, { listingId: currentListing.value.id, body })
    ignoreLateSettlement(signPromise)
    const signed = await Promise.race([signPromise, sendCancelGate.promise])

    sendStatus.value = 'sending'
    const stored = await postMessage(currentListing.value.id, signed)

    messages.value = [...messages.value, stored]
    newMessageBody.value = ''
    sendStatus.value = 'idle'
  } catch (err) {
    if (err instanceof CancelledError) {
      sendStatus.value = 'idle'
      return
    }
    sendStatus.value = 'error'
    sendError.value =
      err instanceof MessagingServiceError ? err.message : err?.message || 'Failed to send message.'
  } finally {
    sendCancelGate = null
  }
}

function cancelSendMessage() {
  sendCancelGate?.cancel()
}

onUnmounted(stopPolling)
</script>

<template>
  <article
    class="listing-card flex flex-col overflow-hidden rounded-lg border border-border bg-surface"
    :class="statusClass"
  >
    <div class="listing-image grid aspect-[4/3] place-items-center overflow-hidden bg-surface-soft">
      <img
        v-if="metadata?.image"
        :src="metadata.image"
        :alt="metadata.description || 'Listing photo'"
        class="h-full w-full object-cover"
      />
      <div v-else class="image-placeholder text-sm text-muted">
        {{ loadingMetadata ? 'Loading…' : 'No image' }}
      </div>
    </div>

    <div class="listing-body flex flex-col gap-2 p-3">
      <span
        class="status-badge self-start rounded-full px-2 py-0.5 text-xs font-semibold"
      >{{ statusLabel }}</span>

      <p v-if="loadingMetadata" class="loading text-sm text-muted">Loading details…</p>
      <template v-else-if="metadataError">
        <Alert tone="danger" class="metadata-error">{{ metadataError }}</Alert>
        <p class="item-cid font-mono text-xs break-all text-muted">
          CID: {{ currentListing.itemCID }}
        </p>
      </template>
      <template v-else>
        <h3 v-if="metadata.title" class="title text-base font-semibold">{{ metadata.title }}</h3>
        <p class="description text-sm">
          <strong class="font-medium text-muted">Description:</strong> {{ metadata.description }}
        </p>
        <p class="location text-sm">
          <strong class="font-medium text-muted">Location:</strong> {{ metadata.location }}
        </p>
      </template>

      <p class="reward text-sm">
        <strong class="font-medium text-muted">Reward:</strong> {{ rewardEth }} ETH
      </p>

      <div v-if="canReportFound" class="listing-action">
        <Button
          class="report-found-button w-full"
          variant="secondary"
          :disabled="isActing"
          @click="onReportFound"
        >
          {{ reportFoundLabel }}
        </Button>
      </div>

      <div v-if="canCancelListing" class="listing-action">
        <Button
          class="cancel-listing-button w-full"
          variant="secondary"
          :disabled="isActing"
          @click="onCancelListing"
        >
          {{ cancelListingLabel }}
        </Button>
      </div>

      <div v-if="canConfirmRecovery || canRejectReport" class="listing-action reported-actions flex gap-2">
        <Button
          v-if="canConfirmRecovery"
          class="confirm-recovery-button flex-1"
          variant="success"
          :disabled="isActing"
          @click="onConfirmRecovery"
        >
          {{ confirmRecoveryLabel }}
        </Button>
        <Button
          v-if="canRejectReport"
          class="reject-report-button flex-1"
          variant="warning"
          :disabled="isActing"
          @click="onRejectReport"
        >
          {{ rejectReportLabel }}
        </Button>
      </div>

      <Button
        v-if="actionStatus === 'awaiting-signature'"
        class="action-cancel-button w-full"
        variant="secondary"
        size="sm"
        @click="cancelAction"
      >
        Cancel
      </Button>

      <Alert v-if="actionError" tone="danger" class="action-error">{{ actionError }}</Alert>
      <Alert v-if="actionStatus === 'success'" tone="success" class="action-success">
        {{ actionSuccessMessage }}
      </Alert>

      <div v-if="canMessageThread" class="listing-action messages-section flex flex-col gap-2">
        <Button
          class="messages-toggle-button self-start"
          variant="secondary"
          size="sm"
          @click="toggleMessages"
        >
          <svg
            class="h-4 w-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          <span>{{ messagesOpen ? 'Hide Messages' : 'Messages' }}</span>
        </Button>

        <div v-if="messagesOpen" class="messages-panel flex flex-col gap-2 border-t border-border pt-2">
          <template v-if="messagesLoading">
            <p class="messages-status text-sm text-muted">
              Waiting for you to confirm in your wallet to open the thread...
            </p>
            <Button
              class="action-cancel-button w-full"
              variant="secondary"
              size="sm"
              @click="cancelLoadMessages"
            >
              Cancel
            </Button>
          </template>

          <template v-else-if="messagesError">
            <Alert tone="danger" class="action-error">{{ messagesError }}</Alert>
            <Button
              class="messages-retry-button w-full"
              variant="secondary"
              size="sm"
              @click="loadMessages"
            >
              {{ readAuth ? 'Retry' : 'Resume' }}
            </Button>
          </template>

          <template v-else>
            <ul class="message-list m-0 flex max-h-48 list-none flex-col gap-2 overflow-y-auto p-0">
              <li v-if="messages.length === 0" class="message-empty text-sm text-muted">
                No messages yet.
              </li>
              <li
                v-for="message in messages"
                :key="message.id"
                class="message-item max-w-[85%] rounded-md px-2 py-1.5"
                :class="isSelf(message.sender) ? 'ml-auto bg-info-soft' : 'bg-surface-soft'"
              >
                <div class="message-meta flex justify-between gap-2 text-[0.7rem] text-muted">
                  <span class="message-sender">
                    {{ shortenAddress(message.sender) }}{{ isSelf(message.sender) ? ' (you)' : '' }}
                  </span>
                  <span class="message-time">{{ formatMessageTimestamp(message.timestamp) }}</span>
                </div>
                <p class="message-body mt-1 whitespace-pre-wrap break-words text-sm">
                  {{ message.body }}
                </p>
              </li>
            </ul>

            <form class="message-compose flex flex-col gap-2" @submit.prevent="onSendMessage">
              <textarea
                v-model="newMessageBody"
                rows="2"
                maxlength="2000"
                placeholder="Write a message..."
                :disabled="isSendingMessage"
                class="resize-y"
              />
              <Button
                type="submit"
                class="message-send-button w-full"
                variant="primary"
                size="sm"
                :disabled="isSendingMessage || !newMessageBody.trim()"
              >
                {{ sendButtonLabel }}
              </Button>
              <Button
                v-if="sendStatus === 'awaiting-signature'"
                class="action-cancel-button w-full"
                variant="secondary"
                size="sm"
                @click="cancelSendMessage"
              >
                Cancel
              </Button>
            </form>
            <Alert v-if="sendError" tone="danger" class="action-error">{{ sendError }}</Alert>
          </template>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
/*
  Only the status-badge colour theming stays as scoped CSS: it keys off the
  root's `status-*` class (set by the statusClass computed) so the badge can
  be coloured per status without adding a status->tone mapping to the
  script, and without changing the root's class list that the specs assert
  on. Everything else is Tailwind utilities in the template.
*/
.status-badge {
  background: var(--color-surface-soft);
  color: var(--color-muted);
}

.status-open .status-badge {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.status-reported .status-badge {
  background: var(--color-warning-soft);
  color: var(--color-warning);
}

.status-resolved .status-badge {
  background: var(--color-info-soft);
  color: var(--color-info);
}

.status-cancelled .status-badge {
  background: var(--color-surface-muted);
  color: var(--color-muted);
}

.status-cancelled .description,
.status-cancelled .location {
  color: var(--color-muted);
}

.listing-card.status-cancelled,
.listing-card.status-resolved {
  opacity: 0.7;
}
</style>
