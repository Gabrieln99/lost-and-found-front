import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/config/storage', () => ({
  STORAGE_SERVICE_URL: 'http://localhost:8080',
}))

import {
  buildSignableMessage,
  buildReadSignableMessage,
  signWithWallet,
  signMessageBody,
  signReadAuthorization,
  postMessage,
  fetchMessages,
  MessagingServiceError,
} from '../messagingService'
import { WALLET_RESPONSE_TIMEOUT_MS } from '../listingContract'

function fakeSigner(signMessage) {
  return { signMessage: signMessage ?? vi.fn() }
}

describe('buildSignableMessage', () => {
  it('matches the format the backend expects', () => {
    expect(buildSignableMessage(3, 1700000000, 'hello')).toBe(
      'lost-and-found:message:v1:3:1700000000:hello',
    )
  })
})

describe('buildReadSignableMessage', () => {
  it('matches the format the backend expects', () => {
    expect(buildReadSignableMessage(3, 1700000000)).toBe(
      'lost-and-found:read-messages:v1:3:1700000000',
    )
  })

  it('is domain-separated from the write format for the same inputs', () => {
    expect(buildReadSignableMessage(3, 1700000000)).not.toBe(
      buildSignableMessage(3, 1700000000, ''),
    )
  })
})

describe('signWithWallet', () => {
  it('returns the signature', async () => {
    const signer = fakeSigner(vi.fn().mockResolvedValue('0xsig'))

    await expect(signWithWallet(signer, 'text')).resolves.toBe('0xsig')
    expect(signer.signMessage).toHaveBeenCalledWith('text')
  })

  it('wraps a user rejection into a clear message', async () => {
    const signer = fakeSigner(vi.fn().mockRejectedValue({ code: 'ACTION_REJECTED' }))

    await expect(signWithWallet(signer, 'text')).rejects.toThrow(MessagingServiceError)
    await expect(signWithWallet(signer, 'text')).rejects.toThrow('rejected in your wallet')
  })

  it('wraps other errors using the underlying message', async () => {
    const signer = fakeSigner(vi.fn().mockRejectedValue(new Error('boom')))

    await expect(signWithWallet(signer, 'text')).rejects.toThrow('boom')
  })

  describe('wallet response timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('eventually rejects if the wallet never responds (reuses listingContract.js\'s guard)', async () => {
      const signer = fakeSigner(() => new Promise(() => {})) // never settles

      const pending = signWithWallet(signer, 'text')
      const advance = vi.advanceTimersByTimeAsync(WALLET_RESPONSE_TIMEOUT_MS)

      await expect(pending).rejects.toThrow('No response from your wallet')
      await advance
    })
  })
})

describe('signMessageBody', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2023-11-14T22:13:20.000Z')) // 1700000000
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('signs the exact documented send format and returns timestamp/body/signature', async () => {
    const signMessage = vi.fn().mockResolvedValue('0xsig')
    const signer = fakeSigner(signMessage)

    const result = await signMessageBody(signer, { listingId: 3, body: 'hello' })

    expect(signMessage).toHaveBeenCalledWith('lost-and-found:message:v1:3:1700000000:hello')
    expect(result).toEqual({ timestamp: 1700000000, body: 'hello', signature: '0xsig' })
  })
})

describe('signReadAuthorization', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2023-11-14T22:13:20.000Z')) // 1700000000
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('signs the exact documented read format and returns timestamp/signature', async () => {
    const signMessage = vi.fn().mockResolvedValue('0xreadsig')
    const signer = fakeSigner(signMessage)

    const result = await signReadAuthorization(signer, 3)

    expect(signMessage).toHaveBeenCalledWith('lost-and-found:read-messages:v1:3:1700000000')
    expect(result).toEqual({ timestamp: 1700000000, signature: '0xreadsig' })
  })
})

describe('postMessage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('POSTs the signed payload and returns the stored message', async () => {
    const stored = { id: 1, listingId: 3, sender: '0xabc', body: 'hi', timestamp: 1700000000 }
    fetch.mockResolvedValue({ ok: true, status: 201, json: async () => stored })

    const result = await postMessage(3, { timestamp: 1700000000, body: 'hi', signature: '0xsig' })

    expect(result).toEqual(stored)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('http://localhost:8080/listings/3/messages')
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(options.body)).toEqual({
      timestamp: 1700000000,
      body: 'hi',
      signature: '0xsig',
    })
  })

  it('throws with the server error message on a non-OK response', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: "Only the listing's owner or finder can access messages for it.",
      }),
    })

    await expect(
      postMessage(3, { timestamp: 1700000000, body: 'hi', signature: '0xsig' }),
    ).rejects.toThrow('owner or finder')
  })

  it('throws when the network request itself fails', async () => {
    fetch.mockRejectedValue(new Error('boom'))

    await expect(
      postMessage(3, { timestamp: 1700000000, body: 'hi', signature: '0xsig' }),
    ).rejects.toThrow(MessagingServiceError)
  })
})

describe('fetchMessages', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('GETs with timestamp/signature query params and returns the messages array', async () => {
    const stored = { id: 1, listingId: 3, sender: '0xabc', body: 'hi', timestamp: 1700000000 }
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [stored] }) })

    const result = await fetchMessages(3, { timestamp: 1700000000, signature: '0xsig' })

    expect(result).toEqual([stored])
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('http://localhost:8080/listings/3/messages?timestamp=1700000000&signature=0xsig')
    expect(options.method).toBe('GET')
  })

  it('returns an empty array when the response has no messages field', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })

    const result = await fetchMessages(3, { timestamp: 1700000000, signature: '0xsig' })

    expect(result).toEqual([])
  })

  it('throws with the server error message on a non-OK response', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Reading messages requires timestamp and signature.' }),
    })

    await expect(
      fetchMessages(3, { timestamp: 1700000000, signature: '' }),
    ).rejects.toThrow(MessagingServiceError)
  })
})
