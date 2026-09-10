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
import { fetchListingMetadata } from '@/services/ipfsMetadata'

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

  it('does not show the filter/search controls or pagination when there are no listings', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue([])

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    expect(wrapper.find('select.status-filter').exists()).toBe(false)
    expect(wrapper.find('input.search-input').exists()).toBe(false)
    expect(wrapper.find('.pagination').exists()).toBe(false)
  })
})

function metadataFor(cid) {
  return (
    {
      'cid-0': { title: 'Lost wallet', description: 'Brown leather wallet', location: 'Central Park' },
      'cid-1': { title: 'Lost cat', description: 'Orange tabby', location: '5th Avenue' },
      'cid-2': { title: 'Lost keys', description: 'Car keys', location: 'Main Street' },
      'cid-3': { title: 'Lost phone', description: 'iPhone', location: 'Central Station' },
    }[cid] ?? { title: '', description: '', location: '' }
  )
}

function statusFixtureListings() {
  return [
    rawListing({ id: 0, status: 0, itemCID: 'cid-0' }),
    rawListing({ id: 1, status: 1, itemCID: 'cid-1' }),
    rawListing({ id: 2, status: 2, itemCID: 'cid-2' }),
    rawListing({ id: 3, status: 3, itemCID: 'cid-3' }),
  ]
}

function cardIds(wrapper) {
  return wrapper.findAllComponents(ListingCard).map((c) => c.props('listing').id)
}

describe('BrowseListingsView - status filter', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    fetchListingMetadata.mockImplementation((cid) => Promise.resolve(metadataFor(cid)))
  })

  it('defaults to showing only Open listings, and "all" reveals every status', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue(statusFixtureListings())

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    // Fixture statuses are 0/1/2/3; the default filter is Open (0).
    expect(cardIds(wrapper)).toEqual([0])

    await wrapper.find('select.status-filter').setValue('all')

    expect(cardIds(wrapper)).toEqual([3, 2, 1, 0])
  })

  it('narrows the grid down to only the selected status', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue(statusFixtureListings())

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    await wrapper.find('select.status-filter').setValue('1')

    expect(cardIds(wrapper)).toEqual([1])
    expect(wrapper.text()).not.toContain('No listings match your filters.')
  })

  it('shows a "no results" message when no listing matches the filter', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue([rawListing({ id: 0, status: 0, itemCID: 'cid-0' })])

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    await wrapper.find('select.status-filter').setValue('3')

    expect(cardIds(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('No listings match your filters.')
  })
})

describe('BrowseListingsView - text search', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    fetchListingMetadata.mockImplementation((cid) => Promise.resolve(metadataFor(cid)))
  })

  it('matches on title, description, or location once metadata has loaded', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue(statusFixtureListings())

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    // 'tabby' belongs to the Reported listing, so search across all statuses.
    await wrapper.find('select.status-filter').setValue('all')
    await wrapper.find('input.search-input').setValue('tabby')

    expect(cardIds(wrapper)).toEqual([1])
  })

  it('is case-insensitive and matches substrings', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue(statusFixtureListings())

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    await wrapper.find('input.search-input').setValue('WALL')

    expect(cardIds(wrapper)).toEqual([0])
  })

  it('searches within the currently filtered status, not the full list', async () => {
    connectWallet()
    // Two "Central..." listings, but only one is Open.
    fetchAllListings.mockResolvedValue(statusFixtureListings())

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    await wrapper.find('select.status-filter').setValue('0')
    await wrapper.find('input.search-input').setValue('central')

    // cid-3 ("Central Station") matches the text but is Cancelled, not Open.
    expect(cardIds(wrapper)).toEqual([0])
  })

  it('clears back to the full (status-filtered) list when the query is cleared', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue(statusFixtureListings())

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    await wrapper.find('select.status-filter').setValue('all')
    await wrapper.find('input.search-input').setValue('tabby')
    expect(cardIds(wrapper)).toEqual([1])

    await wrapper.find('input.search-input').setValue('')
    expect(cardIds(wrapper)).toEqual([3, 2, 1, 0])
  })
})

describe('BrowseListingsView - pagination', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    fetchListingMetadata.mockResolvedValue({ title: '', description: '', location: '' })
  })

  function manyListings(count) {
    return Array.from({ length: count }, (_, i) => rawListing({ id: i, status: 0 }))
  }

  it('does not show pagination controls when everything fits on one page', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue(manyListings(9))

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    expect(wrapper.find('.pagination').exists()).toBe(false)
    expect(cardIds(wrapper)).toHaveLength(9)
  })

  it('splits listings across pages once the count exceeds the page size', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue(manyListings(10))

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    expect(wrapper.text()).toContain('Page 1 of 2')
    expect(cardIds(wrapper)).toHaveLength(9)

    const [prevButton, nextButton] = wrapper.findAll('.page-button')
    expect(prevButton.attributes('disabled')).toBeDefined()
    expect(nextButton.attributes('disabled')).toBeUndefined()

    await nextButton.trigger('click')

    expect(wrapper.text()).toContain('Page 2 of 2')
    expect(cardIds(wrapper)).toHaveLength(1)
    expect(wrapper.findAll('.page-button')[1].attributes('disabled')).toBeDefined()

    await wrapper.findAll('.page-button')[0].trigger('click')

    expect(wrapper.text()).toContain('Page 1 of 2')
  })

  it('resets to page 1 when the status filter changes', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue(manyListings(10))

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    await wrapper.findAll('.page-button')[1].trigger('click') // -> page 2
    expect(wrapper.text()).toContain('Page 2 of 2')

    // All 10 fixture listings are Open, so switching to "all" still shows
    // all 10 (2 pages) -- a genuine filter change from the Open default,
    // isolating the page-reset behavior from the separate clamping test.
    await wrapper.find('select.status-filter').setValue('all')

    expect(wrapper.text()).toContain('Page 1 of 2')
  })

  it('resets to page 1 when the search query changes', async () => {
    connectWallet()
    // Give every listing matching metadata so a search narrows nothing --
    // isolating the page-reset behavior from result-count changes.
    fetchListingMetadata.mockResolvedValue({ title: 'Item', description: '', location: '' })
    fetchAllListings.mockResolvedValue(manyListings(10))

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    await wrapper.findAll('.page-button')[1].trigger('click') // -> page 2
    expect(wrapper.text()).toContain('Page 2 of 2')

    await wrapper.find('input.search-input').setValue('item')

    expect(wrapper.text()).toContain('Page 1 of 2')
  })

  it('clamps back to the last valid page if the result set shrinks out from under it', async () => {
    connectWallet()
    // 9 Open + 1 Reported: the "all" view (10 items) needs 2 pages, with
    // page 2 holding only the Reported listing. Filtering down to Open (9
    // items, 1 page) should clamp the still-page-2 state back to page 1
    // instead of going blank.
    const listings = [...manyListings(9), rawListing({ id: 9, status: 1 })]
    fetchAllListings.mockResolvedValue(listings)

    const wrapper = mount(BrowseListingsView)
    await flushPromises()

    // Start from the "all" view (the default is now Open): 10 items across
    // 2 pages, page 2 holding just the Reported listing.
    await wrapper.find('select.status-filter').setValue('all')
    await wrapper.findAll('.page-button')[1].trigger('click') // -> page 2 (10 items total)
    expect(wrapper.text()).toContain('Page 2 of 2')

    await wrapper.find('select.status-filter').setValue('0')

    expect(wrapper.find('.pagination').exists()).toBe(false)
    expect(cardIds(wrapper)).toHaveLength(9)
  })
})
