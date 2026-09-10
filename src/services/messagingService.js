import { STORAGE_SERVICE_URL } from '@/config/storage'
import { ListingContractError, describeContractError, withWalletResponseTimeout } from './listingContract'

export class MessagingServiceError extends Error {}

// Must match storage-service/app/signing.py's MESSAGE_PREFIX /
// build_read_signable_message exactly -- see CLAUDE.md's storage-service
// section for the full format documentation. Two distinct, domain-
// separated formats so a signature for one can never be replayed as the
// other.
const MESSAGE_PREFIX = 'lost-and-found:message:v1'
const READ_MESSAGES_PREFIX = 'lost-and-found:read-messages:v1'

/**
 * The exact string a client must sign (EIP-191 personal_sign) to send a
 * chat message for a listing. Must match the backend's
 * build_signable_message byte-for-byte.
 */
export function buildSignableMessage(listingId, timestamp, body) {
  return `${MESSAGE_PREFIX}:${listingId}:${timestamp}:${body}`
}

/**
 * The exact string a client must sign to read a listing's message
 * thread. Deliberately different from buildSignableMessage's format --
 * see CLAUDE.md for why reads require a signature at all.
 */
export function buildReadSignableMessage(listingId, timestamp) {
  return `${READ_MESSAGES_PREFIX}:${listingId}:${timestamp}`
}

/**
 * Signs `text` with the wallet, guarded by the same wallet-response
 * timeout used for on-chain actions -- a signature request can hang
 * forever exactly like a transaction request can (see
 * listingContract.js's withWalletResponseTimeout).
 * @param {import('ethers').Signer} signer
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function signWithWallet(signer, text) {
  try {
    return await withWalletResponseTimeout(signer.signMessage(text))
  } catch (err) {
    if (err instanceof ListingContractError) {
      throw new MessagingServiceError(err.message)
    }
    throw new MessagingServiceError(describeContractError(err))
  }
}

/**
 * Signs a chat message body ready to POST. Split from postMessage so
 * callers (the UI) can show distinct "waiting for you to confirm" vs
 * "sending" states between the two steps.
 * @param {import('ethers').Signer} signer
 * @param {{ listingId: number, body: string }} params
 * @returns {Promise<{ timestamp: number, body: string, signature: string }>}
 */
export async function signMessageBody(signer, { listingId, body }) {
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = await signWithWallet(signer, buildSignableMessage(listingId, timestamp, body))
  return { timestamp, body, signature }
}

/**
 * Signs a fresh read-authorization for a listing's thread. Callers
 * should sign once per thread-open and reuse the result for subsequent
 * polls within the backend's freshness window, rather than re-signing on
 * every poll tick (see CLAUDE.md).
 * @param {import('ethers').Signer} signer
 * @param {number} listingId
 * @returns {Promise<{ timestamp: number, signature: string }>}
 */
export async function signReadAuthorization(signer, listingId) {
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = await signWithWallet(signer, buildReadSignableMessage(listingId, timestamp))
  return { timestamp, signature }
}

async function requestJson(path, options) {
  if (!STORAGE_SERVICE_URL) {
    throw new MessagingServiceError(
      'Storage service URL is not configured (VITE_STORAGE_SERVICE_URL).',
    )
  }

  let response
  try {
    response = await fetch(`${STORAGE_SERVICE_URL}${path}`, options)
  } catch (err) {
    throw new MessagingServiceError(`Failed to reach the storage service: ${err.message}`)
  }

  let body = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON response; body stays null and is handled below.
  }

  if (!response.ok) {
    const message = body?.error || `Storage service responded with status ${response.status}`
    throw new MessagingServiceError(message)
  }

  return body
}

/**
 * POSTs an already-signed message. Returns the stored message
 * ({ id, listingId, sender, body, timestamp }).
 * @param {number} listingId
 * @param {{ timestamp: number, body: string, signature: string }} signed
 */
export async function postMessage(listingId, { timestamp, body, signature }) {
  return requestJson(`/listings/${listingId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timestamp, body, signature }),
  })
}

/**
 * Fetches a listing's message thread using an already-signed read
 * authorization (see signReadAuthorization). Returns the messages array,
 * chronological order.
 * @param {number} listingId
 * @param {{ timestamp: number, signature: string }} readAuth
 * @returns {Promise<Array<{ id: number, listingId: number, sender: string, body: string, timestamp: number }>>}
 */
export async function fetchMessages(listingId, { timestamp, signature }) {
  const params = new URLSearchParams({ timestamp: String(timestamp), signature })
  const result = await requestJson(`/listings/${listingId}/messages?${params.toString()}`, {
    method: 'GET',
  })
  return result?.messages ?? []
}
