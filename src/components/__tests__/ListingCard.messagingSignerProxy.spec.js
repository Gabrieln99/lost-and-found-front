// Regression test for a real bug found during manual two-wallet testing:
// rejecting the MetaMask signature prompt for a message (read-open or
// send) crashed with "Cannot read private member #notReady from an
// object whose class did not declare it" instead of surfacing a normal
// rejection error.
//
// Root cause: wallet.contract is a Pinia ref, so wallet.contract.runner
// returns a Vue-reactive Proxy of the real ethers Signer, not the Signer
// itself. ethers' Contract class avoids true private class fields
// specifically to stay Proxy-safe (confirmed by reading contract.ts --
// its shared state is a Symbol/WeakMap, not a #field), which is why
// Report Found/Confirm Recovery/etc. never hit this. But JsonRpcSigner
// and JsonRpcApiProvider (BrowserProvider's base class) DO use real
// `#privateFields` (e.g. #notReady, read unconditionally on the first
// line of every provider.send() call) -- calling a method through the
// reactive Proxy runs it with `this` set to the Proxy, and reading a
// private field on the wrong `this` throws exactly that TypeError. The
// fix (ListingCard.vue) is `toRaw(wallet.contract).runner` instead of
// `wallet.contract.runner`.
//
// This file deliberately does NOT mock @/services/messagingService (the
// main ListingCard.spec.js does) -- the whole point is to exercise a
// real signer object with a genuine private field through Vue's actual
// reactivity system, which a vi.fn() mock can't reproduce.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/ipfsMetadata', () => ({
  fetchListingMetadata: vi.fn().mockResolvedValue({ description: '', location: '', image: null }),
  IpfsMetadataError: class IpfsMetadataError extends Error {},
}))

vi.mock('@/config/storage', () => ({
  STORAGE_SERVICE_URL: 'http://localhost:8080',
}))

import ListingCard from '../ListingCard.vue'
import { useWalletStore } from '@/stores/wallet'

const OWNER_ADDRESS = '0xOwner0000000000000000000000000000000001'
const FINDER_ADDRESS = '0xFinder000000000000000000000000000000002'

function baseListing(overrides = {}) {
  return {
    id: 0,
    owner: OWNER_ADDRESS,
    finder: FINDER_ADDRESS,
    reward: 10000000000000000n,
    itemCID: 'bafymetadatacid',
    status: 1,
    createdAt: 1700000000n,
    expirationTimestamp: 0n,
    ...overrides,
  }
}

// A minimal but faithful stand-in for ethers' JsonRpcSigner: a real class
// using a real private class field, mirroring the exact shape that broke
// (a method that unconditionally reads a #privateField, and throws a
// MetaMask-shaped rejection error when "rejected").
class FakeEthersSigner {
  #rejected = false

  reject() {
    this.#rejected = true
  }

  async signMessage(_text) {
    if (this.#rejected) {
      const err = new Error('MetaMask Tx Signature: User denied transaction signature.')
      err.code = 'ACTION_REJECTED'
      throw err
    }
    return '0xsignature'
  }
}

function connectWallet() {
  const store = useWalletStore()
  store.address = OWNER_ADDRESS
  store.chainId = 11155111n
  return store
}

describe('ListingCard - messaging signer reactivity regression', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn())
  })

  it('surfaces a normal error (not a private-field crash) when the read-authorization signature is rejected', async () => {
    const store = connectWallet()
    const signer = new FakeEthersSigner()
    signer.reject()
    store.contract = { runner: signer } // assigned to a Pinia ref -> Vue-reactive

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()

    // Before the fix, this click would throw synchronously inside Vue's
    // render/event-handling machinery rather than settling into the
    // component's own error state.
    await wrapper.find('button.messages-toggle-button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.action-error').text()).toContain('Transaction was rejected in your wallet.')
  })

  it('surfaces a normal error (not a private-field crash) when the send-message signature is rejected', async () => {
    const store = connectWallet()
    const signer = new FakeEthersSigner() // starts accepting, for the read-open step
    store.contract = { runner: signer }

    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [] }) })

    const wrapper = mount(ListingCard, { props: { listing: baseListing() } })
    await flushPromises()
    await wrapper.find('button.messages-toggle-button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.messages-panel').exists()).toBe(true)

    // Now the same underlying signer starts rejecting, for the send step.
    signer.reject()

    await wrapper.find('textarea').setValue('hello')
    await wrapper.find('form.message-compose').trigger('submit')
    await flushPromises()

    expect(wrapper.find('.action-error').text()).toContain('Transaction was rejected in your wallet.')
  })
})
