<script setup>
import { useToasts } from '@/composables/useToasts'
import Toast from './Toast.vue'

const { toasts, dismissToast } = useToasts()
</script>

<template>
  <Teleport to="body">
    <div class="toast-container fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <TransitionGroup name="toast">
        <Toast
          v-for="toast in toasts"
          :key="toast.id"
          :tone="toast.tone"
          :message="toast.message"
          @dismiss="dismissToast(toast.id)"
        />
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.toast-leave-active {
  position: absolute;
}
</style>
