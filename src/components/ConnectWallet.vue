<script setup>
import { computed } from 'vue'
import { useWalletStore } from '@/stores/wallet'

const wallet = useWalletStore()

const shortAddress = computed(() => {
  if (!wallet.address) return ''
  return `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
})
</script>

<template>
  <div class="connect-wallet">
    <button v-if="!wallet.isConnected" type="button" :disabled="wallet.isConnecting" @click="wallet.connect()">
      {{ wallet.isConnecting ? 'Connecting…' : 'Connect Wallet' }}
    </button>

    <div v-else class="connected">
      <span class="address" :title="wallet.address">{{ shortAddress }}</span>
      <button type="button" @click="wallet.disconnect()">Disconnect</button>
    </div>

    <p v-if="wallet.isConnected && !wallet.isCorrectNetwork" class="warning">
      Wrong network — please switch to Sepolia.
      <button type="button" @click="wallet.switchToSepolia()">Switch to Sepolia</button>
    </p>

    <p v-if="wallet.error" class="error">
      {{ wallet.error.message }}
      <a
        v-if="wallet.error.code === 'NO_WALLET'"
        href="https://metamask.io/download/"
        target="_blank"
        rel="noopener"
      >
        Install MetaMask
      </a>
    </p>
  </div>
</template>

<style scoped>
.connect-wallet {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
}

.connected {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.address {
  font-family: monospace;
}

.warning {
  color: #a15c00;
  font-size: 0.85rem;
}

.error {
  color: #b3261e;
  font-size: 0.85rem;
}
</style>
