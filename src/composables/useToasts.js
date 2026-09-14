import { ref } from 'vue'

// Module-scope (not per-component) so every caller shares the same queue --
// a toast is a single flat, app-wide list, not per-component state.
const toasts = ref([])
let nextId = 1

export function useToasts() {
  function pushToast({ tone = 'info', message, duration = 4000 } = {}) {
    const id = nextId++
    toasts.value.push({ id, tone, message })
    if (duration > 0) {
      setTimeout(() => dismissToast(id), duration)
    }
    return id
  }

  function dismissToast(id) {
    const index = toasts.value.findIndex((toast) => toast.id === id)
    if (index !== -1) {
      toasts.value.splice(index, 1)
    }
  }

  return { toasts, pushToast, dismissToast }
}
