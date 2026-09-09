export const STATUS_LABELS = ['Open', 'Reported', 'Resolved', 'Cancelled']

export class ListingContractError extends Error {}

// Some wallets don't reliably emit an EIP-1193 rejection when their
// confirmation popup is dismissed without an explicit Approve/Reject click
// (e.g. closed via the popup window's own close control). Without a cap,
// awaiting that request hangs forever, and the UI awaiting it (a "waiting
// for you to confirm in your wallet" button state) gets stuck indefinitely
// instead of resetting. This only guards the signature-request step --
// waiting for on-chain confirmation afterwards can legitimately take
// minutes and is intentionally not subject to this timeout.
export const WALLET_RESPONSE_TIMEOUT_MS = 120_000

function withWalletResponseTimeout(promise) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new ListingContractError(
          'No response from your wallet. The request may have been dismissed -- please try again.',
        ),
      )
    }, WALLET_RESPONSE_TIMEOUT_MS)
  })

  // If the timeout wins the race, the original request is abandoned but
  // may still settle later -- swallow a late rejection so it doesn't
  // surface as an unhandled promise rejection.
  promise.catch(() => {})

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

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
    return await Promise.all(ids.map(async (id) => normalizeListing(id, await contract.listings(id))))
  } catch (err) {
    throw new ListingContractError(describeContractError(err))
  }
}

/**
 * Reads a single listing's current on-chain state. Used to refresh one
 * card after a state-changing action (e.g. reportFound) instead of
 * re-fetching the whole list.
 * @param {import('ethers').Contract} contract
 * @param {number} id
 * @returns {Promise<object>}
 */
export async function fetchListing(contract, id) {
  if (!contract) {
    throw new ListingContractError('No contract instance available. Connect your wallet first.')
  }

  try {
    const raw = await contract.listings(id)
    return normalizeListing(id, raw)
  } catch (err) {
    throw new ListingContractError(describeContractError(err))
  }
}

function normalizeListing(id, raw) {
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
    return await withWalletResponseTimeout(
      contract.createListing(cid, expirationTimestamp, { value: rewardWei }),
    )
  } catch (err) {
    if (err instanceof ListingContractError) throw err
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
  const receipt = await waitForTx(tx)

  return {
    listingId: extractListingId(contract, receipt),
    transactionHash: receipt.hash,
  }
}

/**
 * Sends a listing-action transaction (reportFound, confirmRecovery,
 * cancelListing, rejectReport -- anything that just takes a listingId and
 * triggers a wallet signature prompt) and returns the pending transaction,
 * without waiting for it to be mined.
 * @param {import('ethers').Contract} contract - signer-backed contract instance
 * @param {string} method - the contract method name to call
 * @param {number} listingId
 */
async function sendListingActionTx(contract, method, listingId) {
  if (!contract) {
    throw new ListingContractError('No contract instance available. Connect your wallet first.')
  }

  try {
    return await withWalletResponseTimeout(contract[method](listingId))
  } catch (err) {
    if (err instanceof ListingContractError) throw err
    throw new ListingContractError(describeContractError(err))
  }
}

/** Reports a listing as found. Rejects if listingId's status isn't Open. */
export async function sendReportFoundTx(contract, listingId) {
  return sendListingActionTx(contract, 'reportFound', listingId)
}

/**
 * Owner-only: confirms recovery, releasing the escrowed reward to the
 * finder. Rejects if listingId's status isn't Reported.
 */
export async function sendConfirmRecoveryTx(contract, listingId) {
  return sendListingActionTx(contract, 'confirmRecovery', listingId)
}

/**
 * Owner-only: cancels an unclaimed listing, refunding the escrowed reward
 * to the owner. Rejects if listingId's status isn't Open.
 */
export async function sendCancelListingTx(contract, listingId) {
  return sendListingActionTx(contract, 'cancelListing', listingId)
}

/**
 * Owner-only: rejects a false/malicious found report, returning the
 * listing to Open. Rejects if listingId's status isn't Reported.
 */
export async function sendRejectReportTx(contract, listingId) {
  return sendListingActionTx(contract, 'rejectReport', listingId)
}

/**
 * Waits for a listing-action transaction (reportFound, confirmRecovery,
 * cancelListing, rejectReport) to be mined. Unlike waitForListingReceipt,
 * no data needs to be extracted from the receipt -- callers should
 * re-fetch the listing (see fetchListing) to pick up its new status.
 * @param {import('ethers').TransactionResponse} tx
 */
export async function waitForActionReceipt(tx) {
  await waitForTx(tx)
}

async function waitForTx(tx) {
  try {
    return await tx.wait()
  } catch (err) {
    throw new ListingContractError(describeContractError(err))
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
