<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useWalletStore } from '@/stores/wallet'
import { fetchAllListings, STATUS_LABELS, ListingContractError } from '@/services/listingContract'
import { fetchListingMetadata } from '@/services/ipfsMetadata'
import { filterByStatus, searchListings, paginate, totalPages, clampPage } from '@/utils/listingFilters'
import ListingCard from '@/components/ListingCard.vue'
import Button from '@/components/ui/Button.vue'
import Alert from '@/components/ui/Alert.vue'

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
  <div class="flex flex-col gap-5">
    <h1 class="text-2xl font-bold tracking-tight">Browse Listings</h1>

    <Alert v-if="!wallet.isConnected" tone="warning">Connect your wallet to browse listings.</Alert>
    <Alert v-else-if="!wallet.isCorrectNetwork" tone="warning">
      Switch to Sepolia to browse listings.
    </Alert>
    <Alert v-else-if="!wallet.contract" tone="warning">
      The contract address is not configured yet.
    </Alert>

    <div v-if="wallet.contract && listings.length > 0" class="flex flex-wrap items-end gap-4">
      <label class="flex min-w-[10rem] flex-col gap-1 text-sm">
        <span class="font-medium text-heading">Status</span>
        <select v-model="statusFilter" class="status-filter">
          <option value="all">All statuses</option>
          <option v-for="(label, index) in STATUS_LABELS" :key="index" :value="index">
            {{ label }}
          </option>
        </select>
      </label>

      <label class="flex flex-1 flex-col gap-1 text-sm min-w-[14rem]">
        <span class="font-medium text-heading">Search</span>
        <input
          v-model="searchQuery"
          type="search"
          class="search-input"
          placeholder="Search title, description, or location..."
        />
      </label>
    </div>

    <p v-if="loading" class="text-sm text-muted">Loading listings…</p>
    <Alert v-else-if="loadError" tone="danger" class="load-error">{{ loadError }}</Alert>
    <p v-else-if="wallet.contract && listings.length === 0" class="text-sm text-muted">
      No listings yet.
    </p>
    <p
      v-else-if="wallet.contract && filteredListings.length === 0"
      class="no-results text-sm text-muted"
    >
      No listings match your filters.
    </p>

    <div
      v-if="pagedListings.length > 0"
      class="listing-grid grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]"
    >
      <ListingCard v-for="listing in pagedListings" :key="listing.id" :listing="listing" />
    </div>

    <div v-if="pageCount > 1" class="pagination flex items-center justify-center gap-4">
      <Button
        variant="secondary"
        size="sm"
        class="page-button"
        :disabled="currentPage === 1"
        @click="goToPage(currentPage - 1)"
      >
        Previous
      </Button>
      <span class="text-sm text-muted">Page {{ currentPage }} of {{ pageCount }}</span>
      <Button
        variant="secondary"
        size="sm"
        class="page-button"
        :disabled="currentPage === pageCount"
        @click="goToPage(currentPage + 1)"
      >
        Next
      </Button>
    </div>
  </div>
</template>
