<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import Button from '@/components/ui/Button.vue'
import publishLockIcon from '@/assets/icons/01-publish-lock.svg'
import reportFindIcon from '@/assets/icons/02-report-find.svg'
import coordinateIcon from '@/assets/icons/03-coordinate.svg'
import confirmReleaseIcon from '@/assets/icons/04-confirm-release.svg'

const AUTO_ROTATE_INTERVAL_MS = 4000

const steps = [
  {
    title: 'Publish & lock the reward',
    body: 'Post what you lost and lock the ETH reward in the smart contract. It stays in escrow — no platform fee, no middleman.',
    icon: publishLockIcon,
  },
  {
    title: 'Someone reports a find',
    body: 'A finder browses open listings and flags the one that matches what they found.',
    icon: reportFindIcon,
  },
  {
    title: 'Coordinate the handover',
    body: 'Owner and finder message each other through the listing to arrange a place and time.',
    icon: coordinateIcon,
  },
  {
    title: 'Confirm & release',
    body: 'The owner confirms recovery and the contract releases the reward to the finder automatically.',
    icon: confirmReleaseIcon,
  },
]

const activeIndex = ref(0)
let intervalId = null

function startAutoRotate() {
  stopAutoRotate()
  intervalId = setInterval(() => {
    activeIndex.value = (activeIndex.value + 1) % steps.length
  }, AUTO_ROTATE_INTERVAL_MS)
}

function stopAutoRotate() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

// Jumping to a step manually resets the timer so it doesn't auto-advance
// again right away -- rotation resumes from here after a fresh interval.
function goToStep(index) {
  activeIndex.value = index
  startAutoRotate()
}

function goToPrevStep() {
  goToStep((activeIndex.value - 1 + steps.length) % steps.length)
}

function goToNextStep() {
  goToStep((activeIndex.value + 1) % steps.length)
}

onMounted(startAutoRotate)
onUnmounted(stopAutoRotate)
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

      <div
        class="how-it-works-carousel relative rounded-lg border border-border bg-surface p-10"
        @mouseenter="stopAutoRotate"
        @mouseleave="startAutoRotate"
      >
        <button
          type="button"
          class="carousel-prev-button absolute top-1/2 left-3 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-lg leading-none shadow hover:bg-surface-soft"
          aria-label="Previous step"
          @click="goToPrevStep"
        >
          &lsaquo;
        </button>

        <Transition name="step-fade" mode="out-in">
          <div :key="activeIndex" class="flex items-start gap-6 px-10">
            <img
              :src="steps[activeIndex].icon"
              :alt="steps[activeIndex].title"
              class="size-32 shrink-0 object-contain"
            />
            <div class="flex flex-col">
              <div class="flex items-baseline gap-3">
                <span class="font-mono text-base text-muted">{{ activeIndex + 1 }}</span>
                <h3 class="text-xl font-semibold">{{ steps[activeIndex].title }}</h3>
              </div>
              <p class="mt-3 text-base text-muted">{{ steps[activeIndex].body }}</p>
            </div>
          </div>
        </Transition>

        <button
          type="button"
          class="carousel-next-button absolute top-1/2 right-3 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-lg leading-none shadow hover:bg-surface-soft"
          aria-label="Next step"
          @click="goToNextStep"
        >
          &rsaquo;
        </button>
      </div>

      <div class="flex justify-center gap-2" role="tablist" aria-label="How it works steps">
        <button
          v-for="(step, index) in steps"
          :key="step.title"
          type="button"
          role="tab"
          class="step-dot h-2.5 w-2.5 cursor-pointer rounded-full transition-colors"
          :class="index === activeIndex ? 'bg-brand' : 'bg-surface-muted'"
          :aria-selected="index === activeIndex"
          :aria-label="`Go to step ${index + 1}: ${step.title}`"
          @click="goToStep(index)"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.step-fade-enter-active,
.step-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.step-fade-enter-from,
.step-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
