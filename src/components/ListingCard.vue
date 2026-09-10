<script setup>
import { useListingMetadata } from '@/composables/useListingMetadata'
import { useListingActions } from '@/composables/useListingActions'
import ListingMessageThread from '@/components/ListingMessageThread.vue'
import Button from '@/components/ui/Button.vue'
import Alert from '@/components/ui/Alert.vue'

const props = defineProps({
  listing: { type: Object, required: true },
})

const { metadata, metadataError, loadingMetadata } = useListingMetadata(() => props.listing.itemCID)

const {
  currentListing,
  statusLabel,
  statusClass,
  rewardEth,
  canReportFound,
  canCancelListing,
  canConfirmRecovery,
  canRejectReport,
  canMessageThread,
  actionStatus,
  actionError,
  actionSuccessMessage,
  isActing,
  reportFoundLabel,
  cancelListingLabel,
  confirmRecoveryLabel,
  rejectReportLabel,
  onReportFound,
  onCancelListing,
  onConfirmRecovery,
  onRejectReport,
  cancelAction,
} = useListingActions(() => props.listing)
</script>

<template>
  <article
    class="listing-card flex flex-col overflow-hidden rounded-lg border border-border bg-surface"
    :class="statusClass"
  >
    <div class="listing-image grid aspect-[4/3] place-items-center overflow-hidden bg-surface-soft">
      <img
        v-if="metadata?.image"
        :src="metadata.image"
        :alt="metadata.description || 'Listing photo'"
        class="h-full w-full object-cover"
      />
      <div v-else class="image-placeholder text-sm text-muted">
        {{ loadingMetadata ? 'Loading…' : 'No image' }}
      </div>
    </div>

    <div class="listing-body flex flex-1 flex-col gap-2 p-3">
      <span
        class="status-badge self-start rounded-full px-2 py-0.5 text-xs font-semibold"
      >{{ statusLabel }}</span>

      <p v-if="loadingMetadata" class="loading text-sm text-muted">Loading details…</p>
      <template v-else-if="metadataError">
        <Alert tone="danger" class="metadata-error">{{ metadataError }}</Alert>
        <p class="item-cid font-mono text-xs break-all text-muted">
          CID: {{ currentListing.itemCID }}
        </p>
      </template>
      <template v-else>
        <h3 v-if="metadata.title" class="title text-base font-semibold">{{ metadata.title }}</h3>
        <p class="description text-sm">
          <strong class="font-medium text-muted">Description:</strong> {{ metadata.description }}
        </p>
        <p class="location text-sm">
          <strong class="font-medium text-muted">Location:</strong> {{ metadata.location }}
        </p>
      </template>

      <p class="reward text-sm">
        <strong class="font-medium text-muted">Reward:</strong> {{ rewardEth }} ETH
      </p>

      <!-- Pushed to the bottom of the card (mt-auto) so action buttons line
           up across a grid row regardless of how much text is above. -->
      <div class="listing-actions mt-auto flex flex-col gap-2">
      <div v-if="canReportFound" class="listing-action">
        <Button
          class="report-found-button w-full"
          variant="secondary"
          :disabled="isActing"
          @click="onReportFound"
        >
          {{ reportFoundLabel }}
        </Button>
      </div>

      <div v-if="canCancelListing" class="listing-action">
        <Button
          class="cancel-listing-button w-full"
          variant="secondary"
          :disabled="isActing"
          @click="onCancelListing"
        >
          {{ cancelListingLabel }}
        </Button>
      </div>

      <div v-if="canConfirmRecovery || canRejectReport" class="listing-action reported-actions flex gap-2">
        <Button
          v-if="canConfirmRecovery"
          class="confirm-recovery-button flex-1"
          variant="success"
          :disabled="isActing"
          @click="onConfirmRecovery"
        >
          {{ confirmRecoveryLabel }}
        </Button>
        <Button
          v-if="canRejectReport"
          class="reject-report-button flex-1"
          variant="warning"
          :disabled="isActing"
          @click="onRejectReport"
        >
          {{ rejectReportLabel }}
        </Button>
      </div>

      <Button
        v-if="actionStatus === 'awaiting-signature'"
        class="action-cancel-button w-full"
        variant="secondary"
        size="sm"
        @click="cancelAction"
      >
        Cancel
      </Button>

      <Alert v-if="actionError" tone="danger" class="action-error">{{ actionError }}</Alert>
      <Alert v-if="actionStatus === 'success'" tone="success" class="action-success">
        {{ actionSuccessMessage }}
      </Alert>

      <ListingMessageThread v-if="canMessageThread" :listing="currentListing" collapsible />
      </div>
    </div>
  </article>
</template>

<style scoped>
/*
  Only the status-badge colour theming stays as scoped CSS: it keys off the
  root's `status-*` class (set by the statusClass computed) so the badge can
  be coloured per status without adding a status->tone mapping to the
  script, and without changing the root's class list that the specs assert
  on. Everything else is Tailwind utilities in the template.
*/
.status-badge {
  background: var(--color-surface-soft);
  color: var(--color-muted);
}

.status-open .status-badge {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.status-reported .status-badge {
  background: var(--color-warning-soft);
  color: var(--color-warning);
}

.status-resolved .status-badge {
  background: var(--color-info-soft);
  color: var(--color-info);
}

.status-cancelled .status-badge {
  background: var(--color-surface-muted);
  color: var(--color-muted);
}

.status-cancelled .description,
.status-cancelled .location {
  color: var(--color-muted);
}

.listing-card.status-cancelled,
.listing-card.status-resolved {
  opacity: 0.7;
}
</style>
