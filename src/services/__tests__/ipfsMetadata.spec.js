import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/config/ipfs', () => ({
  resolveIpfsUri: (uriOrCid) => {
    if (!uriOrCid) return null
    const cid = uriOrCid.startsWith('ipfs://') ? uriOrCid.slice('ipfs://'.length) : uriOrCid
    return `https://gateway.pinata.cloud/ipfs/${cid}`
  },
}))

import { fetchListingMetadata, IpfsMetadataError } from '../ipfsMetadata'

describe('fetchListingMetadata', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('returns description/location/image resolved from the gateway', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        description: 'Lost cat',
        location: 'Central Park',
        image: 'ipfs://bafyimagecid',
      }),
    })

    const metadata = await fetchListingMetadata('bafymetadatacid')

    expect(fetch).toHaveBeenCalledWith('https://gateway.pinata.cloud/ipfs/bafymetadatacid')
    expect(metadata).toEqual({
      description: 'Lost cat',
      location: 'Central Park',
      image: 'https://gateway.pinata.cloud/ipfs/bafyimagecid',
    })
  })

  it('defaults missing description/location to empty strings and image to null', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })

    const metadata = await fetchListingMetadata('bafymetadatacid')

    expect(metadata).toEqual({ description: '', location: '', image: null })
  })

  it('throws when the CID is empty', async () => {
    await expect(fetchListingMetadata('')).rejects.toThrow(IpfsMetadataError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws when the gateway responds with a non-OK status', async () => {
    fetch.mockResolvedValue({ ok: false, status: 504 })

    await expect(fetchListingMetadata('bafymetadatacid')).rejects.toThrow('status 504')
  })

  it('throws when the network request itself fails', async () => {
    fetch.mockRejectedValue(new Error('boom'))

    await expect(fetchListingMetadata('bafymetadatacid')).rejects.toThrow(IpfsMetadataError)
  })

  it('throws when the response body is not valid JSON', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json')
      },
    })

    await expect(fetchListingMetadata('bafymetadatacid')).rejects.toThrow('not valid JSON')
  })
})
