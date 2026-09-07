import { describe, it, expect } from 'vitest'
import { resolveIpfsUri } from '../ipfs'

describe('resolveIpfsUri', () => {
  it('returns null for a falsy input', () => {
    expect(resolveIpfsUri(null)).toBeNull()
    expect(resolveIpfsUri('')).toBeNull()
    expect(resolveIpfsUri(undefined)).toBeNull()
  })

  it('strips the ipfs:// prefix when present', () => {
    expect(resolveIpfsUri('ipfs://bafytestcid')).toBe(
      'https://gateway.pinata.cloud/ipfs/bafytestcid',
    )
  })

  it('treats a bare CID as already CID-only', () => {
    expect(resolveIpfsUri('bafytestcid')).toBe('https://gateway.pinata.cloud/ipfs/bafytestcid')
  })
})
