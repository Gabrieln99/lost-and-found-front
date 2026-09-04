// URL of the lost-and-found-back storage service (aiohttp). Points at
// http://localhost:8080 for local dev; must be set to the deployed Render
// URL once the storage service is deployed there.
export const STORAGE_SERVICE_URL = import.meta.env.VITE_STORAGE_SERVICE_URL || ''

export const isStorageServiceConfigured = Boolean(STORAGE_SERVICE_URL)
