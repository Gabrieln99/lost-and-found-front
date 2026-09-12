import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const { providerState, FakeBrowserProvider, FakeContract } = vi.hoisted(() => {
  const providerState = {
    chainId: 11155111n,
    address: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01',
    sendError: null,
    sendCallCount: 0,
  }

  class FakeSigner {
    async getAddress() {
      return providerState.address
    }
  }

  class FakeBrowserProvider {
    constructor(injected) {
      this.injected = injected
    }

    async send(method) {
      providerState.sendCallCount += 1
      if (providerState.sendError) {
        const err = providerState.sendError
        providerState.sendError = null
        throw err
      }
      return method === 'eth_requestAccounts' ? [providerState.address] : null
    }

    async getNetwork() {
      return { chainId: providerState.chainId }
    }

    async getSigner() {
      return new FakeSigner()
    }
  }

  class FakeContract {
    constructor(address, abi, signerOrProvider) {
      this.address = address
      this.abi = abi
      this.signerOrProvider = signerOrProvider
    }
  }

  return { providerState, FakeBrowserProvider, FakeContract }
})

vi.mock('ethers', () => ({
  BrowserProvider: FakeBrowserProvider,
  Contract: FakeContract,
}))

import { useWalletStore } from '../wallet'

function installEthereumMock(overrides = {}) {
  const listeners = {}
  const ethereum = {
    request: vi.fn(async ({ method }) => {
      if (method === 'eth_accounts') return overrides.eagerAccounts ?? []
      if (method === 'wallet_switchEthereumChain') {
        if (overrides.switchError) throw overrides.switchError
        return null
      }
      if (method === 'wallet_addEthereumChain') {
        if (overrides.addError) throw overrides.addError
        return null
      }
      return null
    }),
    on: vi.fn((event, handler) => {
      listeners[event] = handler
    }),
    removeListener: vi.fn((event) => {
      delete listeners[event]
    }),
    _listeners: listeners,
  }
  window.ethereum = ethereum
  return ethereum
}

describe('wallet store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    providerState.chainId = 11155111n
    providerState.sendError = null
    providerState.sendCallCount = 0
    delete window.ethereum
  })

  afterEach(() => {
    delete window.ethereum
  })

  it('sets a NO_WALLET error when no injected wallet is present', async () => {
    const store = useWalletStore()
    await store.connect()
    expect(store.error?.code).toBe('NO_WALLET')
    expect(store.isConnected).toBe(false)
  })

  it('connects successfully and derives address/network state', async () => {
    installEthereumMock()
    const store = useWalletStore()
    await store.connect()
    expect(store.isConnected).toBe(true)
    expect(store.address).toBe(providerState.address)
    expect(store.isCorrectNetwork).toBe(true)
    expect(store.error).toBeNull()
  })

  it('flags the wrong network when chainId is not Sepolia', async () => {
    providerState.chainId = 1n
    installEthereumMock()
    const store = useWalletStore()
    await store.connect()
    expect(store.isConnected).toBe(true)
    expect(store.isCorrectNetwork).toBe(false)
  })

  it('sets a REJECTED error when the user rejects the connection request', async () => {
    installEthereumMock()
    providerState.sendError = { code: 4001, message: 'User rejected' }
    const store = useWalletStore()
    await store.connect()
    expect(store.error?.code).toBe('REJECTED')
    expect(store.isConnected).toBe(false)
  })

  it('sets a REJECTED error when MetaMask reports the cancelled connection as an internal -32603 error', async () => {
    installEthereumMock()
    providerState.sendError = {
      code: 'UNKNOWN_ERROR',
      error: { code: -32603, message: 'An internal error has occurred' },
      payload: { method: 'eth_requestAccounts', params: [] },
      message:
        'could not coalesce error (error={ "code": -32603, "message": "An internal error has occurred" }, payload={ "id": 2, "jsonrpc": "2.0", "method": "eth_requestAccounts", "params": [] }, code=UNKNOWN_ERROR, version=6.17.0)',
    }
    const store = useWalletStore()
    await store.connect()
    expect(store.error?.code).toBe('REJECTED')
    expect(store.error?.message).toBe('Connection request was rejected.')
    expect(store.isConnected).toBe(false)
  })

  it('sets a distinct PENDING_REQUEST error when a request is already pending (-32002)', async () => {
    installEthereumMock()
    providerState.sendError = {
      code: 'UNKNOWN_ERROR',
      error: {
        code: -32002,
        message:
          "Request of type 'wallet_requestPermissions' already pending for origin http://localhost:5173. Please wait.",
      },
      payload: { method: 'eth_requestAccounts', params: [] },
      message:
        'could not coalesce error (error={ "code": -32002, "message": "Request of type \'wallet_requestPermissions\' already pending for origin http://localhost:5173. Please wait." }, payload={ "id": 2, "jsonrpc": "2.0", "method": "eth_requestAccounts", "params": [] }, code=UNKNOWN_ERROR, version=6.17.0)',
    }
    const store = useWalletStore()
    await store.connect()
    expect(store.error?.code).toBe('PENDING_REQUEST')
    expect(store.error?.message).toBe(
      'A connection request is already open — check MetaMask and approve or dismiss it, then try again.',
    )
    expect(store.isConnected).toBe(false)
  })

  it('ignores a second connect() call while one is already in flight', async () => {
    installEthereumMock()
    const store = useWalletStore()

    const first = store.connect()
    expect(store.isConnecting).toBe(true)
    const second = store.connect()
    await Promise.all([first, second])

    expect(providerState.sendCallCount).toBe(1)
    expect(store.isConnected).toBe(true)
    expect(store.isConnecting).toBe(false)
  })

  it('resets state on disconnect', async () => {
    installEthereumMock()
    const store = useWalletStore()
    await store.connect()
    store.disconnect()
    expect(store.isConnected).toBe(false)
    expect(store.address).toBeNull()
  })

  it('resets state when accountsChanged reports no accounts', async () => {
    const ethereum = installEthereumMock()
    const store = useWalletStore()
    await store.connect()
    expect(store.isConnected).toBe(true)

    ethereum._listeners.accountsChanged([])
    expect(store.isConnected).toBe(false)
  })

  it('requests wallet_switchEthereumChain to switch to Sepolia', async () => {
    const ethereum = installEthereumMock()
    const store = useWalletStore()
    await store.switchToSepolia()
    expect(ethereum.request).toHaveBeenCalledWith({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0xaa36a7' }],
    })
  })

  it('falls back to wallet_addEthereumChain when Sepolia is unknown to the wallet (4902)', async () => {
    const ethereum = installEthereumMock({ switchError: { code: 4902 } })
    const store = useWalletStore()
    await store.switchToSepolia()
    expect(ethereum.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'wallet_addEthereumChain' }),
    )
  })

  it('does not set an error when the user rejects the wallet_addEthereumChain prompt', async () => {
    const ethereum = installEthereumMock({
      switchError: { code: 4902 },
      addError: { code: 4001, message: 'User rejected the request.' },
    })
    const store = useWalletStore()
    await store.switchToSepolia()
    expect(ethereum.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'wallet_addEthereumChain' }),
    )
    expect(store.error).toBeNull()
  })
})
