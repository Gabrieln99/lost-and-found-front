export const STATUS_LABELS = ['Open', 'Reported', 'Resolved', 'Cancelled']

export class ListingContractError extends Error {}

/**
 * Reads every listing from the contract via listingCount() + listings(id) --
 * the contract has no enumerable event log, just a counter and a mapping
 * getter, so this is a straightforward loop over [0, listingCount).
 * @param {import('ethers').Contract} contract
 * @returns {Promise<Array<object>>}
 */
export async function fetchAllListings(contract) {
  if (!contract) {
    throw new ListingContractError('No contract instance available. Connect your wallet first.')
  }

  let count
  try {
    count = await contract.listingCount()
  } catch (err) {
    throw new ListingContractError(describeContractError(err))
  }

  const ids = Array.from({ length: Number(count) }, (_, i) => i)
  try {
    return await Promise.all(ids.map((id) => fetchListing(contract, id)))
  } catch (err) {
    throw new ListingContractError(describeContractError(err))
  }
}

async function fetchListing(contract, id) {
  const raw = await contract.listings(id)
  return {
    id,
    owner: raw.owner,
    finder: raw.finder,
    reward: raw.reward,
    itemCID: raw.itemCID,
    status: Number(raw.status),
    createdAt: raw.createdAt,
    expirationTimestamp: raw.expirationTimestamp,
  }
}

/**
 * Sends the createListing transaction (triggers the wallet signature
 * prompt) and returns the pending transaction, without waiting for it to
 * be mined.
 * @param {import('ethers').Contract} contract - signer-backed contract instance
 * @param {{ cid: string, rewardWei: bigint, expirationTimestamp?: bigint }} params
 */
export async function sendCreateListingTx(contract, { cid, rewardWei, expirationTimestamp = 0n }) {
  if (!contract) {
    throw new ListingContractError('No contract instance available. Connect your wallet first.')
  }

  try {
    return await contract.createListing(cid, expirationTimestamp, { value: rewardWei })
  } catch (err) {
    throw new ListingContractError(describeContractError(err))
  }
}

/**
 * Waits for a createListing transaction to be mined and extracts the new
 * listingId from the ListingCreated event.
 * @param {import('ethers').Contract} contract
 * @param {import('ethers').TransactionResponse} tx
 * @returns {Promise<{ listingId: bigint|null, transactionHash: string }>}
 */
export async function waitForListingReceipt(contract, tx) {
  let receipt
  try {
    receipt = await tx.wait()
  } catch (err) {
    throw new ListingContractError(describeContractError(err))
  }

  return {
    listingId: extractListingId(contract, receipt),
    transactionHash: receipt.hash,
  }
}

function extractListingId(contract, receipt) {
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log)
      if (parsed?.name === 'ListingCreated') {
        return parsed.args.listingId
      }
    } catch {
      // Not a log this contract's interface can parse; skip it.
    }
  }
  return null
}

function describeContractError(err) {
  if (err?.code === 'ACTION_REJECTED' || err?.info?.error?.code === 4001) {
    return 'Transaction was rejected in your wallet.'
  }
  return err?.shortMessage || err?.reason || err?.message || 'Transaction failed.'
}
