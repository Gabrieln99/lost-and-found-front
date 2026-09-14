import { describe, it, expect } from 'vitest'
import router from '@/router'

describe('router', () => {
  it('registers the listing-detail route at /listing/:id', () => {
    expect(router.resolve('/listing/5').name).toBe('listing-detail')
    expect(router.resolve({ name: 'listing-detail', params: { id: 5 } }).href).toBe('/listing/5')
  })

  it('keeps the existing routes', () => {
    expect(router.resolve('/').name).toBe('home')
    expect(router.resolve('/browse').name).toBe('browse-listings')
    expect(router.resolve('/create-listing').name).toBe('create-listing')
    expect(router.resolve('/profile').name).toBe('profile')
  })

  it('sets document.title per route via meta.title', async () => {
    await router.push('/browse')
    expect(document.title).toBe('Lost & Found - Browse')

    await router.push('/create-listing')
    expect(document.title).toBe('Lost & Found - Publish')

    await router.push('/profile')
    expect(document.title).toBe('Lost & Found - My Profile')

    await router.push('/listing/5')
    expect(document.title).toBe('Lost & Found - Listing')

    await router.push('/')
    expect(document.title).toBe('Lost & Found')
  })
})
