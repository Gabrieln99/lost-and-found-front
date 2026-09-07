import { resolveIpfsUri } from '@/config/ipfs'

export class IpfsMetadataError extends Error {}

/**
 * Fetches a listing's metadata JSON (title, description, location, image)
 * from IPFS via a public gateway, given the CID stored on-chain as itemCID.
 * @param {string} cid
 * @returns {Promise<{ title: string, description: string, location: string, image: string|null }>}
 */
export async function fetchListingMetadata(cid) {
  const url = resolveIpfsUri(cid)
  if (!url) {
    throw new IpfsMetadataError('Listing has no itemCID to resolve.')
  }

  let response
  try {
    response = await fetch(url)
  } catch (err) {
    throw new IpfsMetadataError(`Failed to reach IPFS gateway: ${err.message}`)
  }

  if (!response.ok) {
    throw new IpfsMetadataError(`IPFS gateway responded with status ${response.status}`)
  }

  let data
  try {
    data = await response.json()
  } catch {
    throw new IpfsMetadataError('Listing metadata was not valid JSON.')
  }

  return {
    // title may be absent on listings created before this field existed.
    title: data.title ?? '',
    description: data.description ?? '',
    location: data.location ?? '',
    image: resolveIpfsUri(data.image),
  }
}
