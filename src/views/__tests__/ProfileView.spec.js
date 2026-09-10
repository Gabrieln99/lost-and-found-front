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

import ProfileView from '../ProfileView.vue'
import ListingCard from '@/components/ListingCard.vue'
import { useWalletStore } from '@/stores/wallet'
import { fetchAllListings, ListingContractError } from '@/services/listingContract'

const OWNER = '0xOwner0000000000000000000000000000000001'
const OTHER = '0xFinder000000000000000000000000000000002'
const ZERO = '0x0000000000000000000000000000000000000000'

function rawListing(overrides = {}) {
  return {
    id: 0,
    owner: OWNER,
    finder: ZERO,
    reward: 10000000000000000n,
    itemCID: 'bafytestcid',
    status: 0,
    createdAt: 1700000000n,
    expirationTimestamp: 0n,
    ...overrides,
  }
}

function connectWallet(overrides = {}) {
  const store = useWalletStore()
  store.address = overrides.address ?? OWNER
  store.chainId = overrides.chainId ?? 11155111n
  store.contract = overrides.contract ?? {
    runner: { provider: { getBalance: vi.fn().mockResolvedValue(1500000000000000000n) } },
  }
  return store
}

const writeText = vi.fn().mockResolvedValue(undefined)

describe('ProfileView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  })

  it('shows a hint and loads nothing when the wallet is not connected', async () => {
    const wrapper = mount(ProfileView)
    await flushPromises()

    expect(wrapper.text()).toContain('Connect your wallet to view your profile.')
    expect(fetchAllListings).not.toHaveBeenCalled()
  })

  it('shows a hint when connected to the wrong network', async () => {
    connectWallet({ chainId: 1n })

    const wrapper = mount(ProfileView)
    await flushPromises()

    expect(wrapper.text()).toContain('Switch to Sepolia to view your profile.')
  })

  it('shows the connected address, balance, and an Etherscan link', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue([])

    const wrapper = mount(ProfileView)
    await flushPromises()

    expect(wrapper.text()).toContain(OWNER)
    expect(wrapper.text()).toContain('1.5 ETH')
    const link = wrapper.find('a[href^="https://sepolia.etherscan.io/address/"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe(`https://sepolia.etherscan.io/address/${OWNER}`)
  })

  it('copies the address to the clipboard and confirms it', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue([])

    const wrapper = mount(ProfileView)
    await flushPromises()

    const copyButton = wrapper.findAll('button').find((b) => b.text() === 'Copy')
    await copyButton.trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith(OWNER)
    expect(wrapper.text()).toContain('Copied')
  })

  it('lists only listings owned by the connected wallet under "My Listings"', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue([
      rawListing({ id: 0, owner: OWNER, status: 0 }),
      rawListing({ id: 1, owner: OWNER, status: 2 }),
      rawListing({ id: 2, owner: OTHER, finder: OWNER, status: 1 }),
      rawListing({ id: 3, owner: OTHER, finder: OTHER, status: 0 }),
    ])

    const wrapper = mount(ProfileView)
    await flushPromises()

    const section = wrapper.find('.my-listings')
    expect(section.text()).toContain('My Listings (2)')
    expect(section.text()).toContain('1 Open · 1 Resolved')
    const ids = section.findAllComponents(ListingCard).map((c) => c.props('listing').id)
    expect(ids).toEqual([1, 0]) // newest first
  })

  it('lists only listings where the connected wallet is the finder under "My Found Reports"', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue([
      rawListing({ id: 0, owner: OWNER, status: 0 }),
      rawListing({ id: 2, owner: OTHER, finder: OWNER, status: 1 }),
      rawListing({ id: 3, owner: OTHER, finder: OTHER, status: 0 }),
    ])

    const wrapper = mount(ProfileView)
    await flushPromises()

    const section = wrapper.find('.my-found-reports')
    expect(section.text()).toContain('My Found Reports (1)')
    expect(section.text()).toContain('1 Reported')
    const ids = section.findAllComponents(ListingCard).map((c) => c.props('listing').id)
    expect(ids).toEqual([2])
  })

  it('shows empty-state copy for both sections when the wallet has no listings or reports', async () => {
    connectWallet()
    fetchAllListings.mockResolvedValue([
      rawListing({ id: 0, owner: OTHER, finder: OTHER }),
    ])

    const wrapper = mount(ProfileView)
    await flushPromises()

    expect(wrapper.find('.my-listings').text()).toContain("You haven't published any listings yet.")
    expect(wrapper.find('.my-found-reports').text()).toContain(
      "You haven't reported finding anything yet.",
    )
  })

  it('shows a load error without crashing when fetchAllListings rejects', async () => {
    connectWallet()
    fetchAllListings.mockRejectedValue(new ListingContractError('RPC unavailable'))

    const wrapper = mount(ProfileView)
    await flushPromises()

    expect(wrapper.text()).toContain('RPC unavailable')
  })

  it('still renders the address and sections when the balance read fails', async () => {
    connectWallet({
      contract: {
        runner: { provider: { getBalance: vi.fn().mockRejectedValue(new Error('boom')) } },
      },
    })
    fetchAllListings.mockResolvedValue([])

    const wrapper = mount(ProfileView)
    await flushPromises()

    expect(wrapper.text()).toContain(OWNER)
    expect(wrapper.text()).toContain('Could not load your balance.')
    expect(wrapper.find('.my-listings').exists()).toBe(true)
  })
})
