import { STORAGE_SERVICE_URL } from '@/config/storage'

export class StorageServiceError extends Error {}

/**
 * Uploads an image file to the storage service and returns its IPFS CID.
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function uploadImage(file) {
  if (!STORAGE_SERVICE_URL) {
    throw new StorageServiceError(
      'Storage service URL is not configured (VITE_STORAGE_SERVICE_URL).',
    )
  }

  const formData = new FormData()
  formData.append('file', file, file.name)

  let response
  try {
    response = await fetch(`${STORAGE_SERVICE_URL}/upload`, {
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
