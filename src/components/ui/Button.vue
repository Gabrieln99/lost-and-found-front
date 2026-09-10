<script setup>
// Single native <button> root so `class` and listeners fall through and
// every spec that does `wrapper.find('button.some-hook-class')` keeps
// working. `disabled` is a declared prop (not left to fall through) so it
// can be OR-ed with `loading` without a caller's :disabled overriding it.
import Spinner from './Spinner.vue'

const props = defineProps({
  variant: {
    type: String,
    default: 'secondary',
    validator: (v) =>
      ['primary', 'secondary', 'ghost', 'success', 'warning', 'danger'].includes(v),
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md'].includes(v),
  },
  type: { type: String, default: 'button' },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

const VARIANTS = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  secondary: 'border border-border bg-surface text-body hover:bg-surface-soft',
  ghost: 'text-body hover:bg-surface-soft',
  success: 'bg-success text-white hover:opacity-90',
  warning: 'border border-warning bg-surface text-warning hover:bg-warning-soft',
  danger: 'bg-danger text-white hover:opacity-90',
}

const SIZES = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
}
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    class="inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
    :class="[VARIANTS[props.variant], SIZES[props.size]]"
  ><Spinner v-if="loading" /><slot /></button>
</template>
