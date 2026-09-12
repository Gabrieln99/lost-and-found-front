import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { BrowserProvider, Contract } from 'ethers'
import {
  CONTRACT_ABI,
  CONTRACT_ADDRESS,
  isContractConfigured,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_CHAIN_ID_HEX,
  SEPOLIA_NETWORK_PARAMS,
} from '@/config/contract'

function hasInjectedWallet() {
  return typeof window !== 'undefined' && Boolean(window.ethereum)
}

function isUserRejection(err, expectedMethod) {
  if (
    err?.code === 4001 ||
    err?.code === 'ACTION_REJECTED' ||
    err?.info?.error?.code === 4001 ||
    err?.error?.code === 4001
  ) {
    return true
  }

  // MetaMask sometimes reports a cancelled request as a generic -32603
  // "internal error" instead of the standard 4001 user-rejected code.
  // ethers' BrowserProvider.send() re-wraps that raw error at `err.error`
  // (see ethers' "could not coalesce error" path), which the checks above
  // don't cover. Only treat that ambiguous shape as a rejection for the
  // specific request it's known to affect, so a genuine internal RPC
  // failure on a different call isn't misreported as "cancelled".
  return (
    Boolean(expectedMethod) &&
    err?.error?.code === -32603 &&
    err?.payload?.method === expectedMethod
  )
}

export const useWalletStore = defineStore('wallet', () => {
  const address = ref(null)
  const chainId = ref(null)
  const contract = ref(null)
  const error = ref(null)
  const isConnecting = ref(false)

  let provider = null
  let listenersAttached = false

  const isConnected = computed(() => address.value !== null)
  const isCorrectNetwork = computed(
    () => chainId.value !== null && chainId.value === SEPOLIA_CHAIN_ID,
  )

  function resetState() {
    address.value = null
    chainId.value = null
    contract.value = null
  }

  // Re-reads the current account/network from the injected wallet and
  // rebuilds the signer-backed contract instance. Called on initial
  // connect and whenever MetaMask reports an account or network change.
  async function refreshFromProvider() {
    const network = await provider.getNetwork()
    chainId.value = network.chainId

    const signer = await provider.getSigner()
    address.value = await signer.getAddress()

    contract.value = isContractConfigured
      ? new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer)
      : null
  }

  function handleAccountsChanged(accounts) {
    if (!accounts || accounts.length === 0) {
      resetState()
      return
    }
    refreshFromProvider().catch((err) => {
      error.value = { code: 'UNKNOWN', message: err?.message || 'Failed to switch account.' }
    })
  }

  function handleChainChanged() {
    if (!provider) return
    // ethers v6 caches network detection per provider instance, so a
    // chain change needs a fresh BrowserProvider rather than reusing one.
    provider = new BrowserProvider(window.ethereum)
    refreshFromProvider().catch((err) => {
      error.value = { code: 'UNKNOWN', message: err?.message || 'Failed to switch network.' }
    })
  }

  function attachListeners() {
    if (listenersAttached || !hasInjectedWallet()) return
    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged', handleChainChanged)
    listenersAttached = true
  }

  function detachListeners() {
    if (!listenersAttached || !hasInjectedWallet()) return
    window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
    window.ethereum.removeListener('chainChanged', handleChainChanged)
    listenersAttached = false
  }

  // Silently restores a connection MetaMask already authorized for this
  // site (no popup). Safe to call on every app load.
  async function autoConnect() {
    if (!hasInjectedWallet()) return

    attachListeners()

    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' })
      if (!accounts || accounts.length === 0) return

      provider = new BrowserProvider(window.ethereum)
      await refreshFromProvider()
    } catch {
      // Silent by design: auto-connect never surfaces an error to the user.
    }
  }

  // User-initiated connect — triggers the MetaMask popup if not already
  // authorized.
  async function connect() {
    error.value = null

    if (!hasInjectedWallet()) {
      error.value = {
        code: 'NO_WALLET',
        message: 'No wallet detected. Install MetaMask to continue.',
      }
      return
    }

    isConnecting.value = true
    try {
      provider = new BrowserProvider(window.ethereum)
      await provider.send('eth_requestAccounts', [])
      await refreshFromProvider()
      attachListeners()
    } catch (err) {
      resetState()
      if (isUserRejection(err, 'eth_requestAccounts')) {
        error.value = { code: 'REJECTED', message: 'Connection request was rejected.' }
      } else {
        error.value = { code: 'UNKNOWN', message: err?.message || 'Failed to connect wallet.' }
      }
    } finally {
      isConnecting.value = false
    }
  }

  function disconnect() {
    // MetaMask has no programmatic disconnect; this only clears local
    // state so the app stops treating the wallet as connected.
    resetState()
    detachListeners()
  }

  async function switchToSepolia() {
    if (!hasInjectedWallet()) return

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
      })
    } catch (switchError) {
      if (switchError?.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [SEPOLIA_NETWORK_PARAMS],
          })
        } catch (addError) {
          if (!isUserRejection(addError)) {
            error.value = {
              code: 'UNKNOWN',
              message: addError?.message || 'Failed to add Sepolia network.',
            }
          }
        }
      } else if (!isUserRejection(switchError)) {
        error.value = {
          code: 'UNKNOWN',
          message: switchError?.message || 'Failed to switch network.',
        }
      }
    }
  }

  return {
    address,
    chainId,
    contract,
    error,
    isConnecting,
    isConnected,
    isCorrectNetwork,
    autoConnect,
    connect,
    disconnect,
    switchToSepolia,
  }
})
