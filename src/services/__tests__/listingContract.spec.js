import { describe, it, expect, vi } from 'vitest'
import {
  sendCreateListingTx,
  waitForListingReceipt,
  ListingContractError,
} from '../listingContract'

function makeContract({ createListing, parseLog } = {}) {
  return {
    createListing: createListing ?? vi.fn(),
    interface: {
      parseLog: parseLog ?? vi.fn(),
    },
  }
}

describe('sendCreateListingTx', () => {
  it('throws when no contract instance is provided', async () => {
    await expect(
      sendCreateListingTx(null, { cid: 'bafy', rewardWei: 1n }),
    ).rejects.toThrow(ListingContractError)
  })

  it('calls contract.createListing with the CID, expiration, and value', async () => {
    const tx = {}
    const createListing = vi.fn().mockResolvedValue(tx)
    const contract = makeContract({ createListing })

    const result = await sendCreateListingTx(contract, {
      cid: 'bafytestcid',
      rewardWei: 500n,
      expirationTimestamp: 123n,
    })

    expect(result).toBe(tx)
    expect(createListing).toHaveBeenCalledWith('bafytestcid', 123n, { value: 500n })
  })

  it('defaults expirationTimestamp to 0n when not provided', async () => {
    const createListing = vi.fn().mockResolvedValue({})
    const contract = makeContract({ createListing })

    await sendCreateListingTx(contract, { cid: 'bafy', rewardWei: 1n })

    expect(createListing).toHaveBeenCalledWith('bafy', 0n, { value: 1n })
  })

  it('wraps a user rejection into a clear message', async () => {
    const createListing = vi.fn().mockRejectedValue({ code: 'ACTION_REJECTED' })
    const contract = makeContract({ createListing })

    await expect(
      sendCreateListingTx(contract, { cid: 'bafy', rewardWei: 1n }),
    ).rejects.toThrow('rejected in your wallet')
  })

  it('wraps other errors using the underlying message', async () => {
    const createListing = vi.fn().mockRejectedValue(new Error('insufficient funds'))
    const contract = makeContract({ createListing })

    await expect(
      sendCreateListingTx(contract, { cid: 'bafy', rewardWei: 1n }),
    ).rejects.toThrow('insufficient funds')
  })
})

describe('waitForListingReceipt', () => {
  it('extracts the listingId from the ListingCreated event', async () => {
    const parseLog = vi.fn().mockReturnValue({
      name: 'ListingCreated',
      args: { listingId: 7n },
    })
    const contract = makeContract({ parseLog })
    const tx = {
      wait: vi.fn().mockResolvedValue({
        hash: '0xabc',
        logs: [{ topics: [], data: '0x' }],
      }),
    }

    const result = await waitForListingReceipt(contract, tx)

    expect(result).toEqual({ listingId: 7n, transactionHash: '0xabc' })
  })

  it('returns a null listingId when no ListingCreated log is found', async () => {
    const parseLog = vi.fn().mockReturnValue({ name: 'SomeOtherEvent', args: {} })
    const contract = makeContract({ parseLog })
    const tx = {
      wait: vi.fn().mockResolvedValue({ hash: '0xdef', logs: [{}] }),
    }

    const result = await waitForListingReceipt(contract, tx)

    expect(result).toEqual({ listingId: null, transactionHash: '0xdef' })
  })

  it('skips logs the interface cannot parse instead of throwing', async () => {
    const parseLog = vi.fn().mockImplementation(() => {
      throw new Error('not this contract')
    })
    const contract = makeContract({ parseLog })
    const tx = {
      wait: vi.fn().mockResolvedValue({ hash: '0xdef', logs: [{}] }),
    }

    const result = await waitForListingReceipt(contract, tx)

    expect(result).toEqual({ listingId: null, transactionHash: '0xdef' })
  })

  it('wraps a failed/reverted transaction wait', async () => {
    const contract = makeContract()
    const tx = { wait: vi.fn().mockRejectedValue(new Error('reverted')) }

    await expect(waitForListingReceipt(contract, tx)).rejects.toThrow(ListingContractError)
  })
})
