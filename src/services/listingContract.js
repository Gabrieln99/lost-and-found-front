export class ListingContractError extends Error {}

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
