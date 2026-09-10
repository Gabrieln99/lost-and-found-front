<script setup>
// Compact status message. `class` falls through so callers can keep the
// hook classes their specs query (e.g. `submit-error`, `action-error`).
const props = defineProps({
  as: { type: String, default: 'p' },
  tone: {
    type: String,
    default: 'info',
    validator: (v) => ['danger', 'success', 'warning', 'info'].includes(v),
  },
})

const TONES = {
  danger: 'bg-danger-soft text-danger',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
}
</script>

<template>
  <component :is="as" class="rounded-md px-3 py-2 text-sm" :class="TONES[props.tone]">
    <slot />
  </component>
</template>
