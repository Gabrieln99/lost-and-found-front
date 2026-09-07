import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/config/storage', () => ({
  STORAGE_SERVICE_URL: 'http://localhost:8080',
}))

import { uploadImage, uploadListingMetadata, StorageServiceError } from '../storageService'

function fakeFile() {
  return new File(['fake-image-bytes'], 'pet.png', { type: 'image/png' })
}

describe('uploadImage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('returns the CID on a successful upload', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ cid: 'bafytestcid123' }),
    })

    const cid = await uploadImage(fakeFile())

    expect(cid).toBe('bafytestcid123')
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8080/upload',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws with the server error message on a non-OK response', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Unsupported content type' }),
    })

    await expect(uploadImage(fakeFile())).rejects.toThrow(StorageServiceError)
    await expect(uploadImage(fakeFile())).rejects.toThrow('Unsupported content type')
  })

  it('throws a generic message when a non-OK response has no JSON body', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json')
      },
    })

    await expect(uploadImage(fakeFile())).rejects.toThrow('status 502')
  })

  it('throws when the network request itself fails', async () => {
    fetch.mockRejectedValue(new Error('boom'))

    await expect(uploadImage(fakeFile())).rejects.toThrow(StorageServiceError)
  })

  it('throws when the response is OK but missing a CID', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    await expect(uploadImage(fakeFile())).rejects.toThrow('did not include a CID')
  })
})

describe('uploadListingMetadata', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('posts to /listing-metadata with the file, description, and location', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ cid: 'bafymetadatacid' }),
    })

    const file = fakeFile()
    const cid = await uploadListingMetadata({
      file,
      description: 'Lost cat',
      location: 'Central Park',
    })

    expect(cid).toBe('bafymetadatacid')
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('http://localhost:8080/listing-metadata')
    expect(options.method).toBe('POST')
    const body = options.body
    // jsdom's FormData clones the File on append(name, file, filename), so
    // check identifying properties rather than reference equality.
    expect(body.get('file').name).toBe(file.name)
    expect(body.get('file').type).toBe(file.type)
    expect(body.get('description')).toBe('Lost cat')
    expect(body.get('location')).toBe('Central Park')
  })

  it('throws with the server error message on a non-OK response', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'location: must not be blank' }),
    })

    await expect(
      uploadListingMetadata({ file: fakeFile(), description: 'Lost cat', location: '' }),
    ).rejects.toThrow('must not be blank')
  })
})
