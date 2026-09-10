import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/ipfsMetadata', () => ({
  fetchListingMetadata: vi.fn(),
  IpfsMetadataError: class IpfsMetadataError extends Error {},
}))

vi.mock('@/services/listingContract', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    sendReportFoundTx: vi.fn(),
    sendConfirmRecoveryTx: vi.fn(),
    sendCancelListingTx: vi.fn(),
    sendRejectReportTx: vi.fn(),
    waitForActionReceipt: vi.fn(),
    fetchListing: vi.fn(),
  }
})

vi.mock('@/services/messagingService', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    signMessageBody: vi.fn(),
    signReadAuthorization: vi.fn(),
    postMessage: vi.fn(),
    fetchMessages: vi.fn(),
  }
})

import ListingCard from '../ListingCard.vue'
import { useWalletStore } from '@/stores/wallet'
import { fetchListingMetadata, IpfsMetadataError } from '@/services/ipfsMetadata'
import {
  sendReportFoundTx,
  sendConfirmRecoveryTx,
  sendCancelListingTx,
  sendRejectReportTx,
  waitForActionReceipt,
  fetchListing,
  ListingContractError,
} from '@/services/listingContract'
import {
  signMessageBody,
  signReadAuthorization,
  postMessage,
  fetchMessages,
  MessagingServiceError,
} from '@/services/messagingService'

const OWNER_ADDRESS = '0xOwner0000000000000000000000000000000001'
const OTHER_ADDRESS = '0xFinder000000000000000000000000000000002'
const STRANGER_ADDRESS = '0xStranger0000000000000000000000000000003'

function baseListing(overrides = {}) {
  return {
    id: 0,
    owner: OWNER_ADDRESS,
    finder: '0x0000000000000000000000000000000000000000',
    reward: 10000000000000000n, // 0.01 ETH
    itemCID: 'bafymetadatacid',
    status: 0,
    createdAt: 1700000000n,
    expirationTimestamp: 0n,
    ...overrides,
  }
}

function connectWallet(overrides = {}) {
  const store = useWalletStore()
  store.address = overrides.address ?? OTHER_ADDRESS
  store.chainId = overrides.chainId ?? 11155111n
  store.contract = overrides.contract ?? {
    reportFound: vi.fn(),
    confirmRecovery: vi.fn(),
    cancelListing: vi.fn(),
    rejectReport: vi.fn(),
    runner: { signMessage: vi.fn() },
  }
  return store
}

describe('ListingCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    fetchListingMetadata.mockResolvedValue({
      title: '',
      description: 'A lost thing',
      location: 'Somewhere',
      image: null,
    })
  })

  it('shows a loading state before metadata resolves', () => {
    fetchListingMetadata.mockReturnValue(new Promise(() => {})) // never resolves
    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })

    expect(wrapper.text()).toContain('Loading details')
  })

  it('renders title, description, location, image, reward, and status once loaded', async () => {
    fetchListingMetadata.mockResolvedValue({
      title: 'Lost wallet',
      description: 'Titan-colored wallet',
      location: 'Central Park',
      image: 'https://gateway.pinata.cloud/ipfs/bafyimagecid',
    })

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    expect(fetchListingMetadata).toHaveBeenCalledWith('bafymetadatacid')
    expect(wrapper.find('h3.title').text()).toBe('Lost wallet')
    expect(wrapper.text()).toContain('Titan-colored wallet')
    expect(wrapper.text()).toContain('Central Park')
    expect(wrapper.text()).toContain('0.01 ETH')
    expect(wrapper.text()).toContain('Open')
    expect(wrapper.find('img').attributes('src')).toBe(
      'https://gateway.pinata.cloud/ipfs/bafyimagecid',
    )
  })

  it('labels each field so values are self-explanatory, not raw text', async () => {
    fetchListingMetadata.mockResolvedValue({
      title: 'Lost wallet',
      description: 'Titan-colored wallet',
      location: 'Central Park',
      image: null,
    })

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    expect(wrapper.text()).toContain('Description:')
    expect(wrapper.text()).toContain('Location:')
    expect(wrapper.text()).toContain('Reward:')
  })

  it('omits the title heading when older metadata has no title field', async () => {
    fetchListingMetadata.mockResolvedValue({
      title: '',
      description: 'Old-format listing with no title',
      location: 'Central Park',
      image: null,
    })

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    expect(wrapper.find('h3.title').exists()).toBe(false)
  })

  it('shows an error and the raw CID when metadata fails to load, without crashing', async () => {
    fetchListingMetadata.mockRejectedValue(new IpfsMetadataError('Gateway timed out'))

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    expect(wrapper.text()).toContain('Gateway timed out')
    expect(wrapper.text()).toContain('bafymetadatacid')
  })

  it('applies a status-specific class for visual distinction', async () => {
    fetchListingMetadata.mockResolvedValue({ description: '', location: '', image: null })

    const wrapper = mount(ListingCard, { props: { listing: baseListing({ status: 3 }) } })
    await flushPromises()

    expect(wrapper.classes()).toContain('status-cancelled')
    expect(wrapper.text()).toContain('Cancelled')
  })
})

// Chained awaits (send tx -> wait for receipt -> re-fetch listing) resolve
// across more than one microtask flush in jsdom, same reasoning as
// CreateListingView's submitAndSettle helper.
async function clickReportAndSettle(wrapper) {
  await wrapper.find('button.report-found-button').trigger('click')
  for (let i = 0; i < 5; i++) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('ListingCard - Report Found', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    fetchListingMetadata.mockResolvedValue({ description: '', location: '', image: null })
  })

  it('does not show a Report Found button when the wallet is not connected', async () => {
    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    expect(wrapper.find('button.report-found-button').exists()).toBe(false)
  })

  it('does not show a Report Found button for the listing owner', async () => {
    connectWallet({ address: OWNER_ADDRESS })

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    expect(wrapper.find('button.report-found-button').exists()).toBe(false)
  })

  it('does not show a Report Found button for a non-Open listing', async () => {
    connectWallet()

    const wrapper = mount(ListingCard, { props: { listing: baseListing({ status: 1 }) } })
    await flushPromises()

    expect(wrapper.find('button.report-found-button').exists()).toBe(false)
  })

  it('shows a Report Found button for a non-owner on an Open listing', async () => {
    connectWallet()

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    expect(wrapper.find('button.report-found-button').exists()).toBe(true)
  })

  it('walks through signature/confirmation states and updates the card after a successful report', async () => {
    const store = connectWallet()
    const tx = {}
    sendReportFoundTx.mockResolvedValue(tx)
    waitForActionReceipt.mockResolvedValue(undefined)
    fetchListing.mockResolvedValue(
      baseListing({ status: 1, finder: store.address }),
    )

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    await clickReportAndSettle(wrapper)

    expect(sendReportFoundTx).toHaveBeenCalledWith(store.contract, 0)
    expect(waitForActionReceipt).toHaveBeenCalledWith(tx)
    expect(fetchListing).toHaveBeenCalledWith(store.contract, 0)
    expect(wrapper.text()).toContain('You reported this item as found.')
    expect(wrapper.text()).toContain('Reported')
    expect(wrapper.find('button.report-found-button').exists()).toBe(false)
  })

  it('shows an error and keeps the button usable when the wallet rejects the report transaction', async () => {
    connectWallet()
    sendReportFoundTx.mockRejectedValue(
      new ListingContractError('Transaction was rejected in your wallet.'),
    )

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    await clickReportAndSettle(wrapper)

    expect(wrapper.text()).toContain('Transaction was rejected in your wallet.')
    expect(waitForActionReceipt).not.toHaveBeenCalled()
    expect(wrapper.find('button.report-found-button').attributes('disabled')).toBeUndefined()
  })

  // Regression test for a real bug: the button used to get stuck showing
  // "Waiting for you to confirm in your wallet..." after the user
  // cancelled/rejected the MetaMask prompt (e.g. clicked the popup's X or
  // Cancel), instead of resetting back to a clickable state. The card
  // itself just needs to treat any rejection from sendReportFoundTx --
  // whatever its origin -- as a signal to leave the awaiting-signature
  // state; the underlying fix for wallets that never respond at all lives
  // in listingContract.js's wallet-response timeout (see its own spec).
  it('resets the button from "waiting for signature" back to a usable state when the user cancels the MetaMask prompt', async () => {
    connectWallet()

    // A controllable pending promise stands in for the real wallet
    // signature request, so the awaiting-signature state can actually be
    // observed before it settles (a pre-rejected mock settles too fast to
    // ever render an intermediate state).
    let rejectSignatureRequest
    sendReportFoundTx.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSignatureRequest = reject
      }),
    )

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    wrapper.find('button.report-found-button').trigger('click')
    await flushPromises()

    // Mid-flight: the button should reflect the awaiting-signature state.
    expect(wrapper.find('button.report-found-button').text()).toContain(
      'Waiting for you to confirm in your wallet',
    )
    expect(wrapper.find('button.report-found-button').attributes('disabled')).toBeDefined()

    // Simulate the user cancelling/rejecting the MetaMask prompt.
    rejectSignatureRequest(new ListingContractError('Transaction was rejected in your wallet.'))
    for (let i = 0; i < 5; i++) {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    // After the rejection settles, the button must return to normal --
    // not stay stuck on the waiting-for-signature copy.
    const button = wrapper.find('button.report-found-button')
    expect(button.text()).toBe('Report Found')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('Transaction was rejected in your wallet.')
  })

  it('does not show a Cancel button before a report is started or once it is past awaiting-signature', async () => {
    const store = connectWallet()
    sendReportFoundTx.mockResolvedValue({})
    waitForActionReceipt.mockReturnValue(new Promise(() => {})) // never settles

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    expect(wrapper.find('button.action-cancel-button').exists()).toBe(false)

    wrapper.find('button.report-found-button').trigger('click')
    await flushPromises()

    // Now in awaiting-confirmation (the send already resolved) -- no
    // signature left to cancel out of.
    expect(sendReportFoundTx).toHaveBeenCalledWith(store.contract, 0)
    expect(wrapper.find('button.action-cancel-button').exists()).toBe(false)
  })

  it('lets the user cancel out of the awaiting-signature state immediately, without waiting for the wallet', async () => {
    connectWallet()
    // The wallet request hangs forever -- exactly the scenario the Cancel
    // button exists for.
    sendReportFoundTx.mockReturnValue(new Promise(() => {}))

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    wrapper.find('button.report-found-button').trigger('click')
    await flushPromises()

    const cancelButton = wrapper.find('button.action-cancel-button')
    expect(cancelButton.exists()).toBe(true)

    await cancelButton.trigger('click')
    for (let i = 0; i < 5; i++) {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const reportButton = wrapper.find('button.report-found-button')
    expect(reportButton.text()).toBe('Report Found')
    expect(reportButton.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('button.action-cancel-button').exists()).toBe(false)
    // Cancelling isn't an error -- no error message should appear.
    expect(wrapper.find('.action-error').exists()).toBe(false)
  })

  it('does not surface an error if the abandoned request eventually rejects after being cancelled', async () => {
    connectWallet()
    let rejectSignatureRequest
    sendReportFoundTx.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSignatureRequest = reject
      }),
    )

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    wrapper.find('button.report-found-button').trigger('click')
    await flushPromises()

    await wrapper.find('button.action-cancel-button').trigger('click')
    for (let i = 0; i < 5; i++) {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    // The abandoned request finally settles (e.g. the wallet's timeout
    // fires) well after the user already cancelled -- this must not
    // resurrect an error state.
    rejectSignatureRequest(new ListingContractError('No response from your wallet.'))
    for (let i = 0; i < 5; i++) {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(wrapper.find('.action-error').exists()).toBe(false)
    expect(wrapper.find('button.report-found-button').text()).toBe('Report Found')
  })
})

// Generic settle helper shared by the three owner-action suites below --
// same reasoning as clickReportAndSettle: the send -> wait -> re-fetch
// chain resolves across more than one microtask flush in jsdom.
async function clickAndSettle(wrapper, selector) {
  await wrapper.find(selector).trigger('click')
  for (let i = 0; i < 5; i++) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('ListingCard - Cancel Listing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    fetchListingMetadata.mockResolvedValue({ description: '', location: '', image: null })
  })

  it('does not show a Cancel Listing button when the wallet is not connected', async () => {
    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    expect(wrapper.find('button.cancel-listing-button').exists()).toBe(false)
  })

  it('does not show a Cancel Listing button for a non-owner', async () => {
    connectWallet({ address: OTHER_ADDRESS })

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    expect(wrapper.find('button.cancel-listing-button').exists()).toBe(false)
  })

  it('does not show a Cancel Listing button for a non-Open listing', async () => {
    connectWallet({ address: OWNER_ADDRESS })

    const wrapper = mount(ListingCard, { props: { listing: baseListing({ status: 1 }) } })
    await flushPromises()

    expect(wrapper.find('button.cancel-listing-button').exists()).toBe(false)
  })

  it('shows a Cancel Listing button for the owner on an Open listing', async () => {
    connectWallet({ address: OWNER_ADDRESS })

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    expect(wrapper.find('button.cancel-listing-button').exists()).toBe(true)
    // The owner shouldn't also see Report Found on their own listing.
    expect(wrapper.find('button.report-found-button').exists()).toBe(false)
  })

  it('walks through signature/confirmation states and updates the card after a successful cancellation', async () => {
    const store = connectWallet({ address: OWNER_ADDRESS })
    const tx = {}
    sendCancelListingTx.mockResolvedValue(tx)
    waitForActionReceipt.mockResolvedValue(undefined)
    fetchListing.mockResolvedValue(baseListing({ status: 3 }))

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    await clickAndSettle(wrapper, 'button.cancel-listing-button')

    expect(sendCancelListingTx).toHaveBeenCalledWith(store.contract, 0)
    expect(waitForActionReceipt).toHaveBeenCalledWith(tx)
    expect(fetchListing).toHaveBeenCalledWith(store.contract, 0)
    expect(wrapper.text()).toContain('Listing cancelled -- your reward has been refunded.')
    expect(wrapper.text()).toContain('Cancelled')
    expect(wrapper.find('button.cancel-listing-button').exists()).toBe(false)
  })

  it('shows an error and keeps the button usable when the wallet rejects the cancellation', async () => {
    connectWallet({ address: OWNER_ADDRESS })
    sendCancelListingTx.mockRejectedValue(
      new ListingContractError('Transaction was rejected in your wallet.'),
    )

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    await clickAndSettle(wrapper, 'button.cancel-listing-button')

    expect(wrapper.text()).toContain('Transaction was rejected in your wallet.')
    expect(wrapper.find('button.cancel-listing-button').attributes('disabled')).toBeUndefined()
  })

  it('lets the user cancel out of the awaiting-signature state via the shared Cancel button', async () => {
    connectWallet({ address: OWNER_ADDRESS })
    sendCancelListingTx.mockReturnValue(new Promise(() => {})) // hangs forever

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    await wrapper.find('button.cancel-listing-button').trigger('click')
    await flushPromises()

    await clickAndSettle(wrapper, 'button.action-cancel-button')

    expect(wrapper.find('button.cancel-listing-button').text()).toBe('Cancel Listing')
    expect(wrapper.find('.action-error').exists()).toBe(false)
  })
})

describe('ListingCard - Confirm Recovery / Reject Report', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    fetchListingMetadata.mockResolvedValue({ description: '', location: '', image: null })
  })

  it('does not show Confirm Recovery or Reject Report when the wallet is not connected', async () => {
    const wrapper = mount(ListingCard, { props: { listing: baseListing({ status: 1 }) } })
    await flushPromises()

    expect(wrapper.find('button.confirm-recovery-button').exists()).toBe(false)
    expect(wrapper.find('button.reject-report-button').exists()).toBe(false)
  })

  it('does not show Confirm Recovery or Reject Report for a non-owner', async () => {
    connectWallet({ address: OTHER_ADDRESS })

    const wrapper = mount(ListingCard, { props: { listing: baseListing({ status: 1 }) } })
    await flushPromises()

    expect(wrapper.find('button.confirm-recovery-button').exists()).toBe(false)
    expect(wrapper.find('button.reject-report-button').exists()).toBe(false)
  })

  it('does not show Confirm Recovery or Reject Report for a non-Reported listing', async () => {
    connectWallet({ address: OWNER_ADDRESS })

    const wrapper = mount(ListingCard, { props: { listing: baseListing({ status: 0 }) } })
    await flushPromises()

    expect(wrapper.find('button.confirm-recovery-button').exists()).toBe(false)
    expect(wrapper.find('button.reject-report-button').exists()).toBe(false)
  })

  it('shows both Confirm Recovery and Reject Report, visually distinct, for the owner on a Reported listing', async () => {
    connectWallet({ address: OWNER_ADDRESS })

    const wrapper = mount(ListingCard, { props: { listing: baseListing({ status: 1 }) } })
    await flushPromises()

    const confirmButton = wrapper.find('button.confirm-recovery-button')
    const rejectButton = wrapper.find('button.reject-report-button')
    expect(confirmButton.exists()).toBe(true)
    expect(rejectButton.exists()).toBe(true)
    // They must not share a CSS class -- opposite actions need distinct styling.
    expect(confirmButton.classes()).not.toEqual(rejectButton.classes())
  })

  it('walks through signature/confirmation states and updates the card after confirming recovery, with copy that mentions the released funds', async () => {
    const store = connectWallet({ address: OWNER_ADDRESS })
    const tx = {}
    sendConfirmRecoveryTx.mockResolvedValue(tx)
    waitForActionReceipt.mockResolvedValue(undefined)
    fetchListing.mockResolvedValue(baseListing({ status: 2 }))

    const wrapper = mount(ListingCard, { props: { listing: baseListing({ status: 1 }) } })
    await flushPromises()

    await clickAndSettle(wrapper, 'button.confirm-recovery-button')

    expect(sendConfirmRecoveryTx).toHaveBeenCalledWith(store.contract, 0)
    expect(waitForActionReceipt).toHaveBeenCalledWith(tx)
    expect(fetchListing).toHaveBeenCalledWith(store.contract, 0)
    expect(wrapper.text()).toContain(
      'Recovery confirmed -- the reward has been released to the finder.',
    )
    expect(wrapper.text()).toContain('Resolved')
    expect(wrapper.find('button.confirm-recovery-button').exists()).toBe(false)
    expect(wrapper.find('button.reject-report-button').exists()).toBe(false)
  })

  it('shows a confirmation-releasing-funds message while awaiting on-chain confirmation', async () => {
    connectWallet({ address: OWNER_ADDRESS })
    sendConfirmRecoveryTx.mockResolvedValue({})
    waitForActionReceipt.mockReturnValue(new Promise(() => {})) // never settles

    const wrapper = mount(ListingCard, { props: { listing: baseListing({ status: 1 }) } })
    await flushPromises()

    await wrapper.find('button.confirm-recovery-button').trigger('click')
    await flushPromises()

    expect(wrapper.find('button.confirm-recovery-button').text()).toContain(
      'Releasing the reward to the finder',
    )
  })

  it('walks through signature/confirmation states and updates the card after rejecting a report', async () => {
    const store = connectWallet({ address: OWNER_ADDRESS })
    const tx = {}
    sendRejectReportTx.mockResolvedValue(tx)
    waitForActionReceipt.mockResolvedValue(undefined)
    fetchListing.mockResolvedValue(baseListing({ status: 0 }))

    const wrapper = mount(ListingCard, { props: { listing: baseListing({ status: 1 }) } })
    await flushPromises()

    await clickAndSettle(wrapper, 'button.reject-report-button')

    expect(sendRejectReportTx).toHaveBeenCalledWith(store.contract, 0)
    expect(waitForActionReceipt).toHaveBeenCalledWith(tx)
    expect(fetchListing).toHaveBeenCalledWith(store.contract, 0)
    expect(wrapper.text()).toContain('Report rejected -- the listing is open again.')
    expect(wrapper.text()).toContain('Open')
    expect(wrapper.find('button.confirm-recovery-button').exists()).toBe(false)
    expect(wrapper.find('button.reject-report-button').exists()).toBe(false)
  })

  it('disables both Confirm Recovery and Reject Report while either action is in flight', async () => {
    connectWallet({ address: OWNER_ADDRESS })
    sendConfirmRecoveryTx.mockReturnValue(new Promise(() => {})) // hangs forever

    const wrapper = mount(ListingCard, { props: { listing: baseListing({ status: 1 }) } })
    await flushPromises()

    await wrapper.find('button.confirm-recovery-button').trigger('click')
    await flushPromises()

    expect(wrapper.find('button.confirm-recovery-button').attributes('disabled')).toBeDefined()
    expect(wrapper.find('button.reject-report-button').attributes('disabled')).toBeDefined()
  })

  it('shows an error and keeps both buttons usable when confirming recovery is rejected', async () => {
    connectWallet({ address: OWNER_ADDRESS })
    sendConfirmRecoveryTx.mockRejectedValue(
      new ListingContractError('Transaction was rejected in your wallet.'),
    )

    const wrapper = mount(ListingCard, { props: { listing: baseListing({ status: 1 }) } })
    await flushPromises()

    await clickAndSettle(wrapper, 'button.confirm-recovery-button')

    expect(wrapper.text()).toContain('Transaction was rejected in your wallet.')
    expect(wrapper.find('button.confirm-recovery-button').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('button.reject-report-button').attributes('disabled')).toBeUndefined()
  })

  it('lets the user cancel out of the awaiting-signature state via the shared Cancel button', async () => {
    connectWallet({ address: OWNER_ADDRESS })
    sendRejectReportTx.mockReturnValue(new Promise(() => {})) // hangs forever

    const wrapper = mount(ListingCard, { props: { listing: baseListing({ status: 1 }) } })
    await flushPromises()

    await wrapper.find('button.reject-report-button').trigger('click')
    await flushPromises()

    await clickAndSettle(wrapper, 'button.action-cancel-button')

    expect(wrapper.find('button.reject-report-button').text()).toBe('Reject Report')
    expect(wrapper.find('button.confirm-recovery-button').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.action-error').exists()).toBe(false)
  })
})

describe('ListingCard - Messages', () => {
  const STORED_MESSAGE = {
    id: 1,
    listingId: 0,
    sender: OWNER_ADDRESS,
    body: 'Meet at the fountain at noon',
    timestamp: 1700000000,
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    fetchListingMetadata.mockResolvedValue({ description: '', location: '', image: null })
  })

  it('is hidden when the wallet is not connected', async () => {
    const wrapper = mount(ListingCard, { props: { listing: baseListing({ status: 1 }) } })
    await flushPromises()

    expect(wrapper.find('button.messages-toggle-button').exists()).toBe(false)
  })

  it('is hidden for a non-Reported listing, even for the owner', async () => {
    connectWallet({ address: OWNER_ADDRESS })

    const wrapper = mount(ListingCard, { props: { listing: baseListing({ status: 0 }) } })
    await flushPromises()

    expect(wrapper.find('button.messages-toggle-button').exists()).toBe(false)
  })

  it('is hidden from a stranger (neither owner nor finder) on a Reported listing', async () => {
    connectWallet({ address: STRANGER_ADDRESS })

    const wrapper = mount(ListingCard, {
      props: { listing: baseListing({ status: 1, finder: OTHER_ADDRESS }) },
    })
    await flushPromises()

    expect(wrapper.find('button.messages-toggle-button').exists()).toBe(false)
  })

  it('is shown to the owner on a Reported listing', async () => {
    connectWallet({ address: OWNER_ADDRESS })

    const wrapper = mount(ListingCard, {
      props: { listing: baseListing({ status: 1, finder: OTHER_ADDRESS }) },
    })
    await flushPromises()

    expect(wrapper.find('button.messages-toggle-button').exists()).toBe(true)
  })

  it('is shown to the finder on a Reported listing', async () => {
    connectWallet({ address: OTHER_ADDRESS })

    const wrapper = mount(ListingCard, {
      props: { listing: baseListing({ status: 1, finder: OTHER_ADDRESS }) },
    })
    await flushPromises()

    expect(wrapper.find('button.messages-toggle-button').exists()).toBe(true)
  })

  describe('opening the thread', () => {
    it('signs a read authorization once and displays the returned messages', async () => {
      const store = connectWallet({ address: OWNER_ADDRESS })
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValue([STORED_MESSAGE])

      const wrapper = mount(ListingCard, {
        props: { listing: baseListing({ status: 1, finder: OTHER_ADDRESS }) },
      })
      await flushPromises()

      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      expect(signReadAuthorization).toHaveBeenCalledTimes(1)
      expect(signReadAuthorization).toHaveBeenCalledWith(store.contract.runner, 0)
      expect(fetchMessages).toHaveBeenCalledWith(0, { timestamp: 1700000000, signature: '0xreadsig' })
      expect(wrapper.text()).toContain('Meet at the fountain at noon')
      expect(wrapper.text()).toContain('(you)') // OWNER_ADDRESS is the connected wallet
    })

    it('shows an empty-thread message when there are no messages yet', async () => {
      connectWallet({ address: OWNER_ADDRESS })
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValue([])

      const wrapper = mount(ListingCard, {
        props: { listing: baseListing({ status: 1, finder: OTHER_ADDRESS }) },
      })
      await flushPromises()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('No messages yet.')
    })

    it('shows an error and a Resume button when signing or fetching fails', async () => {
      connectWallet({ address: OWNER_ADDRESS })
      signReadAuthorization.mockRejectedValue(
        new MessagingServiceError('Transaction was rejected in your wallet.'),
      )

      const wrapper = mount(ListingCard, {
        props: { listing: baseListing({ status: 1, finder: OTHER_ADDRESS }) },
      })
      await flushPromises()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('Transaction was rejected in your wallet.')
      expect(wrapper.find('button.messages-retry-button').text()).toBe('Resume')
    })

    it('lets the user cancel out of the awaiting-signature state, closing the panel', async () => {
      connectWallet({ address: OWNER_ADDRESS })
      signReadAuthorization.mockReturnValue(new Promise(() => {})) // hangs forever

      const wrapper = mount(ListingCard, {
        props: { listing: baseListing({ status: 1, finder: OTHER_ADDRESS }) },
      })
      await flushPromises()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      const cancelButton = wrapper.find('.messages-panel button.action-cancel-button')
      expect(cancelButton.exists()).toBe(true)

      await cancelButton.trigger('click')
      for (let i = 0; i < 5; i++) {
        await flushPromises()
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      expect(wrapper.find('.messages-panel').exists()).toBe(false)
      expect(wrapper.find('.action-error').exists()).toBe(false)
    })
  })

  describe('polling', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('polls with the same signed credential, without re-signing', async () => {
      connectWallet({ address: OWNER_ADDRESS })
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValue([STORED_MESSAGE])

      const wrapper = mount(ListingCard, {
        props: { listing: baseListing({ status: 1, finder: OTHER_ADDRESS }) },
      })
      await flushPromises()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      expect(signReadAuthorization).toHaveBeenCalledTimes(1)
      expect(fetchMessages).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)

      expect(signReadAuthorization).toHaveBeenCalledTimes(1) // still just the one signature
      expect(fetchMessages).toHaveBeenCalledTimes(3)
      expect(fetchMessages).toHaveBeenCalledWith(0, { timestamp: 1700000000, signature: '0xreadsig' })
    })

    it('stops polling and requires a Resume once the credential goes stale', async () => {
      connectWallet({ address: OWNER_ADDRESS })
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValueOnce([STORED_MESSAGE])
      fetchMessages.mockRejectedValueOnce(
        new MessagingServiceError('Timestamp is too far from the server\'s clock.'),
      )

      const wrapper = mount(ListingCard, {
        props: { listing: baseListing({ status: 1, finder: OTHER_ADDRESS }) },
      })
      await flushPromises()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      await vi.advanceTimersByTimeAsync(15_000)

      expect(wrapper.text()).toContain("Timestamp is too far from the server's clock.")
      const resumeButton = wrapper.find('button.messages-retry-button')
      expect(resumeButton.text()).toBe('Resume')

      // No further polling while stopped.
      fetchMessages.mockClear()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(fetchMessages).not.toHaveBeenCalled()

      // Resuming re-signs.
      fetchMessages.mockResolvedValue([STORED_MESSAGE])
      await resumeButton.trigger('click')
      await flushPromises()

      expect(signReadAuthorization).toHaveBeenCalledTimes(2)
    })

    it('stops polling once the thread is closed', async () => {
      connectWallet({ address: OWNER_ADDRESS })
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValue([STORED_MESSAGE])

      const wrapper = mount(ListingCard, {
        props: { listing: baseListing({ status: 1, finder: OTHER_ADDRESS }) },
      })
      await flushPromises()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      await wrapper.find('button.messages-toggle-button').trigger('click') // Hide Messages
      fetchMessages.mockClear()

      await vi.advanceTimersByTimeAsync(60_000)

      expect(fetchMessages).not.toHaveBeenCalled()
    })
  })

  describe('sending a message', () => {
    it('walks through signature/sending states and appends the new message', async () => {
      const store = connectWallet({ address: OWNER_ADDRESS })
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValue([])
      signMessageBody.mockResolvedValue({
        timestamp: 1700000100,
        body: 'On my way',
        signature: '0xsendsig',
      })
      postMessage.mockResolvedValue({
        id: 2,
        listingId: 0,
        sender: OWNER_ADDRESS,
        body: 'On my way',
        timestamp: 1700000100,
      })

      const wrapper = mount(ListingCard, {
        props: { listing: baseListing({ status: 1, finder: OTHER_ADDRESS }) },
      })
      await flushPromises()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      await wrapper.find('textarea').setValue('On my way')
      await wrapper.find('form.message-compose').trigger('submit')
      await flushPromises()

      expect(signMessageBody).toHaveBeenCalledWith(store.contract.runner, {
        listingId: 0,
        body: 'On my way',
      })
      expect(postMessage).toHaveBeenCalledWith(0, {
        timestamp: 1700000100,
        body: 'On my way',
        signature: '0xsendsig',
      })
      expect(wrapper.text()).toContain('On my way')
      expect(wrapper.find('textarea').element.value).toBe('')
    })

    it('does not submit a blank message', async () => {
      connectWallet({ address: OWNER_ADDRESS })
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValue([])

      const wrapper = mount(ListingCard, {
        props: { listing: baseListing({ status: 1, finder: OTHER_ADDRESS }) },
      })
      await flushPromises()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      await wrapper.find('textarea').setValue('   ')
      await wrapper.find('form.message-compose').trigger('submit')
      await flushPromises()

      expect(signMessageBody).not.toHaveBeenCalled()
    })

    it('shows an error and keeps the compose form usable when sending fails', async () => {
      connectWallet({ address: OWNER_ADDRESS })
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValue([])
      signMessageBody.mockRejectedValue(
        new MessagingServiceError('Transaction was rejected in your wallet.'),
      )

      const wrapper = mount(ListingCard, {
        props: { listing: baseListing({ status: 1, finder: OTHER_ADDRESS }) },
      })
      await flushPromises()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      await wrapper.find('textarea').setValue('hello')
      await wrapper.find('form.message-compose').trigger('submit')
      await flushPromises()

      expect(wrapper.text()).toContain('Transaction was rejected in your wallet.')
      expect(wrapper.find('button.message-send-button').attributes('disabled')).toBeUndefined()
    })

    it('lets the user cancel out of the awaiting-signature state while sending', async () => {
      connectWallet({ address: OWNER_ADDRESS })
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValue([])
      signMessageBody.mockReturnValue(new Promise(() => {})) // hangs forever

      const wrapper = mount(ListingCard, {
        props: { listing: baseListing({ status: 1, finder: OTHER_ADDRESS }) },
      })
      await flushPromises()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      await wrapper.find('textarea').setValue('hello')
      await wrapper.find('form.message-compose').trigger('submit')
      await flushPromises()

      const cancelButton = wrapper.find('.message-compose button.action-cancel-button')
      expect(cancelButton.exists()).toBe(true)
      await cancelButton.trigger('click')
      for (let i = 0; i < 5; i++) {
        await flushPromises()
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      expect(postMessage).not.toHaveBeenCalled()
      expect(wrapper.find('button.message-send-button').text()).toBe('Send')
      expect(wrapper.find('.action-error').exists()).toBe(false)
    })
  })

  it('closes the thread automatically once the card is no longer eligible for messaging', async () => {
    connectWallet({ address: OWNER_ADDRESS })
    signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
    fetchMessages.mockResolvedValue([])

    const wrapper = mount(ListingCard, {
      props: { listing: baseListing({ id: 0, status: 1, finder: OTHER_ADDRESS }) },
    })
    await flushPromises()
    await wrapper.find('button.messages-toggle-button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.messages-panel').exists()).toBe(true)

    await wrapper.setProps({ listing: baseListing({ id: 0, status: 2, finder: OTHER_ADDRESS }) })
    await flushPromises()

    expect(wrapper.find('button.messages-toggle-button').exists()).toBe(false)
  })
})
