import { ref, computed, watch } from 'vue'
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
import { createCancelGate, ignoreLateSettlement, CancelledError } from '@/utils/cancelGate'
import { WALLET_SIGNING_LABEL } from '@/utils/walletLabels'

// One entry per listing action. A single generic runAction() drives all
// four buttons through the identical awaiting-signature ->
// awaiting-confirmation -> success/error flow.
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

/**
 * The four on-chain listing actions plus all derived listing state, shared
 * by `ListingCard` and `ListingDetailView`.
 *
 * Owns `currentListing` -- a local, updatable copy of the source listing.
 * `runAction()` re-fetches and reassigns it after a successful action, so
 * the consuming view/card reflects the new status/finder in place without
 * the parent re-fetching. The source is a getter (not a param) so it can
 * be `null` while a detail view is still loading; every field read is
 * null-guarded for that window.
 *
 * @param {() => (object | null | undefined)} sourceListingGetter
 * @returns {{
 *   currentListing: import('vue').Ref<object>,
 *   statusLabel: import('vue').ComputedRef<string>,
 *   statusClass: import('vue').ComputedRef<string>,
 *   rewardEth: import('vue').ComputedRef<string>,
 *   isOwner: import('vue').ComputedRef<boolean>,
 *   isFinder: import('vue').ComputedRef<boolean>,
 *   canReportFound: import('vue').ComputedRef<boolean>,
 *   canCancelListing: import('vue').ComputedRef<boolean>,
 *   canConfirmRecovery: import('vue').ComputedRef<boolean>,
 *   canRejectReport: import('vue').ComputedRef<boolean>,
 *   canMessageThread: import('vue').ComputedRef<boolean>,
 *   actionStatus: import('vue').Ref<string>,
 *   actionError: import('vue').Ref<string>,
 *   actionSuccessMessage: import('vue').Ref<string>,
 *   isActing: import('vue').ComputedRef<boolean>,
 *   reportFoundLabel: import('vue').ComputedRef<string>,
 *   cancelListingLabel: import('vue').ComputedRef<string>,
 *   confirmRecoveryLabel: import('vue').ComputedRef<string>,
 *   rejectReportLabel: import('vue').ComputedRef<string>,
 *   onReportFound: () => Promise<void>,
 *   onCancelListing: () => Promise<void>,
 *   onConfirmRecovery: () => Promise<void>,
 *   onRejectReport: () => Promise<void>,
 *   cancelAction: () => void,
 * }}
 */
export function useListingActions(sourceListingGetter) {
  const wallet = useWalletStore()

  // Local, updatable copy of the listing. Null-safe seed so a detail view
  // can call this before its listing has loaded.
  const currentListing = ref({ ...sourceListingGetter() })
  watch(sourceListingGetter, (value) => {
    currentListing.value = { ...value }
  })

  const statusLabel = computed(() => STATUS_LABELS[currentListing.value.status] ?? 'Unknown')
  const statusClass = computed(() => `status-${statusLabel.value.toLowerCase()}`)
  const rewardEth = computed(() => formatEther(currentListing.value.reward ?? 0n))

  const isOwner = computed(() => {
    if (!wallet.address) return false
    return wallet.address.toLowerCase() === currentListing.value.owner?.toLowerCase()
  })

  const isFinder = computed(() => {
    if (!wallet.address) return false
    return wallet.address.toLowerCase() === currentListing.value.finder?.toLowerCase()
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
  // owner can choose.
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
  // simple signed chat. Not shown to anyone else, and not once the listing
  // moves past Reported.
  const canMessageThread = computed(() => {
    if (currentListing.value.status !== 1) return false
    if (!wallet.contract) return false
    return isOwner.value || isFinder.value
  })

  const actionKind = ref(null)
  const actionStatus = ref('idle')
  const actionError = ref('')
  const actionSuccessMessage = ref('')

  const isActing = computed(() =>
    ['awaiting-signature', 'awaiting-confirmation'].includes(actionStatus.value),
  )

  function labelFor(kind) {
    const config = ACTION_CONFIG[kind]
    if (actionKind.value === kind) {
      if (actionStatus.value === 'awaiting-signature') return WALLET_SIGNING_LABEL
      if (actionStatus.value === 'awaiting-confirmation') return config.confirmingLabel
    }
    return config.idleLabel
  }

  const reportFoundLabel = computed(() => labelFor('reportFound'))
  const cancelListingLabel = computed(() => labelFor('cancelListing'))
  const confirmRecoveryLabel = computed(() => labelFor('confirmRecovery'))
  const rejectReportLabel = computed(() => labelFor('rejectReport'))

  // Lets a manual Cancel click (during awaiting-signature only) abandon the
  // in-flight wallet request immediately, instead of waiting out the full
  // wallet-response timeout. The request isn't actually abortable, so it
  // may still be hanging in the background -- see ignoreLateSettlement.
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

  function cancelAction() {
    cancelGate?.cancel()
  }

  return {
    currentListing,
    statusLabel,
    statusClass,
    rewardEth,
    isOwner,
    isFinder,
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
    onReportFound: () => runAction('reportFound'),
    onCancelListing: () => runAction('cancelListing'),
    onConfirmRecovery: () => runAction('confirmRecovery'),
    onRejectReport: () => runAction('rejectReport'),
    cancelAction,
  }
}
