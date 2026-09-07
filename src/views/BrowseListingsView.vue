<script setup>
import { ref, onMounted, watch } from 'vue'
import { useWalletStore } from '@/stores/wallet'
import { fetchAllListings, ListingContractError } from '@/services/listingContract'
import ListingCard from '@/components/ListingCard.vue'

const wallet = useWalletStore()

const listings = ref([])
const loading = ref(false)
const loadError = ref('')

async function loadListings() {
  if (!wallet.contract) return

  loading.value = true
  loadError.value = ''
  try {
    const result = await fetchAllListings(wallet.contract)
    // Newest first.
    listings.value = result.slice().reverse()
  } catch (err) {
    loadError.value = err instanceof ListingContractError ? err.message : 'Failed to load listings.'
  } finally {
    loading.value = false
  }
}

onMounted(loadListings)

watch(
  () => wallet.contract,
  (newContract, oldContract) => {
    if (newContract && newContract !== oldContract) {
      loadListings()
    }
  },
)
</script>

<template>
  <div class="browse-listings">
    <h1>Browse Listings</h1>

    <p v-if="!wallet.isConnected" class="wallet-hint">Connect your wallet to browse listings.</p>
    <p v-else-if="!wallet.isCorrectNetwork" class="wallet-hint">
      Switch to Sepolia to browse listings.
    </p>
    <p v-else-if="!wallet.contract" class="wallet-hint">
      The contract address is not configured yet.
    </p>

    <p v-if="loading">Loading listings…</p>
    <p v-else-if="loadError" class="load-error">{{ loadError }}</p>
    <p v-else-if="wallet.contract && listings.length === 0">No listings yet.</p>

    <div v-if="listings.length > 0" class="listing-grid">
      <ListingCard v-for="listing in listings" :key="listing.id" :listing="listing" />
    </div>
  </div>
</template>

<style scoped>
.browse-listings {
  max-width: 64rem;
  margin: 0 auto;
  padding: 1rem;
}

.wallet-hint {
  color: #a15c00;
}

.load-error {
  color: #b3261e;
}

.listing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}
</style>
