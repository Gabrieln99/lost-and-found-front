/**
 * Pure helpers for Browse Listings' status filter, text search, and
 * pagination. Kept separate from BrowseListingsView so the filtering
 * logic itself is trivially unit-testable without mounting a component.
 */

/**
 * @param {Array<object>} listings
 * @param {number|'all'} status - a Status enum value (0-3), or 'all'
 * @returns {Array<object>}
 */
export function filterByStatus(listings, status) {
  if (status === 'all' || status === null || status === undefined) {
    return listings
  }
  return listings.filter((listing) => listing.status === status)
}

/**
 * Text search across each listing's title/description/location. Metadata
 * is looked up by listing id rather than expected to be embedded in the
 * listing object itself, so callers can filter/paginate the original
 * listing objects (preserving their identity, e.g. for :key stability)
 * while metadata streams in independently and asynchronously.
 * @param {Array<object>} listings
 * @param {string} query
 * @param {Record<number, {title?: string, description?: string, location?: string}|null>} metadataById
 * @returns {Array<object>}
 */
export function searchListings(listings, query, metadataById = {}) {
  const needle = (query ?? '').trim().toLowerCase()
  if (!needle) return listings

  return listings.filter((listing) => {
    const metadata = metadataById[listing.id]
    if (!metadata) return false
    return [metadata.title, metadata.description, metadata.location].some(
      (field) => typeof field === 'string' && field.toLowerCase().includes(needle),
    )
  })
}

/**
 * @param {Array<object>} items
 * @param {number} page - 1-indexed
 * @param {number} pageSize
 * @returns {Array<object>}
 */
export function paginate(items, page, pageSize) {
  if (pageSize <= 0) return items
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}

/**
 * @param {number} itemCount
 * @param {number} pageSize
 * @returns {number} always at least 1, so callers can safely display
 *   "page 1 of N" even when there are zero items.
 */
export function totalPages(itemCount, pageSize) {
  if (pageSize <= 0) return 1
  return Math.max(1, Math.ceil(itemCount / pageSize))
}

/**
 * Clamps a (possibly stale, e.g. after a filter narrows the results) page
 * number into [1, totalPages].
 * @param {number} page
 * @param {number} pages
 * @returns {number}
 */
export function clampPage(page, pages) {
  return Math.min(Math.max(1, page), Math.max(1, pages))
}
