<script setup>
import { RouterLink } from 'vue-router'
import Button from '@/components/ui/Button.vue'

const steps = [
  {
    title: 'Publish & lock the reward',
    body: 'Post what you lost and lock the ETH reward in the smart contract. It stays in escrow — no platform fee, no middleman.',
  },
  {
    title: 'Someone reports a find',
    body: 'A finder browses open listings and flags the one that matches what they found.',
  },
  {
    title: 'Coordinate the handover',
    body: 'Owner and finder message each other through the listing to arrange a place and time.',
  },
  {
    title: 'Confirm & release',
    body: 'The owner confirms recovery and the contract releases the reward to the finder automatically.',
  },
]
</script>

<template>
  <div class="flex flex-col gap-16">
    <section class="flex flex-col gap-5 pt-6">
      <h1 class="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
        Get your lost things back, with the reward held in escrow.
      </h1>
      <p class="max-w-xl text-base text-muted">
        A decentralised lost &amp; found board. The owner locks a reward in a smart contract; it is
        only released once the finder's recovery is confirmed on-chain.
      </p>
      <div class="flex flex-wrap gap-3">
        <RouterLink v-slot="{ navigate }" to="/browse" custom>
          <Button variant="primary" @click="navigate">Browse listings</Button>
        </RouterLink>
        <RouterLink v-slot="{ navigate }" to="/create-listing" custom>
          <Button variant="secondary" @click="navigate">Publish a listing</Button>
        </RouterLink>
      </div>
    </section>

    <section class="flex flex-col gap-6">
      <h2 class="text-xl font-semibold">How it works</h2>
      <ol class="grid gap-4 sm:grid-cols-2">
        <li
          v-for="(step, index) in steps"
          :key="step.title"
          class="rounded-lg border border-border bg-surface p-5"
        >
          <div class="flex items-baseline gap-2">
            <span class="font-mono text-sm text-muted">{{ index + 1 }}</span>
            <h3 class="font-semibold">{{ step.title }}</h3>
          </div>
          <p class="mt-2 text-sm text-muted">{{ step.body }}</p>
        </li>
      </ol>
    </section>
  </div>
</template>
