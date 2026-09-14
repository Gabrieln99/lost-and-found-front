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
import { VueDatePicker } from '@vuepic/vue-datepicker'
import { useWalletStore } from '@/stores/wallet'
import { useToasts } from '@/composables/useToasts'
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
    useToasts().toasts.value.splice(0)
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

    const { toasts } = useToasts()
    expect(toasts.value).toContainEqual(
      expect.objectContaining({ tone: 'success', message: 'Listing published!' }),
    )
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

  // Regression test: this view shares the exact same
  // signature -> confirmation flow as ListingCard's Report Found button,
  // which had a real bug where cancelling the MetaMask prompt left the
  // button stuck showing "Waiting for you to confirm in your wallet...".
  // The underlying fix (a wallet-response timeout) lives in
  // listingContract.js; this confirms the form itself resets properly once
  // sendCreateListingTx rejects for any reason, including a cancellation.
  it('resets the submit button from "waiting for signature" back to a usable state when the user cancels the MetaMask prompt', async () => {
    const store = connectWallet()
    uploadListingMetadata.mockResolvedValue('bafymetadatacid')

    let rejectSignatureRequest
    sendCreateListingTx.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSignatureRequest = reject
      }),
    )

    const wrapper = mount(CreateListingView)
    await fillValidForm(wrapper)

    wrapper.find('form').trigger('submit')
    for (let i = 0; i < 5; i++) {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (sendCreateListingTx.mock.calls.length > 0) break
    }

    // Mid-flight: the button should reflect the awaiting-signature state.
    expect(wrapper.find('button[type="submit"]').text()).toContain(
      'Waiting for you to confirm in your wallet',
    )
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(sendCreateListingTx).toHaveBeenCalledWith(
      store.contract,
      expect.objectContaining({ cid: 'bafymetadatacid' }),
    )

    // Simulate the user cancelling/rejecting the MetaMask prompt.
    rejectSignatureRequest(new ListingContractError('Transaction was rejected in your wallet.'))
    for (let i = 0; i < 5; i++) {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const button = wrapper.find('button[type="submit"]')
    expect(button.text()).toBe('Publish listing')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('Transaction was rejected in your wallet.')
  })

  it('does not show a Cancel button before submitting or once past awaiting-signature', async () => {
    connectWallet()
    uploadListingMetadata.mockResolvedValue('bafymetadatacid')
    sendCreateListingTx.mockResolvedValue({})
    waitForListingReceipt.mockReturnValue(new Promise(() => {})) // never settles

    const wrapper = mount(CreateListingView)
    await fillValidForm(wrapper)

    expect(wrapper.find('button.cancel-button').exists()).toBe(false)

    wrapper.find('form').trigger('submit')
    for (let i = 0; i < 5; i++) {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (sendCreateListingTx.mock.calls.length > 0) break
    }

    // Now in awaiting-confirmation (the send already resolved) -- no
    // signature left to cancel out of.
    expect(wrapper.find('button.cancel-button').exists()).toBe(false)
  })

  it('lets the user cancel out of the awaiting-signature state immediately, without waiting for the wallet', async () => {
    connectWallet()
    uploadListingMetadata.mockResolvedValue('bafymetadatacid')
    // The wallet request hangs forever -- exactly the scenario the Cancel
    // button exists for.
    sendCreateListingTx.mockReturnValue(new Promise(() => {}))

    const wrapper = mount(CreateListingView)
    await fillValidForm(wrapper)

    wrapper.find('form').trigger('submit')
    for (let i = 0; i < 5; i++) {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (sendCreateListingTx.mock.calls.length > 0) break
    }

    const cancelButton = wrapper.find('button.cancel-button')
    expect(cancelButton.exists()).toBe(true)

    await cancelButton.trigger('click')
    for (let i = 0; i < 5; i++) {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const submitButton = wrapper.find('button[type="submit"]')
    expect(submitButton.text()).toBe('Publish listing')
    expect(submitButton.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('button.cancel-button').exists()).toBe(false)
    // Cancelling isn't an error -- no error message should appear.
    expect(wrapper.find('.submit-error').exists()).toBe(false)
  })

  it('blurs the reward field on wheel so scrolling the page cannot change its value', async () => {
    const wrapper = mount(CreateListingView, { attachTo: document.body })
    const reward = wrapper.find('#reward')

    reward.element.focus()
    expect(document.activeElement).toBe(reward.element)

    await reward.trigger('wheel')

    expect(document.activeElement).not.toBe(reward.element)
    wrapper.unmount()
  })

  it('shows a live character counter for the description field', async () => {
    const wrapper = mount(CreateListingView)

    expect(wrapper.text()).toContain('0 / 500')

    await wrapper.find('#description').setValue('Lost cat, orange tabby')

    expect(wrapper.text()).toContain('22 / 500')
  })

  it('caps the description field at 500 characters via maxlength', () => {
    const wrapper = mount(CreateListingView)
    expect(wrapper.find('#description').attributes('maxlength')).toBe('500')
  })

  it('gives the description textarea no manual resize handle', () => {
    const wrapper = mount(CreateListingView)
    expect(wrapper.find('#description').classes()).toContain('resize-none')
  })

  // Regression test for the datetime-local -> VueDatePicker swap: the
  // picker's v-model emits a JS Date object (not the old
  // "YYYY-MM-DDTHH:mm" string), and it's easy to silently break the
  // Date -> Unix-seconds conversion the contract expects when changing what
  // shape the field's value takes.
  it('converts the picked expiration date/time to the correct Unix-seconds timestamp for the contract', async () => {
    const store = connectWallet()
    uploadListingMetadata.mockResolvedValue('bafymetadatacid')
    const fakeTx = {}
    sendCreateListingTx.mockResolvedValue(fakeTx)
    waitForListingReceipt.mockResolvedValue({ listingId: 3n, transactionHash: '0xabc' })

    const wrapper = mount(CreateListingView)
    await fillValidForm(wrapper)

    const pickedDate = new Date('2030-06-15T14:30:00')
    await wrapper.findComponent(VueDatePicker).vm.$emit('update:modelValue', pickedDate)

    await submitAndSettle(wrapper)

    const expectedTimestamp = BigInt(Math.floor(pickedDate.getTime() / 1000))
    expect(sendCreateListingTx).toHaveBeenCalledWith(
      store.contract,
      expect.objectContaining({ expirationTimestamp: expectedTimestamp }),
    )
  })

  it('sends an expirationTimestamp of 0 when no expiration date is picked', async () => {
    const store = connectWallet()
    uploadListingMetadata.mockResolvedValue('bafymetadatacid')
    sendCreateListingTx.mockResolvedValue({})
    waitForListingReceipt.mockResolvedValue({ listingId: 3n, transactionHash: '0xabc' })

    const wrapper = mount(CreateListingView)
    await fillValidForm(wrapper)

    await submitAndSettle(wrapper)

    expect(sendCreateListingTx).toHaveBeenCalledWith(
      store.contract,
      expect.objectContaining({ expirationTimestamp: 0n }),
    )
  })

  it('rejects a picked expiration date/time that is in the past', async () => {
    connectWallet()
    const wrapper = mount(CreateListingView)
    await fillValidForm(wrapper)

    const pastDate = new Date('2000-01-01T00:00:00')
    await wrapper.findComponent(VueDatePicker).vm.$emit('update:modelValue', pastDate)

    await submitAndSettle(wrapper)

    expect(wrapper.text()).toContain('Expiration must be in the future.')
    expect(sendCreateListingTx).not.toHaveBeenCalled()
  })

  it('shows a drag-active style while a file is dragged over the dropzone', async () => {
    const wrapper = mount(CreateListingView)
    const dropzone = wrapper.find('.dropzone')

    expect(dropzone.classes()).not.toContain('border-brand')

    await dropzone.trigger('dragover')
    expect(dropzone.classes()).toContain('border-brand')

    await dropzone.trigger('dragleave')
    expect(dropzone.classes()).not.toContain('border-brand')
  })

  it('accepts a dropped image file and shows a thumbnail preview', async () => {
    const wrapper = mount(CreateListingView)
    const dropzone = wrapper.find('.dropzone')
    const file = new File(['fake-image-bytes'], 'cat.png', { type: 'image/png' })

    await dropzone.trigger('dragover')
    await dropzone.trigger('drop', { dataTransfer: { files: [file] } })

    // The drop itself clears the drag-active style regardless of validity.
    expect(dropzone.classes()).not.toContain('border-brand')
    expect(wrapper.find('img[alt="Selected photo preview"]').exists()).toBe(true)
    expect(wrapper.find('.field-error').exists()).toBe(false)
  })

  it('rejects a dropped non-image file with the same validation as the file input', async () => {
    const wrapper = mount(CreateListingView)
    const dropzone = wrapper.find('.dropzone')
    const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' })

    await dropzone.trigger('drop', { dataTransfer: { files: [file] } })

    expect(wrapper.text()).toContain('Please select an image file.')
    expect(wrapper.find('img[alt="Selected photo preview"]').exists()).toBe(false)
  })

  it('rejects an oversized dropped file', async () => {
    const wrapper = mount(CreateListingView)
    const dropzone = wrapper.find('.dropzone')
    const file = new File(['x'], 'huge.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 })

    await dropzone.trigger('drop', { dataTransfer: { files: [file] } })

    expect(wrapper.text()).toContain('Image must be 10 MB or smaller.')
  })

  it('is exposed as a keyboard-focusable button for assistive tech', () => {
    const wrapper = mount(CreateListingView)
    const dropzone = wrapper.find('.dropzone')

    expect(dropzone.attributes('role')).toBe('button')
    expect(dropzone.attributes('tabindex')).toBe('0')
  })

  it('clicking the dropzone opens the native (hidden) file picker', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const wrapper = mount(CreateListingView)

    expect(wrapper.find('#image').classes()).toContain('hidden')

    await wrapper.find('.dropzone').trigger('click')

    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })

  it('pressing Enter or Space on the dropzone also opens the native file picker', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const wrapper = mount(CreateListingView)
    const dropzone = wrapper.find('.dropzone')

    await dropzone.trigger('keydown', { key: 'Enter' })
    await dropzone.trigger('keydown', { key: ' ' })

    expect(clickSpy).toHaveBeenCalledTimes(2)
    clickSpy.mockRestore()
  })

  it('revokes the previous preview object URL when the image changes, and again on unmount', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL')
    const wrapper = mount(CreateListingView)
    const dropzone = wrapper.find('.dropzone')

    const file1 = new File(['a'], 'a.png', { type: 'image/png' })
    const file2 = new File(['b'], 'b.png', { type: 'image/png' })

    await dropzone.trigger('drop', { dataTransfer: { files: [file1] } })
    await dropzone.trigger('drop', { dataTransfer: { files: [file2] } })
    expect(revokeSpy).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    expect(revokeSpy).toHaveBeenCalledTimes(2)

    revokeSpy.mockRestore()
  })

  it('clears the selected image and shows the empty dropzone again when the remove button is clicked', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const wrapper = mount(CreateListingView)
    const dropzone = wrapper.find('.dropzone')
    const file = new File(['fake-image-bytes'], 'cat.png', { type: 'image/png' })

    await dropzone.trigger('drop', { dataTransfer: { files: [file] } })
    expect(wrapper.find('img[alt="Selected photo preview"]').exists()).toBe(true)

    await wrapper.find('.remove-image-button').trigger('click')

    expect(wrapper.find('img[alt="Selected photo preview"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Drag a photo here, or click to browse')
    // Removing must not re-trigger the file picker (the button sits inside
    // the same clickable dropzone).
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('resets validation state on remove, same as if nothing had ever been selected', async () => {
    const wrapper = mount(CreateListingView)
    const dropzone = wrapper.find('.dropzone')
    const file = new File(['fake-image-bytes'], 'cat.png', { type: 'image/png' })

    await dropzone.trigger('drop', { dataTransfer: { files: [file] } })
    await wrapper.find('.remove-image-button').trigger('click')

    await wrapper.find('#title').setValue('Lost cat')
    await wrapper.find('#description').setValue('Lost cat, orange tabby')
    await wrapper.find('#location').setValue('Central Park')
    await wrapper.find('#reward').setValue('0.05')
    await submitAndSettle(wrapper)

    expect(wrapper.text()).toContain('Please select an image.')
    expect(sendCreateListingTx).not.toHaveBeenCalled()
  })

  it('revokes the thumbnail object URL when the image is removed', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL')
    const wrapper = mount(CreateListingView)
    const dropzone = wrapper.find('.dropzone')
    const file = new File(['fake-image-bytes'], 'cat.png', { type: 'image/png' })

    await dropzone.trigger('drop', { dataTransfer: { files: [file] } })
    await wrapper.find('.remove-image-button').trigger('click')

    expect(revokeSpy).toHaveBeenCalledTimes(1)
    revokeSpy.mockRestore()
  })

  it('does not reopen the file picker when Enter/Space is pressed on the remove button', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const wrapper = mount(CreateListingView)
    const dropzone = wrapper.find('.dropzone')
    const file = new File(['fake-image-bytes'], 'cat.png', { type: 'image/png' })

    await dropzone.trigger('drop', { dataTransfer: { files: [file] } })
    await wrapper.find('.remove-image-button').trigger('keydown', { key: 'Enter' })

    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })
})
