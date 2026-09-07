import { describe, it, expect, vi } from 'vitest'
import {
  sendCreateListingTx,
  waitForListingReceipt,
  fetchAllListings,
  ListingContractError,
} from '../listingContract'

function makeContract({ createListing, parseLog, listingCount, listings } = {}) {
  return {
    createListing: createListing ?? vi.fn(),
    interface: {
      parseLog: parseLog ?? vi.fn(),
    },
    listingCount: listingCount ?? vi.fn(),
    listings: listings ?? vi.fn(),
  }
}

function rawListing(overrides = {}) {
  return {
    owner: '0xOwner0000000000000000000000000000000001',
    finder: '0x0000000000000000000000000000000000000000',
    reward: 1000000000000000n,
    itemCID: 'bafytestcid',
    status: 0,
    createdAt: 1700000000n,
    expirationTimestamp: 0n,
    ...overrides,
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

describe('fetchAllListings', () => {
  it('throws when no contract instance is provided', async () => {
    await expect(fetchAllListings(null)).rejects.toThrow(ListingContractError)
  })

  it('returns an empty array when listingCount is 0', async () => {
    const contract = makeContract({ listingCount: vi.fn().mockResolvedValue(0n) })

    const result = await fetchAllListings(contract)

    expect(result).toEqual([])
  })

  it('reads every listing from 0 to listingCount - 1', async () => {
    const listings = vi.fn().mockImplementation((id) =>
      Promise.resolve(rawListing({ itemCID: `bafy-${id}` })),
    )
    const contract = makeContract({
      listingCount: vi.fn().mockResolvedValue(3n),
      listings,
    })

    const result = await fetchAllListings(contract)

    expect(listings).toHaveBeenCalledTimes(3)
    expect(listings).toHaveBeenCalledWith(0)
    expect(listings).toHaveBeenCalledWith(1)
    expect(listings).toHaveBeenCalledWith(2)
    expect(result.map((l) => l.id)).toEqual([0, 1, 2])
    expect(result.map((l) => l.itemCID)).toEqual(['bafy-0', 'bafy-1', 'bafy-2'])
  })

  it('normalizes the status enum to a plain number', async () => {
    const contract = makeContract({
      listingCount: vi.fn().mockResolvedValue(1n),
      listings: vi.fn().mockResolvedValue(rawListing({ status: 2n })),
    })

    const [listing] = await fetchAllListings(contract)

    expect(listing.status).toBe(2)
  })

  it('wraps a failure reading listingCount', async () => {
    const contract = makeContract({
      listingCount: vi.fn().mockRejectedValue(new Error('rpc error')),
    })

    await expect(fetchAllListings(contract)).rejects.toThrow(ListingContractError)
  })

  it('wraps a failure reading an individual listing', async () => {
    const contract = makeContract({
      listingCount: vi.fn().mockResolvedValue(1n),
      listings: vi.fn().mockRejectedValue(new Error('rpc error')),
    })

    await expect(fetchAllListings(contract)).rejects.toThrow(ListingContractError)
  })
})
