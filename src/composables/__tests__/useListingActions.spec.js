import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/listingContract', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    sendReportFoundTx: vi.fn(),
    sendConfirmRecoveryTx: vi.fn(),
    sendCancelListingTx: vi.fn(),
    sendRejectReportTx: vi.fn(),
    waitForActionReceipt: vi.fn(),
    fetchListing: vi.fn(),
  }
})

import { useListingActions } from '../useListingActions'
import { useWalletStore } from '@/stores/wallet'
import {
  sendReportFoundTx,
  waitForActionReceipt,
  fetchListing,
  ListingContractError,
} from '@/services/listingContract'

const OWNER = '0xOwner0000000000000000000000000000000001'
const FINDER = '0xFinder000000000000000000000000000000002'
const STRANGER = '0xStranger0000000000000000000000000000003'
const ZERO = '0x0000000000000000000000000000000000000000'

function listing(overrides = {}) {
  return {
    id: 0,
    owner: OWNER,
    finder: ZERO,
    reward: 10000000000000000n,
    itemCID: 'cid',
    status: 0,
    createdAt: 1700000000n,
    expirationTimestamp: 0n,
    ...overrides,
  }
}

// Runs a composable inside a throwaway component so effect scope / lifecycle
// hooks behave normally.
function withSetup(composableFn) {
  let result
  const app = createApp({
    setup() {
      result = composableFn()
      return () => null
    },
  })
  app.mount(document.createElement('div'))
  return [result, app]
}

function connect(overrides = {}) {
  const store = useWalletStore()
  store.address = overrides.address ?? STRANGER
  store.chainId = 11155111n
  store.contract = overrides.contract ?? { runner: {} }
  return store
}

describe('useListingActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('does not throw and stays inert when the source listing is null', () => {
    connect()
    const [api] = withSetup(() => useListingActions(() => null))

    expect(api.currentListing.value).toEqual({})
    expect(api.canReportFound.value).toBe(false)
    expect(api.canMessageThread.value).toBe(false)
    expect(api.rewardEth.value).toBe('0.0')
  })

  it('re-seeds currentListing when the source getter value changes', async () => {
    connect()
    const src = ref(listing({ id: 1, status: 0 }))
    const [api] = withSetup(() => useListingActions(() => src.value))

    expect(api.currentListing.value.id).toBe(1)
    expect(api.statusLabel.value).toBe('Open')

    src.value = listing({ id: 1, status: 1 })
    await nextTick()

    expect(api.currentListing.value.status).toBe(1)
    expect(api.statusLabel.value).toBe('Reported')
  })

  it('gates actions by role and status', () => {
    connect({ address: STRANGER })
    const [stranger] = withSetup(() => useListingActions(() => listing({ status: 0 })))
    expect(stranger.canReportFound.value).toBe(true)
    expect(stranger.canCancelListing.value).toBe(false)
    expect(stranger.canMessageThread.value).toBe(false)

    setActivePinia(createPinia())
    connect({ address: OWNER })
    const [owner] = withSetup(() =>
      useListingActions(() => listing({ status: 1, finder: FINDER })),
    )
    expect(owner.canReportFound.value).toBe(false)
    expect(owner.canConfirmRecovery.value).toBe(true)
    expect(owner.canRejectReport.value).toBe(true)
    expect(owner.canMessageThread.value).toBe(true)
  })

  it('runAction walks send -> wait -> refetch and refreshes currentListing', async () => {
    const store = connect({ address: STRANGER })
    const tx = {}
    sendReportFoundTx.mockResolvedValue(tx)
    waitForActionReceipt.mockResolvedValue(undefined)
    fetchListing.mockResolvedValue(listing({ status: 1, finder: STRANGER }))

    const [api] = withSetup(() => useListingActions(() => listing({ status: 0 })))
    await api.onReportFound()

    expect(sendReportFoundTx).toHaveBeenCalledWith(store.contract, 0)
    expect(waitForActionReceipt).toHaveBeenCalledWith(tx)
    expect(fetchListing).toHaveBeenCalledWith(store.contract, 0)
    expect(api.currentListing.value.status).toBe(1)
    expect(api.actionStatus.value).toBe('success')
    expect(api.actionSuccessMessage.value).toContain('reported this item as found')
  })

  it('surfaces a ListingContractError and stays usable', async () => {
    connect({ address: STRANGER })
    sendReportFoundTx.mockRejectedValue(new ListingContractError('Rejected in wallet.'))

    const [api] = withSetup(() => useListingActions(() => listing({ status: 0 })))
    await api.onReportFound()

    expect(api.actionStatus.value).toBe('error')
    expect(api.actionError.value).toBe('Rejected in wallet.')
    expect(api.isActing.value).toBe(false)
  })

  it('cancelAction abandons the in-flight request without an error', async () => {
    connect({ address: STRANGER })
    sendReportFoundTx.mockReturnValue(new Promise(() => {})) // hangs forever

    const [api] = withSetup(() => useListingActions(() => listing({ status: 0 })))
    const pending = api.onReportFound()
    await nextTick()
    expect(api.actionStatus.value).toBe('awaiting-signature')

    api.cancelAction()
    await pending

    expect(api.actionStatus.value).toBe('idle')
    expect(api.actionError.value).toBe('')
  })
})
