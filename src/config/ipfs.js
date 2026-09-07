// Public IPFS gateway used to read listing metadata/images back. Configurable
// since different gateways have different reliability/rate limits; defaults
// to Pinata's public gateway (matches the storage service, which pins there).
export const IPFS_GATEWAY_URL =
  import.meta.env.VITE_IPFS_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs/'

/**
 * Resolves a bare CID or an "ipfs://<cid>" URI to a fetchable gateway URL.
 * @param {string} uriOrCid
 * @returns {string|null}
 */
export function resolveIpfsUri(uriOrCid) {
  if (!uriOrCid) return null
  const cid = uriOrCid.startsWith('ipfs://') ? uriOrCid.slice('ipfs://'.length) : uriOrCid
  return `${IPFS_GATEWAY_URL.replace(/\/+$/, '')}/${cid}`
}
