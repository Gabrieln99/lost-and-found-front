import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import HomeView from '../HomeView.vue'

const STEP_TITLES = [
  'Publish & lock the reward',
  'Someone reports a find',
  'Coordinate the handover',
  'Confirm & release',
]

describe('HomeView - How it works carousel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the first step initially, one at a time', () => {
    const wrapper = mount(HomeView)

    expect(wrapper.text()).toContain(STEP_TITLES[0])
    expect(wrapper.text()).not.toContain(STEP_TITLES[1])
  })

  it('auto-advances to the next step every ~4 seconds', async () => {
    const wrapper = mount(HomeView)

    await vi.advanceTimersByTimeAsync(4000)
    expect(wrapper.text()).toContain(STEP_TITLES[1])

    await vi.advanceTimersByTimeAsync(4000)
    expect(wrapper.text()).toContain(STEP_TITLES[2])
  })

  it('loops back to step 1 after the last step', async () => {
    const wrapper = mount(HomeView)

    await vi.advanceTimersByTimeAsync(4000 * 4)
    expect(wrapper.text()).toContain(STEP_TITLES[0])
  })

  it('clicking a dot jumps straight to that step', async () => {
    const wrapper = mount(HomeView)

    await wrapper.findAll('.step-dot')[2].trigger('click')

    expect(wrapper.text()).toContain(STEP_TITLES[2])
  })

  it('marks the active dot via aria-selected', async () => {
    const wrapper = mount(HomeView)
    const dots = wrapper.findAll('.step-dot')

    expect(dots[0].attributes('aria-selected')).toBe('true')
    expect(dots[1].attributes('aria-selected')).toBe('false')

    await dots[1].trigger('click')

    expect(dots[0].attributes('aria-selected')).toBe('false')
    expect(dots[1].attributes('aria-selected')).toBe('true')
  })

  it('resets the auto-rotate timer after a manual dot click', async () => {
    const wrapper = mount(HomeView)

    await vi.advanceTimersByTimeAsync(3000) // just short of the first auto-advance
    await wrapper.findAll('.step-dot')[1].trigger('click') // jump to step 2, reset timer

    await vi.advanceTimersByTimeAsync(3000) // would have advanced without the reset
    expect(wrapper.text()).toContain(STEP_TITLES[1])

    await vi.advanceTimersByTimeAsync(1000) // completes the fresh 4s window
    expect(wrapper.text()).toContain(STEP_TITLES[2])
  })

  it('pauses auto-rotation on hover and resumes on mouse leave', async () => {
    const wrapper = mount(HomeView)
    const carousel = wrapper.find('.how-it-works-carousel')

    await carousel.trigger('mouseenter')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(wrapper.text()).toContain(STEP_TITLES[0])

    await carousel.trigger('mouseleave')
    await vi.advanceTimersByTimeAsync(4000)
    expect(wrapper.text()).toContain(STEP_TITLES[1])
  })

  it('stops the timer on unmount without throwing', async () => {
    const wrapper = mount(HomeView)
    wrapper.unmount()

    await expect(vi.advanceTimersByTimeAsync(10_000)).resolves.not.toThrow()
  })

  it('gives the illustration alt text matching the active step', async () => {
    const wrapper = mount(HomeView)

    expect(wrapper.find('img').attributes('alt')).toBe(STEP_TITLES[0])

    await wrapper.findAll('.step-dot')[3].trigger('click')

    expect(wrapper.find('img').attributes('alt')).toBe(STEP_TITLES[3])
  })

  it('the next arrow advances one step and wraps past the last step', async () => {
    const wrapper = mount(HomeView)
    const nextButton = wrapper.find('.carousel-next-button')

    await nextButton.trigger('click')
    expect(wrapper.text()).toContain(STEP_TITLES[1])

    await nextButton.trigger('click')
    await nextButton.trigger('click')
    await nextButton.trigger('click')
    expect(wrapper.text()).toContain(STEP_TITLES[0]) // wrapped past step 4
  })

  it('the prev arrow steps backward and wraps before the first step', async () => {
    const wrapper = mount(HomeView)

    await wrapper.find('.carousel-prev-button').trigger('click')

    expect(wrapper.text()).toContain(STEP_TITLES[3]) // wrapped before step 1
  })

  it('the dot indicator updates to match after using the arrows', async () => {
    const wrapper = mount(HomeView)

    await wrapper.find('.carousel-next-button').trigger('click')

    const dots = wrapper.findAll('.step-dot')
    expect(dots[1].attributes('aria-selected')).toBe('true')
    expect(dots[0].attributes('aria-selected')).toBe('false')
  })

  it('resets the auto-rotate timer after using an arrow, same as the dots', async () => {
    const wrapper = mount(HomeView)

    await vi.advanceTimersByTimeAsync(3000) // just short of the first auto-advance
    await wrapper.find('.carousel-next-button').trigger('click') // -> step 2, reset timer

    await vi.advanceTimersByTimeAsync(3000) // would have advanced without the reset
    expect(wrapper.text()).toContain(STEP_TITLES[1])

    await vi.advanceTimersByTimeAsync(1000) // completes the fresh 4s window
    expect(wrapper.text()).toContain(STEP_TITLES[2])
  })
})
