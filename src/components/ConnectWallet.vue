<script setup>
import { computed } from 'vue'
import { useWalletStore } from '@/stores/wallet'
import Button from '@/components/ui/Button.vue'
import Alert from '@/components/ui/Alert.vue'

const wallet = useWalletStore()

const shortAddress = computed(() => {
  if (!wallet.address) return ''
  return `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
})
</script>

<template>
  <div class="flex flex-col items-end gap-2">
    <Button
      v-if="!wallet.isConnected"
      variant="primary"
      size="sm"
      :disabled="wallet.isConnecting"
      @click="wallet.connect()"
    >
      {{ wallet.isConnecting ? 'Connecting…' : 'Connect Wallet' }}
    </Button>

    <div v-else class="flex items-center gap-2">
      <span class="font-mono text-sm text-muted" :title="wallet.address">{{ shortAddress }}</span>
      <Button variant="ghost" size="sm" @click="wallet.disconnect()">Disconnect</Button>
    </div>

    <Alert
      v-if="wallet.isConnected && !wallet.isCorrectNetwork"
      tone="warning"
      class="flex flex-wrap items-center gap-2"
    >
      <span>Wrong network — please switch to Sepolia.</span>
      <Button variant="secondary" size="sm" @click="wallet.switchToSepolia()">Switch to Sepolia</Button>
    </Alert>

    <Alert v-if="wallet.error" tone="danger">
      {{ wallet.error.message }}
      <a
        v-if="wallet.error.code === 'NO_WALLET'"
        href="https://metamask.io/download/"
        target="_blank"
        rel="noopener"
      >
        Install MetaMask
      </a>
    </Alert>
  </div>
</template>
