import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useToasts } from '../useToasts'

describe('useToasts', () => {
  beforeEach(() => {
    useToasts().toasts.value.splice(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pushes a toast onto the shared queue', () => {
    const { toasts, pushToast } = useToasts()
    pushToast({ tone: 'success', message: 'Listing published!', duration: 0 })

    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0]).toMatchObject({ tone: 'success', message: 'Listing published!' })
  })

  it('defaults to the info tone when none is given', () => {
    const { toasts, pushToast } = useToasts()
    pushToast({ message: 'No tone specified', duration: 0 })

    expect(toasts.value[0].tone).toBe('info')
  })

  it('auto-removes a toast after its duration elapses', () => {
    vi.useFakeTimers()
    const { toasts, pushToast } = useToasts()
    pushToast({ message: 'Auto-dismiss me' })

    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(3999)
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(toasts.value).toHaveLength(0)
  })

  it('respects a custom duration', () => {
    vi.useFakeTimers()
    const { toasts, pushToast } = useToasts()
    pushToast({ message: 'Quick', duration: 1000 })

    vi.advanceTimersByTime(1000)
    expect(toasts.value).toHaveLength(0)
  })

  it('never auto-dismisses when duration is 0', () => {
    vi.useFakeTimers()
    const { toasts, pushToast } = useToasts()
    pushToast({ message: 'Sticky', duration: 0 })

    vi.advanceTimersByTime(60_000)
    expect(toasts.value).toHaveLength(1)
  })

  it('dismissToast removes only the targeted toast, leaving others stacked', () => {
    const { toasts, pushToast, dismissToast } = useToasts()
    const firstId = pushToast({ message: 'One', duration: 0 })
    const secondId = pushToast({ message: 'Two', duration: 0 })

    dismissToast(firstId)

    expect(toasts.value.map((t) => t.id)).toEqual([secondId])
  })

  it('is a no-op to dismiss an id that is no longer queued', () => {
    const { toasts, pushToast, dismissToast } = useToasts()
    const id = pushToast({ message: 'Once', duration: 0 })
    dismissToast(id)

    expect(() => dismissToast(id)).not.toThrow()
    expect(toasts.value).toHaveLength(0)
  })

  it('stacks multiple simultaneous toasts independently', () => {
    const { toasts, pushToast } = useToasts()
    pushToast({ tone: 'success', message: 'A', duration: 0 })
    pushToast({ tone: 'danger', message: 'B', duration: 0 })
    pushToast({ tone: 'warning', message: 'C', duration: 0 })

    expect(toasts.value).toHaveLength(3)
    expect(toasts.value.map((t) => t.tone)).toEqual(['success', 'danger', 'warning'])
  })
})
