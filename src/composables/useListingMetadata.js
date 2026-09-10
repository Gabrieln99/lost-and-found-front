import { ref, watch } from 'vue'
import { fetchListingMetadata, IpfsMetadataError } from '@/services/ipfsMetadata'

/**
 * Loads a listing's IPFS metadata (`{ title, description, location, image }`).
 * Refetches whenever the CID getter's value changes; a request token drops
 * responses that arrive after a newer request started.
 *
 * @param {() => string} cidGetter - returns the listing's `itemCID` (or '' before it's known)
 * @returns {{
 *   metadata: import('vue').Ref,
 *   metadataError: import('vue').Ref<string>,
 *   loadingMetadata: import('vue').Ref<boolean>,
 * }}
 */
export function useListingMetadata(cidGetter) {
  const metadata = ref(null)
  const metadataError = ref('')
  const loadingMetadata = ref(true)

  let requestToken = 0

  async function load(cid) {
    const token = ++requestToken
    metadataError.value = ''
    loadingMetadata.value = true
    try {
      const result = await fetchListingMetadata(cid)
      if (token !== requestToken) return
      metadata.value = result
    } catch (err) {
      if (token !== requestToken) return
      metadataError.value =
        err instanceof IpfsMetadataError ? err.message : 'Failed to load listing details.'
    } finally {
      if (token === requestToken) loadingMetadata.value = false
    }
  }

  watch(
    cidGetter,
    (cid) => {
      if (cid) load(cid)
    },
    { immediate: true },
  )

  return { metadata, metadataError, loadingMetadata }
}
