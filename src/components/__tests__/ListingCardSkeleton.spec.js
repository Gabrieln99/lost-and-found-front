import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ListingCardSkeleton from '../ListingCardSkeleton.vue'

describe('ListingCardSkeleton', () => {
  it('renders a placeholder card shape with pulsing blocks', () => {
    const wrapper = mount(ListingCardSkeleton)

    expect(wrapper.find('article.listing-card-skeleton').exists()).toBe(true)
    expect(wrapper.findAll('.skeleton.animate-pulse').length).toBeGreaterThan(0)
  })
})
