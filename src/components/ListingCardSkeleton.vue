<script setup>
import Skeleton from '@/components/ui/Skeleton.vue'
</script>

<template>
  <article class="listing-card-skeleton flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
    <div class="aspect-[4/3] bg-surface-soft" />

    <div class="flex flex-1 flex-col gap-2 p-3">
      <Skeleton class="h-5 w-16 rounded-full" />
      <Skeleton class="h-5 w-3/4" />
      <Skeleton class="h-4 w-full" />
      <Skeleton class="h-4 w-5/6" />
      <Skeleton class="h-4 w-1/2" />
      <Skeleton class="mt-auto h-9 w-full" />
    </div>
  </article>
</template>
