<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useWalletStore } from '@/stores/wallet'
import { fetchAllListings, STATUS_LABELS, ListingContractError } from '@/services/listingContract'
import { fetchListingMetadata } from '@/services/ipfsMetadata'
import { filterByStatus, searchListings, paginate, totalPages, clampPage } from '@/utils/listingFilters'
import ListingCard from '@/components/ListingCard.vue'

const PAGE_SIZE = 9

const wallet = useWalletStore()

const listings = ref([])
const loading = ref(false)
const loadError = ref('')

// Keyed by listing id: metadata once loaded, null if it failed, absent if
// still pending. Populated in the background purely to power text search
// below -- ListingCard independently fetches (and displays) its own copy
// for rendering, so a listing appears immediately without waiting on this,
// and a listing whose metadata hasn't resolved (or failed) yet simply
// won't match a text search until/unless it does.
const metadataById = ref({})

const statusFilter = ref('all') // 'all' | 0 | 1 | 2 | 3
const searchQuery = ref('')
const currentPage = ref(1)

async function loadListings() {
  if (!wallet.contract) return

  loading.value = true
  loadError.value = ''
  try {
    const result = await fetchAllListings(wallet.contract)
    // Newest first.
    listings.value = result.slice().reverse()
    metadataById.value = {}
    loadMetadataForSearch(listings.value)
  } catch (err) {
    loadError.value = err instanceof ListingContractError ? err.message : 'Failed to load listings.'
  } finally {
    loading.value = false
  }
}

function loadMetadataForSearch(listingsToIndex) {
  for (const listing of listingsToIndex) {
    fetchListingMetadata(listing.itemCID)
      .then((metadata) => {
        metadataById.value[listing.id] = metadata
      })
      .catch(() => {
        metadataById.value[listing.id] = null
      })
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

// filterByStatus/searchListings/paginate all use Array.filter/slice, which
// preserve the original listing objects' identity -- important so
// ListingCard's own local state (e.g. after a successful action) isn't
// reset by an unrelated re-render.
const filteredListings = computed(() => {
  const byStatus = filterByStatus(listings.value, statusFilter.value)
  return searchListings(byStatus, searchQuery.value, metadataById.value)
})

const pageCount = computed(() => totalPages(filteredListings.value.length, PAGE_SIZE))

const pagedListings = computed(() => paginate(filteredListings.value, currentPage.value, PAGE_SIZE))

// Changing what's being filtered/searched for should always jump back to
// the first page of the new result set.
watch([statusFilter, searchQuery], () => {
  currentPage.value = 1
})

// If the result set shrinks (e.g. a listing's status changes) such that
// the current page number is no longer valid, clamp it back into range
// rather than showing a blank page.
watch(pageCount, (count) => {
  currentPage.value = clampPage(currentPage.value, count)
})

function goToPage(page) {
  currentPage.value = clampPage(page, pageCount.value)
}
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

    <div v-if="wallet.contract && listings.length > 0" class="controls">
      <label class="control">
        <span>Status</span>
        <select v-model="statusFilter" class="status-filter">
          <option value="all">All statuses</option>
          <option v-for="(label, index) in STATUS_LABELS" :key="index" :value="index">
            {{ label }}
          </option>
        </select>
      </label>

      <label class="control search-control">
        <span>Search</span>
        <input
          v-model="searchQuery"
          type="search"
          class="search-input"
          placeholder="Search title, description, or location..."
        />
      </label>
    </div>

    <p v-if="loading">Loading listings…</p>
    <p v-else-if="loadError" class="load-error">{{ loadError }}</p>
    <p v-else-if="wallet.contract && listings.length === 0">No listings yet.</p>
    <p v-else-if="wallet.contract && filteredListings.length === 0" class="no-results">
      No listings match your filters.
    </p>

    <div v-if="pagedListings.length > 0" class="listing-grid">
      <ListingCard v-for="listing in pagedListings" :key="listing.id" :listing="listing" />
    </div>

    <div v-if="pageCount > 1" class="pagination">
      <button
        type="button"
        class="page-button"
        :disabled="currentPage === 1"
        @click="goToPage(currentPage - 1)"
      >
        Previous
      </button>
      <span class="page-indicator">Page {{ currentPage }} of {{ pageCount }}</span>
      <button
        type="button"
        class="page-button"
        :disabled="currentPage === pageCount"
        @click="goToPage(currentPage + 1)"
      >
        Next
      </button>
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

.no-results {
  opacity: 0.75;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: 1rem;
}

.control {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
}

.search-control {
  flex: 1;
  min-width: 14rem;
}

.status-filter,
.search-input {
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  background: var(--color-background);
  color: inherit;
  font: inherit;
}

.listing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 1.5rem;
}

.page-button {
  padding: 0.4rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  background: transparent;
  color: inherit;
}

.page-indicator {
  font-size: 0.9rem;
  opacity: 0.8;
}
</style>
