import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('@/services/ipfsMetadata', () => ({
  fetchListingMetadata: vi.fn(),
  IpfsMetadataError: class IpfsMetadataError extends Error {},
}))

import ListingCard from '../ListingCard.vue'
import { fetchListingMetadata, IpfsMetadataError } from '@/services/ipfsMetadata'

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

describe('ListingCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
