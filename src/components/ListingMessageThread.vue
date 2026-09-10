<script setup>
import { ref, computed, onUnmounted, toRaw } from 'vue'
import { useWalletStore } from '@/stores/wallet'
import {
  signMessageBody,
  signReadAuthorization,
  postMessage,
  fetchMessages,
  MessagingServiceError,
} from '@/services/messagingService'
import { createCancelGate, ignoreLateSettlement, CancelledError } from '@/utils/cancelGate'
import { shortenAddress } from '@/utils/address'
import { WALLET_SIGNING_LABEL } from '@/utils/walletLabels'
import Button from '@/components/ui/Button.vue'
import Alert from '@/components/ui/Alert.vue'

// While a message thread is open, poll for new messages this often --
// reusing the same signed read-authorization each tick, not re-signing.
const POLL_INTERVAL_MS = 15_000

const props = defineProps({
  listing: { type: Object, required: true },
  // Card: render a "Messages" toggle, thread starts collapsed. Detail
  // view: no toggle, the thread is always shown and auto-loads on mount.
  collapsible: { type: Boolean, default: false },
})

const wallet = useWalletStore()

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
      messages.value = await fetchMessages(props.listing.id, readAuth.value)
    } catch (err) {
      // The signed read-authorization has likely gone stale (past the
      // backend's freshness window). Stop polling and require an explicit
      // re-sign rather than silently retrying forever or popping an
      // unprompted wallet request.
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
    const signPromise = signReadAuthorization(signer, props.listing.id)
    ignoreLateSettlement(signPromise)
    readAuth.value = await Promise.race([signPromise, readCancelGate.promise])

    messages.value = await fetchMessages(props.listing.id, readAuth.value)
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
      return WALLET_SIGNING_LABEL
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
    const signPromise = signMessageBody(signer, { listingId: props.listing.id, body })
    ignoreLateSettlement(signPromise)
    const signed = await Promise.race([signPromise, sendCancelGate.promise])

    sendStatus.value = 'sending'
    const stored = await postMessage(props.listing.id, signed)

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

// No auto-load: even when the panel is visible by default (detail view,
// collapsible=false) the read-authorization signature is only requested
// when the user clicks "Load conversation" -- no unprompted wallet popup,
// same as the Resume button.
onUnmounted(stopPolling)
</script>

<template>
  <div class="messages-section flex flex-col gap-2">
    <Button
      v-if="collapsible"
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

    <div
      v-if="!collapsible || messagesOpen"
      class="messages-panel flex flex-col gap-2 border-t border-border pt-2"
    >
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

      <template v-else-if="!collapsible && !readAuth">
        <Button
          class="messages-retry-button w-full"
          variant="secondary"
          size="sm"
          @click="loadMessages"
        >
          Load conversation
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
</template>
