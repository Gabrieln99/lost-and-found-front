import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/listingContract', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchAllListings: vi.fn(),
  }
})

vi.mock('@/services/ipfsMetadata', () => ({
  fetchListingMetadata: vi.fn().mockResolvedValue({ description: '', location: '', image: null }),
  IpfsMetadataError: class IpfsMetadataError extends Error {},
}))

import BrowseListingsView from '../BrowseListingsView.vue'
import ListingCard from '@/components/ListingCard.vue'
import { useWalletStore } from '@/stores/wallet'
import { fetchAllListings, ListingContractError } from '@/services/listingContract'

function connectWallet(overrides = {}) {
  const store = useWalletStore()
  store.address = overrides.address ?? '0xOwner0000000000000000000000000000000001'
  store.chainId = overrides.chainId ?? 11155111n
  store.contract = overrides.contract ?? {}
  return store
}

function rawListing(overrides = {}) {
  return {
    id: 0,
    owner: '0xOwner0000000000000000000000000000000001',
    finder: '0x0000000000000000000000000000000000000000',
    reward: 10000000000000000n,
    itemCID: 'bafytestcid',
    status: 0,
    createdAt: 1700000000n,
    expirationTimestamp: 0n,
    ...overrides,
  }
}

describe('BrowseListingsView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows a hint and does not attempt to load when the wallet is not connected', async () => {
    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    expect(wrapper.text()).toContain('Connect your wallet to browse listings.')
    expect(fetchAllListings).not.toHaveBeenCalled()
  })

  it('shows the empty state when there are no listings', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue([])

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    expect(wrapper.text()).toContain('No listings yet.')
  })

  it('renders one card per listing, newest first', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue([
      rawListing({ id: 0 }),
      rawListing({ id: 1 }),
      rawListing({ id: 2 }),
    ])

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    const cards = wrapper.findAllComponents(ListingCard)
    const ids = cards.map((c) => c.props('listing').id)
    expect(ids).toEqual([2, 1, 0])
  })

  it('shows a load error without crashing when fetchAllListings rejects', async () => {
    connectWallet()
    fetchAllListings.mockRejectedValue(new ListingContractError('RPC unavailable'))

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    expect(wrapper.text()).toContain('RPC unavailable')
  })

  it('reloads listings once the contract becomes available after connecting later', async () => {
    const store = useWalletStore()
    fetchAllListings.mockResolvedValue([rawListing()])

    const wrapper = mount(BrowseListingsView)
    await flushPromises()
    expect(fetchAllListings).not.toHaveBeenCalled()

    store.address = '0xOwner0000000000000000000000000000000001'
    store.chainId = 11155111n
    store.contract = {}
    await flushPromises()

    expect(fetchAllListings).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain('Connect your wallet')
  })
})
