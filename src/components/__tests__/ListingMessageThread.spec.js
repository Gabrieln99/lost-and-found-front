import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

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

import ListingMessageThread from '../ListingMessageThread.vue'
import { useWalletStore } from '@/stores/wallet'
import {
  signMessageBody,
  signReadAuthorization,
  postMessage,
  fetchMessages,
  MessagingServiceError,
} from '@/services/messagingService'

const OWNER = '0xOwner0000000000000000000000000000000001'
const FINDER = '0xFinder000000000000000000000000000000002'

const LISTING = { id: 0, owner: OWNER, finder: FINDER, status: 1 }

const STORED_MESSAGE = {
  id: 1,
  listingId: 0,
  sender: OWNER,
  body: 'Meet at the fountain at noon',
  timestamp: 1700000000,
}

function connectWallet(address = OWNER) {
  const store = useWalletStore()
  store.address = address
  store.chainId = 11155111n
  store.contract = { runner: { signMessage: vi.fn() } }
  return store
}

function mountThread(props = {}) {
  return mount(ListingMessageThread, {
    props: { listing: LISTING, collapsible: true, ...props },
  })
}

describe('ListingMessageThread', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    connectWallet()
  })

  describe('collapsible (card usage)', () => {
    it('shows the toggle and keeps the panel closed until clicked', () => {
      const wrapper = mountThread()
      expect(wrapper.find('button.messages-toggle-button').exists()).toBe(true)
      expect(wrapper.find('.messages-panel').exists()).toBe(false)
    })

    it('signs a read authorization once and displays the returned messages', async () => {
      const store = connectWallet(OWNER)
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValue([STORED_MESSAGE])

      const wrapper = mountThread()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      expect(signReadAuthorization).toHaveBeenCalledTimes(1)
      expect(signReadAuthorization).toHaveBeenCalledWith(store.contract.runner, 0)
      expect(fetchMessages).toHaveBeenCalledWith(0, { timestamp: 1700000000, signature: '0xreadsig' })
      expect(wrapper.text()).toContain('Meet at the fountain at noon')
      expect(wrapper.text()).toContain('(you)')
    })

    it('shows an empty-thread message when there are none', async () => {
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValue([])

      const wrapper = mountThread()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('No messages yet.')
    })

    it('shows an error and a Resume button when signing fails', async () => {
      signReadAuthorization.mockRejectedValue(
        new MessagingServiceError('Transaction was rejected in your wallet.'),
      )

      const wrapper = mountThread()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      expect(wrapper.find('.action-error').text()).toContain('Transaction was rejected in your wallet.')
      expect(wrapper.find('button.messages-retry-button').text()).toBe('Resume')
    })

    it('lets the user cancel the awaiting-signature state, closing the panel', async () => {
      signReadAuthorization.mockReturnValue(new Promise(() => {})) // hangs forever

      const wrapper = mountThread()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      const cancelButton = wrapper.find('.messages-panel button.action-cancel-button')
      expect(cancelButton.exists()).toBe(true)
      await cancelButton.trigger('click')
      for (let i = 0; i < 5; i++) {
        await flushPromises()
        await new Promise((r) => setTimeout(r, 0))
      }

      expect(wrapper.find('.messages-panel').exists()).toBe(false)
      expect(wrapper.find('.action-error').exists()).toBe(false)
    })

    it('hides the panel and stops polling on the second toggle click', async () => {
      vi.useFakeTimers()
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValue([STORED_MESSAGE])

      const wrapper = mountThread()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      await wrapper.find('button.messages-toggle-button').trigger('click') // Hide
      fetchMessages.mockClear()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(fetchMessages).not.toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('polling', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('polls with the same signed credential, without re-signing', async () => {
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValue([STORED_MESSAGE])

      const wrapper = mountThread()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      expect(signReadAuthorization).toHaveBeenCalledTimes(1)
      expect(fetchMessages).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)

      expect(signReadAuthorization).toHaveBeenCalledTimes(1)
      expect(fetchMessages).toHaveBeenCalledTimes(3)
    })

    it('stops polling and requires a Resume once the credential goes stale', async () => {
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValueOnce([STORED_MESSAGE])
      fetchMessages.mockRejectedValueOnce(new MessagingServiceError('Timestamp is too far from the server clock.'))

      const wrapper = mountThread()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()

      await vi.advanceTimersByTimeAsync(15_000)

      expect(wrapper.text()).toContain('Timestamp is too far from the server clock.')
      const resume = wrapper.find('button.messages-retry-button')
      expect(resume.text()).toBe('Resume')

      fetchMessages.mockClear().mockResolvedValue([STORED_MESSAGE])
      await resume.trigger('click')
      await flushPromises()
      expect(signReadAuthorization).toHaveBeenCalledTimes(2)
    })
  })

  describe('sending', () => {
    beforeEach(async () => {
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValue([])
    })

    async function openThread() {
      const wrapper = mountThread()
      await wrapper.find('button.messages-toggle-button').trigger('click')
      await flushPromises()
      return wrapper
    }

    it('walks signature/sending states and appends the new message', async () => {
      const store = connectWallet(OWNER)
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValue([])
      signMessageBody.mockResolvedValue({ timestamp: 1700000100, body: 'On my way', signature: '0xsendsig' })
      postMessage.mockResolvedValue({ id: 2, listingId: 0, sender: OWNER, body: 'On my way', timestamp: 1700000100 })

      const wrapper = await openThread()
      await wrapper.find('textarea').setValue('On my way')
      await wrapper.find('form.message-compose').trigger('submit')
      await flushPromises()

      expect(signMessageBody).toHaveBeenCalledWith(store.contract.runner, { listingId: 0, body: 'On my way' })
      expect(postMessage).toHaveBeenCalledWith(0, { timestamp: 1700000100, body: 'On my way', signature: '0xsendsig' })
      expect(wrapper.text()).toContain('On my way')
      expect(wrapper.find('textarea').element.value).toBe('')
    })

    it('does not submit a blank message', async () => {
      const wrapper = await openThread()
      await wrapper.find('textarea').setValue('   ')
      await wrapper.find('form.message-compose').trigger('submit')
      await flushPromises()
      expect(signMessageBody).not.toHaveBeenCalled()
    })

    it('shows an error and keeps the compose form usable when sending fails', async () => {
      signMessageBody.mockRejectedValue(new MessagingServiceError('Transaction was rejected in your wallet.'))

      const wrapper = await openThread()
      await wrapper.find('textarea').setValue('hello')
      await wrapper.find('form.message-compose').trigger('submit')
      await flushPromises()

      expect(wrapper.text()).toContain('Transaction was rejected in your wallet.')
      expect(wrapper.find('button.message-send-button').attributes('disabled')).toBeUndefined()
    })

    it('lets the user cancel the awaiting-signature state while sending', async () => {
      signMessageBody.mockReturnValue(new Promise(() => {})) // hangs forever

      const wrapper = await openThread()
      await wrapper.find('textarea').setValue('hello')
      await wrapper.find('form.message-compose').trigger('submit')
      await flushPromises()

      const cancel = wrapper.find('.message-compose button.action-cancel-button')
      expect(cancel.exists()).toBe(true)
      await cancel.trigger('click')
      for (let i = 0; i < 5; i++) {
        await flushPromises()
        await new Promise((r) => setTimeout(r, 0))
      }

      expect(postMessage).not.toHaveBeenCalled()
      expect(wrapper.find('button.message-send-button').text()).toBe('Send')
      expect(wrapper.find('.action-error').exists()).toBe(false)
    })
  })

  describe('non-collapsible (detail view usage)', () => {
    it('renders no toggle, auto-loads on mount, and shows the thread', async () => {
      signReadAuthorization.mockResolvedValue({ timestamp: 1700000000, signature: '0xreadsig' })
      fetchMessages.mockResolvedValue([STORED_MESSAGE])

      const wrapper = mountThread({ collapsible: false })
      await flushPromises()

      expect(wrapper.find('button.messages-toggle-button').exists()).toBe(false)
      expect(signReadAuthorization).toHaveBeenCalledTimes(1)
      expect(wrapper.find('.messages-panel').exists()).toBe(true)
      expect(wrapper.find('form.message-compose').exists()).toBe(true)
      expect(wrapper.text()).toContain('Meet at the fountain at noon')
    })

    it('offers "Load conversation" if the initial auto-load is cancelled', async () => {
      signReadAuthorization.mockReturnValue(new Promise(() => {})) // hangs forever

      const wrapper = mountThread({ collapsible: false })
      await flushPromises()

      await wrapper.find('.messages-panel button.action-cancel-button').trigger('click')
      for (let i = 0; i < 5; i++) {
        await flushPromises()
        await new Promise((r) => setTimeout(r, 0))
      }

      const reload = wrapper.find('button.messages-retry-button')
      expect(reload.text()).toBe('Load conversation')
    })
  })
})
