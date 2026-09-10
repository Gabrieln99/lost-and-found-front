import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

let mockId = '0'
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: mockId } }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/services/listingContract', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchListing: vi.fn(),
    waitForActionReceipt: vi.fn(),
    sendReportFoundTx: vi.fn(),
    sendConfirmRecoveryTx: vi.fn(),
    sendCancelListingTx: vi.fn(),
    sendRejectReportTx: vi.fn(),
  }
})

vi.mock('@/services/ipfsMetadata', () => ({
  fetchListingMetadata: vi.fn(),
  IpfsMetadataError: class IpfsMetadataError extends Error {},
}))

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

import ListingDetailView from '../ListingDetailView.vue'
import { useWalletStore } from '@/stores/wallet'
import {
  fetchListing,
  waitForActionReceipt,
  sendCancelListingTx,
  ListingContractError,
} from '@/services/listingContract'
import { fetchListingMetadata } from '@/services/ipfsMetadata'
import { signReadAuthorization, fetchMessages } from '@/services/messagingService'

const OWNER = '0xOwner0000000000000000000000000000000001'
const FINDER = '0xFinder000000000000000000000000000000002'
const STRANGER = '0xStranger0000000000000000000000000000003'
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
  store.address = overrides.address ?? STRANGER
  store.chainId = overrides.chainId ?? 11155111n
  store.contract =
    overrides.contract ??
    (overrides.noContract
      ? null
      : {
          listingCount: vi.fn().mockResolvedValue(5n),
          reportFound: vi.fn(),
          confirmRecovery: vi.fn(),
          cancelListing: vi.fn(),
          rejectReport: vi.fn(),
          runner: { signMessage: vi.fn() },
        })
  return store
}

async function settle() {
  for (let i = 0; i < 4; i++) await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mockId = '0'
  fetchListingMetadata.mockResolvedValue({
    title: 'Lost wallet',
    description: 'Brown leather bifold',
    location: 'Central Park',
    image: 'https://gw/ipfs/img',
  })
  signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xsig' })
  fetchMessages.mockResolvedValue([])
})

describe('ListingDetailView - id validation', () => {
  it.each(['abc', '-1', '1.5', '', '0x1', ' 3'])('treats %j as not found', async (bad) => {
    mockId = bad
    const store = connectWallet()
    const wrapper = mount(ListingDetailView)
    await settle()

    expect(wrapper.find('.not-found').exists()).toBe(true)
    expect(store.contract.listingCount).not.toHaveBeenCalled()
    expect(fetchListing).not.toHaveBeenCalled()
  })
})

describe('ListingDetailView - wallet gate', () => {
  it('prompts to connect when the wallet is not connected', async () => {
    mockId = '2'
    const wrapper = mount(ListingDetailView)
    await settle()

    expect(wrapper.text()).toContain('Connect your wallet to view this listing.')
    expect(fetchListing).not.toHaveBeenCalled()
  })

  it('prompts to switch network when on the wrong chain', async () => {
    mockId = '2'
    connectWallet({ chainId: 1n })
    const wrapper = mount(ListingDetailView)
    await settle()

    expect(wrapper.text()).toContain('Switch to Sepolia to view this listing.')
  })

  it('reports a missing contract configuration', async () => {
    mockId = '2'
    connectWallet({ noContract: true })
    const wrapper = mount(ListingDetailView)
    await settle()

    expect(wrapper.text()).toContain('The contract address is not configured yet.')
  })
})

describe('ListingDetailView - loading & not-found', () => {
  it('shows a loading state while the listing resolves', async () => {
    mockId = '2'
    const store = connectWallet()
    store.contract.listingCount.mockReturnValue(new Promise(() => {})) // never resolves

    const wrapper = mount(ListingDetailView)
    await flushPromises()

    expect(wrapper.text()).toContain('Loading listing…')
  })

  it('shows "doesn\'t exist" for an id past listingCount, without fetching it', async () => {
    mockId = '5'
    const store = connectWallet()
    store.contract.listingCount.mockResolvedValue(3n)

    const wrapper = mount(ListingDetailView)
    await settle()

    expect(wrapper.text()).toContain("Listing #5 doesn't exist.")
    expect(fetchListing).not.toHaveBeenCalled()
  })

  it('treats an in-range zero-struct listing as not found', async () => {
    mockId = '2'
    connectWallet()
    fetchListing.mockResolvedValue(rawListing({ id: 2, owner: ZERO, createdAt: 0n }))

    const wrapper = mount(ListingDetailView)
    await settle()

    expect(wrapper.find('.not-found').exists()).toBe(true)
  })

  it('surfaces a load error without crashing', async () => {
    mockId = '2'
    connectWallet()
    fetchListing.mockRejectedValue(new ListingContractError('RPC unavailable'))

    const wrapper = mount(ListingDetailView)
    await settle()

    expect(wrapper.find('.load-error').text()).toContain('RPC unavailable')
  })
})

describe('ListingDetailView - rendering', () => {
  it('renders the listing fields once loaded', async () => {
    mockId = '2'
    connectWallet()
    fetchListing.mockResolvedValue(rawListing({ id: 2, status: 0 }))

    const wrapper = mount(ListingDetailView)
    await settle()

    expect(fetchListing).toHaveBeenCalledWith(expect.anything(), 2)
    expect(wrapper.find('h1.title').text()).toBe('Lost wallet')
    expect(wrapper.text()).toContain('Brown leather bifold')
    expect(wrapper.text()).toContain('Central Park')
    expect(wrapper.text()).toContain('0.01 ETH')
    expect(wrapper.text()).toContain('Open')
    expect(wrapper.find('img').attributes('src')).toBe('https://gw/ipfs/img')
    expect(wrapper.find('.owner').text()).toContain('0xOwne...0001')
    expect(wrapper.find('.finder').exists()).toBe(false)
  })

  it('shows the finder on a Reported listing', async () => {
    mockId = '2'
    connectWallet({ address: OWNER })
    fetchListing.mockResolvedValue(rawListing({ id: 2, status: 1, finder: FINDER }))

    const wrapper = mount(ListingDetailView)
    await settle()

    expect(wrapper.find('.finder').text()).toContain('0xFind...0002')
  })

  it('always renders a back-to-browse link', async () => {
    mockId = '2'
    connectWallet()
    fetchListing.mockResolvedValue(rawListing({ id: 2 }))

    const wrapper = mount(ListingDetailView)
    await settle()

    expect(wrapper.text()).toContain('Back to listings')
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/browse')
  })
})

describe('ListingDetailView - actions & messaging', () => {
  it('shows Report Found to a non-owner on an Open listing', async () => {
    mockId = '2'
    connectWallet({ address: STRANGER })
    fetchListing.mockResolvedValue(rawListing({ id: 2, status: 0 }))

    const wrapper = mount(ListingDetailView)
    await settle()

    expect(wrapper.find('button.report-found-button').exists()).toBe(true)
    expect(wrapper.find('button.cancel-listing-button').exists()).toBe(false)
  })

  it('shows Cancel Listing to the owner on an Open listing', async () => {
    mockId = '2'
    connectWallet({ address: OWNER })
    fetchListing.mockResolvedValue(rawListing({ id: 2, status: 0 }))

    const wrapper = mount(ListingDetailView)
    await settle()

    expect(wrapper.find('button.cancel-listing-button').exists()).toBe(true)
    expect(wrapper.find('button.report-found-button').exists()).toBe(false)
  })

  it('shows Confirm Recovery + Reject Report to the owner on a Reported listing', async () => {
    mockId = '2'
    connectWallet({ address: OWNER })
    fetchListing.mockResolvedValue(rawListing({ id: 2, status: 1, finder: FINDER }))

    const wrapper = mount(ListingDetailView)
    await settle()

    expect(wrapper.find('button.confirm-recovery-button').exists()).toBe(true)
    expect(wrapper.find('button.reject-report-button').exists()).toBe(true)
  })

  it('hides actions and the message thread from a stranger on a Reported listing', async () => {
    mockId = '2'
    connectWallet({ address: STRANGER })
    fetchListing.mockResolvedValue(rawListing({ id: 2, status: 1, finder: FINDER }))

    const wrapper = mount(ListingDetailView)
    await settle()

    expect(wrapper.find('button.confirm-recovery-button').exists()).toBe(false)
    expect(wrapper.find('button.report-found-button').exists()).toBe(false)
    expect(wrapper.find('form.message-compose').exists()).toBe(false)
  })

  it('auto-loads the message thread (no toggle) for the finder on a Reported listing', async () => {
    mockId = '2'
    connectWallet({ address: FINDER })
    fetchListing.mockResolvedValue(rawListing({ id: 2, status: 1, finder: FINDER }))

    const wrapper = mount(ListingDetailView)
    await settle()

    expect(wrapper.find('button.messages-toggle-button').exists()).toBe(false)
    expect(signReadAuthorization).toHaveBeenCalledWith(expect.anything(), 2)
    expect(wrapper.find('form.message-compose').exists()).toBe(true)
  })

  it('refreshes the view in place after a successful action', async () => {
    mockId = '2'
    connectWallet({ address: OWNER })
    fetchListing
      .mockResolvedValueOnce(rawListing({ id: 2, status: 0 }))
      .mockResolvedValueOnce(rawListing({ id: 2, status: 3 }))
    sendCancelListingTx.mockResolvedValue({})
    waitForActionReceipt.mockResolvedValue(undefined)

    const wrapper = mount(ListingDetailView)
    await settle()
    expect(wrapper.find('button.cancel-listing-button').exists()).toBe(true)

    await wrapper.find('button.cancel-listing-button').trigger('click')
    for (let i = 0; i < 6; i++) {
      await flushPromises()
      await new Promise((r) => setTimeout(r, 0))
    }

    expect(wrapper.find('.action-success').text()).toContain('Listing cancelled')
    expect(wrapper.text()).toContain('Cancelled')
    expect(wrapper.find('button.cancel-listing-button').exists()).toBe(false)
  })
})
