import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ToastContainer from '../ToastContainer.vue'
import { useToasts } from '@/composables/useToasts'

// ToastContainer renders via <Teleport to="body">, so its content lands
// outside the mounted wrapper's own root node -- assert against
// document.body directly rather than wrapper.find()/text() to sidestep any
// ambiguity around how Vue Test Utils surfaces teleported content.
describe('ToastContainer', () => {
  beforeEach(() => {
    useToasts().toasts.value.splice(0)
  })

  it('renders one toast per queued entry, tagged with its tone class', () => {
    const { pushToast } = useToasts()
    pushToast({ tone: 'success', message: 'Saved', duration: 0 })
    pushToast({ tone: 'danger', message: 'Failed', duration: 0 })

    const wrapper = mount(ToastContainer, { attachTo: document.body })

    const toastEls = document.body.querySelectorAll('.toast')
    expect(toastEls).toHaveLength(2)
    expect(document.body.textContent).toContain('Saved')
    expect(document.body.textContent).toContain('Failed')
    expect(toastEls[0].className).toContain('bg-success-soft')
    expect(toastEls[1].className).toContain('bg-danger-soft')

    wrapper.unmount()
  })

  it('removes a toast when its dismiss button is clicked', async () => {
    const { pushToast } = useToasts()
    pushToast({ tone: 'info', message: 'Hello there', duration: 0 })

    const wrapper = mount(ToastContainer, { attachTo: document.body })
    const dismissButton = document.body.querySelector('.dismiss-button')
    dismissButton.dispatchEvent(new Event('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(document.body.querySelectorAll('.toast')).toHaveLength(0)

    wrapper.unmount()
  })

  it('renders nothing when the queue is empty', () => {
    const wrapper = mount(ToastContainer, { attachTo: document.body })

    expect(document.body.querySelectorAll('.toast')).toHaveLength(0)

    wrapper.unmount()
  })
})
