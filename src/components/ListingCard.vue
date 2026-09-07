<script setup>
import { ref, computed, onMounted } from 'vue'
import { formatEther } from 'ethers'
import { STATUS_LABELS } from '@/services/listingContract'
import { fetchListingMetadata, IpfsMetadataError } from '@/services/ipfsMetadata'

const props = defineProps({
  listing: { type: Object, required: true },
})

const statusLabel = computed(() => STATUS_LABELS[props.listing.status] ?? 'Unknown')
const statusClass = computed(() => `status-${statusLabel.value.toLowerCase()}`)
const rewardEth = computed(() => formatEther(props.listing.reward))

const metadata = ref(null)
const metadataError = ref('')
const loadingMetadata = ref(true)

onMounted(async () => {
  try {
    metadata.value = await fetchListingMetadata(props.listing.itemCID)
  } catch (err) {
    metadataError.value =
      err instanceof IpfsMetadataError ? err.message : 'Failed to load listing details.'
  } finally {
    loadingMetadata.value = false
  }
})
</script>

<template>
  <article class="listing-card" :class="statusClass">
    <div class="listing-image">
      <img
        v-if="metadata?.image"
        :src="metadata.image"
        :alt="metadata.description || 'Listing photo'"
      />
      <div v-else class="image-placeholder">
        {{ loadingMetadata ? 'Loading…' : 'No image' }}
      </div>
    </div>

    <div class="listing-body">
      <span class="status-badge">{{ statusLabel }}</span>

      <p v-if="loadingMetadata" class="loading">Loading details…</p>
      <template v-else-if="metadataError">
        <p class="metadata-error">{{ metadataError }}</p>
        <p class="item-cid">CID: {{ listing.itemCID }}</p>
      </template>
      <template v-else>
        <p class="description">{{ metadata.description }}</p>
        <p class="location">{{ metadata.location }}</p>
      </template>

      <p class="reward">Reward: {{ rewardEth }} ETH</p>
    </div>
  </article>
</template>

<style scoped>
.listing-card {
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.listing-image {
  aspect-ratio: 4 / 3;
  background: var(--color-background-soft);
  display: flex;
  align-items: center;
  justify-content: center;
}

.listing-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-placeholder {
  color: var(--color-text);
  opacity: 0.6;
  font-size: 0.85rem;
}

.listing-body {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.status-badge {
  display: inline-block;
  align-self: flex-start;
  font-size: 0.75rem;
  font-weight: bold;
  padding: 0.15rem 0.5rem;
  border-radius: 1rem;
  background: var(--color-background-soft);
}

.status-open .status-badge {
  background: #dff3e0;
  color: #1e7a34;
}

.status-reported .status-badge {
  background: #fff2cc;
  color: #a15c00;
}

.status-resolved .status-badge {
  background: #dbe7ff;
  color: #1a4fa0;
}

.status-cancelled .status-badge,
.status-cancelled .description,
.status-cancelled .location {
  background: #eee;
  color: #888;
}

.listing-card.status-cancelled,
.listing-card.status-resolved {
  opacity: 0.7;
}

.metadata-error {
  color: #b3261e;
  font-size: 0.85rem;
}

.item-cid {
  font-family: monospace;
  font-size: 0.75rem;
  word-break: break-all;
  opacity: 0.7;
}

.reward {
  font-weight: bold;
}
</style>
