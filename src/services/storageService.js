import { STORAGE_SERVICE_URL } from '@/config/storage'

export class StorageServiceError extends Error {}

async function postMultipart(path, formData) {
  if (!STORAGE_SERVICE_URL) {
    throw new StorageServiceError(
      'Storage service URL is not configured (VITE_STORAGE_SERVICE_URL).',
    )
  }

  let response
  try {
    response = await fetch(`${STORAGE_SERVICE_URL}${path}`, {
      method: 'POST',
      body: formData,
    })
  } catch (err) {
    throw new StorageServiceError(`Failed to reach the storage service: ${err.message}`)
  }

  let body = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON response; body stays null and is handled below.
  }

  if (!response.ok) {
    const message = body?.error || `Storage service responded with status ${response.status}`
    throw new StorageServiceError(message)
  }

  if (!body?.cid) {
    throw new StorageServiceError('Storage service response did not include a CID.')
  }

  return body.cid
}

/**
 * Uploads a raw image file to the storage service and returns its IPFS CID.
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function uploadImage(file) {
  const formData = new FormData()
  formData.append('file', file, file.name)
  return postMultipart('/upload', formData)
}

/**
 * Uploads an image plus description/location to the storage service, which
 * bundles them into a JSON metadata document on Pinata and returns that
 * document's CID -- this is the CID that goes on-chain as createListing's
 * itemCID, not the raw image's.
 * @param {{ file: File, description: string, location: string }} params
 * @returns {Promise<string>}
 */
export async function uploadListingMetadata({ file, description, location }) {
  const formData = new FormData()
  formData.append('file', file, file.name)
  formData.append('description', description)
  formData.append('location', location)
  return postMultipart('/listing-metadata', formData)
}
