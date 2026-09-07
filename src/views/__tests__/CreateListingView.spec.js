import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/storageService', () => ({
  uploadListingMetadata: vi.fn(),
  StorageServiceError: class StorageServiceError extends Error {},
}))

vi.mock('@/services/listingContract', () => ({
  sendCreateListingTx: vi.fn(),
  waitForListingReceipt: vi.fn(),
  ListingContractError: class ListingContractError extends Error {},
}))

import CreateListingView from '../CreateListingView.vue'
import { useWalletStore } from '@/stores/wallet'
import { uploadListingMetadata, StorageServiceError } from '@/services/storageService'
import {
  sendCreateListingTx,
  waitForListingReceipt,
  ListingContractError,
} from '@/services/listingContract'

function connectWallet(overrides = {}) {
  const store = useWalletStore()
  store.address = overrides.address ?? '0xOwner0000000000000000000000000000000001'
  store.chainId = overrides.chainId ?? 11155111n
  store.contract = overrides.contract ?? { createListing: vi.fn(), interface: { parseLog: vi.fn() } }
  return store
}

async function fillValidForm(wrapper) {
  await wrapper.find('#title').setValue('Lost cat')
  await wrapper.find('#description').setValue('Lost cat, orange tabby')
  await wrapper.find('#location').setValue('Central Park, near the fountain')
  await wrapper.find('#reward').setValue('0.05')

  const file = new File(['fake-image-bytes'], 'cat.png', { type: 'image/png' })
  const input = wrapper.find('#image')
  Object.defineProperty(input.element, 'files', { value: [file] })
  await input.trigger('change')

  return file
}

// vee-validate's own validation, plus our submit handler's chained awaits,
// resolve across more than one microtask flush in jsdom -- a single
// flushPromises() (a macrotask) isn't consistently enough. Interleaving a
// real (0ms) timer between two flushes reliably drains everything.
async function submitAndSettle(wrapper) {
  await wrapper.find('form').trigger('submit')
  for (let i = 0; i < 5; i++) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('CreateListingView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows a hint instead of letting you submit when the wallet is not connected', () => {
    const wrapper = mount(CreateListingView)
    expect(wrapper.text()).toContain('Connect your wallet to publish a listing.')
  })

  it('shows validation errors when required fields are missing on submit', async () => {
    const wrapper = mount(CreateListingView)

    await submitAndSettle(wrapper)

    expect(wrapper.text()).toContain('Title is required.')
    expect(wrapper.text()).toContain('Description is required.')
    expect(wrapper.text()).toContain('Location is required.')
    expect(wrapper.text()).toContain('Reward is required.')
    expect(sendCreateListingTx).not.toHaveBeenCalled()
  })

  it('rejects a non-image file selection', async () => {
    const wrapper = mount(CreateListingView)

    const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' })
    const input = wrapper.find('#image')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')

    expect(wrapper.text()).toContain('Please select an image file.')
  })

  it('rejects an oversized image file', async () => {
    const wrapper = mount(CreateListingView)

    const file = new File(['x'], 'huge.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 })
    const input = wrapper.find('#image')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')

    expect(wrapper.text()).toContain('Image must be 10 MB or smaller.')
  })

  it('uploads the image and calls the contract on a valid submit', async () => {
    const store = connectWallet()

    uploadListingMetadata.mockResolvedValue('bafymetadatacid')
    const fakeTx = {}
    sendCreateListingTx.mockResolvedValue(fakeTx)
    waitForListingReceipt.mockResolvedValue({ listingId: 3n, transactionHash: '0xabc' })

    const wrapper = mount(CreateListingView)
    const file = await fillValidForm(wrapper)

    await submitAndSettle(wrapper)

    expect(uploadListingMetadata).toHaveBeenCalledWith({
      file,
      title: 'Lost cat',
      description: 'Lost cat, orange tabby',
      location: 'Central Park, near the fountain',
    })
    expect(sendCreateListingTx).toHaveBeenCalledWith(
      store.contract,
      expect.objectContaining({ cid: 'bafymetadatacid' }),
    )
    expect(waitForListingReceipt).toHaveBeenCalledWith(store.contract, fakeTx)
    expect(wrapper.text()).toContain('Listing published!')
    expect(wrapper.text()).toContain('0xabc')
  })

  it('shows an error and does not call the contract when the upload fails', async () => {
    connectWallet()
    uploadListingMetadata.mockRejectedValue(new StorageServiceError('Pinata is down'))

    const wrapper = mount(CreateListingView)
    await fillValidForm(wrapper)

    await submitAndSettle(wrapper)

    expect(wrapper.text()).toContain('Pinata is down')
    expect(sendCreateListingTx).not.toHaveBeenCalled()
  })

  it('shows an error when the wallet rejects the transaction', async () => {
    connectWallet()
    uploadListingMetadata.mockResolvedValue('bafymetadatacid')
    sendCreateListingTx.mockRejectedValue(
      new ListingContractError('Transaction was rejected in your wallet.'),
    )

    const wrapper = mount(CreateListingView)
    await fillValidForm(wrapper)

    await submitAndSettle(wrapper)

    expect(wrapper.text()).toContain('Transaction was rejected in your wallet.')
    expect(waitForListingReceipt).not.toHaveBeenCalled()
  })
})
