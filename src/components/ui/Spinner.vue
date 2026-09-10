<script setup>
// Purely decorative: no text nodes, no <title>, aria-hidden. Button.vue
// relies on this so its `.text()` in tests stays exactly the slot content.
defineProps({
  size: { type: [String, Number], default: '1em' },
})
</script>

<template>
  <svg
    class="animate-spin"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" stroke-opacity="0.25" />
    <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
  </svg>
</template>
