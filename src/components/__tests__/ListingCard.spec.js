import { describe, it, expect, vi, beforeEach } from 'vitest'
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
    waitForReportFoundReceipt: vi.fn(),
    fetchListing: vi.fn(),
  }
})

import ListingCard from '../ListingCard.vue'
import { useWalletStore } from '@/stores/wallet'
import { fetchListingMetadata, IpfsMetadataError } from '@/services/ipfsMetadata'
import {
  sendReportFoundTx,
  waitForReportFoundReceipt,
  fetchListing,
  ListingContractError,
} from '@/services/listingContract'

function baseListing(overrides = {}) {
  return {
    id: 0,
    owner: '0xOwner0000000000000000000000000000000001',
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
  store.address = overrides.address ?? '0xFinder000000000000000000000000000000002'
  store.chainId = overrides.chainId ?? 11155111n
  store.contract = overrides.contract ?? { reportFound: vi.fn() }
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
    connectWallet({ address: '0xOwner0000000000000000000000000000000001' })

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
    waitForReportFoundReceipt.mockResolvedValue(undefined)
    fetchListing.mockResolvedValue(
      baseListing({ status: 1, finder: store.address }),
    )

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    await clickReportAndSettle(wrapper)

    expect(sendReportFoundTx).toHaveBeenCalledWith(store.contract, 0)
    expect(waitForReportFoundReceipt).toHaveBeenCalledWith(tx)
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
    expect(waitForReportFoundReceipt).not.toHaveBeenCalled()
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
})
