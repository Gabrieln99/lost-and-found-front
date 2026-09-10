<script setup>
// Wraps a native form control: label + slot + a small error line. The
// error <p> keeps the `field-error` class the view specs look for.
defineProps({
  label: { type: String, default: '' },
  fieldId: { type: String, default: '' },
  error: { type: String, default: '' },
})
</script>

<template>
  <div class="flex flex-col gap-1">
    <label v-if="label" :for="fieldId" class="text-sm font-medium text-heading">{{ label }}</label>
    <slot />
    <p v-if="error" class="field-error text-sm text-danger">{{ error }}</p>
  </div>
</template>
