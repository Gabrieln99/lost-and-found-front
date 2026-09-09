import { describe, it, expect } from 'vitest'
import {
  filterByStatus,
  searchListings,
  paginate,
  totalPages,
  clampPage,
} from '../listingFilters'

function listing(overrides = {}) {
  return { id: 0, status: 0, ...overrides }
}

describe('filterByStatus', () => {
  const listings = [listing({ id: 0, status: 0 }), listing({ id: 1, status: 1 }), listing({ id: 2, status: 0 })]

  it('returns everything when status is "all"', () => {
    expect(filterByStatus(listings, 'all')).toEqual(listings)
  })

  it('returns everything when status is null or undefined', () => {
    expect(filterByStatus(listings, null)).toEqual(listings)
    expect(filterByStatus(listings, undefined)).toEqual(listings)
  })

  it('returns only listings matching the given status', () => {
    const result = filterByStatus(listings, 0)
    expect(result.map((l) => l.id)).toEqual([0, 2])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterByStatus(listings, 3)).toEqual([])
  })
})

describe('searchListings', () => {
  const metadataById = {
    0: { title: 'Lost wallet', description: 'Brown leather', location: 'Central Park' },
    1: { title: 'Lost cat', description: 'Orange tabby', location: '5th Avenue' },
    2: null, // metadata not loaded yet / failed to load
  }
  const listings = [listing({ id: 0 }), listing({ id: 1 }), listing({ id: 2 })]

  it('returns everything when the query is empty or whitespace', () => {
    expect(searchListings(listings, '', metadataById)).toEqual(listings)
    expect(searchListings(listings, '   ', metadataById)).toEqual(listings)
  })

  it('matches on title, case-insensitively', () => {
    const result = searchListings(listings, 'WALLET', metadataById)
    expect(result.map((l) => l.id)).toEqual([0])
  })

  it('matches on description', () => {
    const result = searchListings(listings, 'tabby', metadataById)
    expect(result.map((l) => l.id)).toEqual([1])
  })

  it('matches on location', () => {
    const result = searchListings(listings, 'central park', metadataById)
    expect(result.map((l) => l.id)).toEqual([0])
  })

  it('matches a substring, not just whole words', () => {
    const result = searchListings(listings, 'wall', metadataById)
    expect(result.map((l) => l.id)).toEqual([0])
  })

  it('excludes listings whose metadata has not loaded (or failed to load)', () => {
    const result = searchListings(listings, 'anything', metadataById)
    expect(result.map((l) => l.id)).not.toContain(2)
  })

  it('returns an empty array when nothing matches', () => {
    expect(searchListings(listings, 'nonexistent', metadataById)).toEqual([])
  })

  it('defaults to an empty metadata map without throwing', () => {
    expect(searchListings(listings, 'wallet')).toEqual([])
  })
})

describe('paginate', () => {
  const items = [1, 2, 3, 4, 5, 6, 7]

  it('returns the requested page slice', () => {
    expect(paginate(items, 1, 3)).toEqual([1, 2, 3])
    expect(paginate(items, 2, 3)).toEqual([4, 5, 6])
    expect(paginate(items, 3, 3)).toEqual([7])
  })

  it('returns an empty array for a page past the end', () => {
    expect(paginate(items, 4, 3)).toEqual([])
  })

  it('returns everything unchanged when pageSize is not positive', () => {
    expect(paginate(items, 1, 0)).toEqual(items)
    expect(paginate(items, 1, -1)).toEqual(items)
  })
})

describe('totalPages', () => {
  it('divides item count by page size, rounding up', () => {
    expect(totalPages(7, 3)).toBe(3)
    expect(totalPages(6, 3)).toBe(2)
    expect(totalPages(1, 3)).toBe(1)
  })

  it('is always at least 1, even with zero items', () => {
    expect(totalPages(0, 3)).toBe(1)
  })

  it('returns 1 when pageSize is not positive', () => {
    expect(totalPages(10, 0)).toBe(1)
  })
})

describe('clampPage', () => {
  it('leaves an in-range page untouched', () => {
    expect(clampPage(2, 5)).toBe(2)
  })

  it('clamps a page below 1 up to 1', () => {
    expect(clampPage(0, 5)).toBe(1)
    expect(clampPage(-3, 5)).toBe(1)
  })

  it('clamps a page beyond the total down to the last page', () => {
    expect(clampPage(9, 5)).toBe(5)
  })

  it('clamps to 1 when there are zero total pages', () => {
    expect(clampPage(3, 0)).toBe(1)
  })
})
