import { describe, it, expect } from 'vitest'
import { createCancelGate, ignoreLateSettlement, CancelledError } from '../cancelGate'

describe('createCancelGate', () => {
  it('rejects its promise with a CancelledError when cancel() is called', async () => {
    const gate = createCancelGate()

    gate.cancel()

    await expect(gate.promise).rejects.toThrow(CancelledError)
  })

  it('lets a pending request win the race when cancel() is never called', async () => {
    const gate = createCancelGate()
    const request = Promise.resolve('tx-response')

    const result = await Promise.race([request, gate.promise])

    expect(result).toBe('tx-response')
  })

  it('lets cancel() win the race against a request that never settles', async () => {
    const gate = createCancelGate()
    const neverSettles = new Promise(() => {})

    gate.cancel()

    await expect(Promise.race([neverSettles, gate.promise])).rejects.toThrow(CancelledError)
  })

  it('is a no-op to call cancel() more than once', async () => {
    const gate = createCancelGate()

    gate.cancel()
    expect(() => gate.cancel()).not.toThrow()

    await expect(gate.promise).rejects.toThrow(CancelledError)
  })
})

describe('ignoreLateSettlement', () => {
  it('does not throw when attached to a promise that later rejects', async () => {
    let reject
    const abandoned = new Promise((_resolve, rej) => {
      reject = rej
    })

    expect(() => ignoreLateSettlement(abandoned)).not.toThrow()

    reject(new Error('late rejection, nobody is listening'))
    // Give the rejection a chance to propagate; if ignoreLateSettlement
    // didn't attach a handler, this would surface as an unhandled
    // rejection and fail the test run.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('does not affect a promise that resolves normally', async () => {
    const promise = Promise.resolve('ok')
    ignoreLateSettlement(promise)

    await expect(promise).resolves.toBe('ok')
  })
})
