<script setup>
// Minimal surface primitive. No padding baked in so callers control
// spacing; `class` falls through and merges.
defineProps({
  as: { type: String, default: 'div' },
})
</script>

<template>
  <component :is="as" class="rounded-lg border border-border bg-surface">
    <slot />
  </component>
</template>
