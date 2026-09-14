<script setup>
// Same tone -> class mapping as Alert.vue, so toasts and inline alerts read
// as the same visual language.
defineProps({
  tone: {
    type: String,
    default: 'info',
    validator: (v) => ['danger', 'success', 'warning', 'info'].includes(v),
  },
  message: { type: String, required: true },
})

defineEmits(['dismiss'])

const TONES = {
  danger: 'bg-danger-soft text-danger',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
}
</script>

<template>
  <div
    class="toast flex items-start gap-3 rounded-md px-3 py-2 text-sm shadow-md"
    :class="TONES[tone]"
    role="status"
  >
    <p class="flex-1">{{ message }}</p>
    <button
      type="button"
      class="dismiss-button cursor-pointer text-lg leading-none"
      aria-label="Dismiss notification"
      @click="$emit('dismiss')"
    >
      &times;
    </button>
  </div>
</template>
