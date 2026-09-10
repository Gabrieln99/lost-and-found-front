<script setup>
import { onMounted } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import ConnectWallet from './components/ConnectWallet.vue'
import { useWalletStore } from '@/stores/wallet'

const wallet = useWalletStore()
onMounted(() => {
  wallet.autoConnect()
})
</script>

<template>
  <header class="sticky top-0 z-10 border-b border-border bg-surface/85 backdrop-blur">
    <div class="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
      <RouterLink
        to="/"
        class="text-base font-semibold text-heading no-underline transition-colors hover:text-brand hover:no-underline"
        title="Home — how it works"
      >
        Lost &amp; Found
      </RouterLink>

      <nav class="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <RouterLink to="/browse" class="nav-link">Browse</RouterLink>
        <RouterLink to="/create-listing" class="nav-link">Publish</RouterLink>
        <RouterLink to="/profile" class="nav-link">My Profile</RouterLink>
      </nav>

      <div class="ml-auto">
        <ConnectWallet />
      </div>
    </div>
  </header>

  <main class="mx-auto max-w-5xl px-4 py-8">
    <RouterView />
  </main>
</template>

<style scoped>
.nav-link {
  color: var(--color-muted);
  text-decoration: none;
}

.nav-link:hover {
  color: var(--color-brand);
}

.nav-link.router-link-active {
  color: var(--color-heading);
  font-weight: 600;
}
</style>
