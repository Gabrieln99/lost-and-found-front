<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { useForm, useField } from 'vee-validate'
import { parseEther } from 'ethers'
import { VueDatePicker } from '@vuepic/vue-datepicker'
import { useWalletStore } from '@/stores/wallet'
import { uploadListingMetadata, StorageServiceError } from '@/services/storageService'
import {
  sendCreateListingTx,
  waitForListingReceipt,
  ListingContractError,
} from '@/services/listingContract'
import { createCancelGate, ignoreLateSettlement, CancelledError } from '@/utils/cancelGate'
import { useToasts } from '@/composables/useToasts'
import Button from '@/components/ui/Button.vue'
import Alert from '@/components/ui/Alert.vue'
import FormField from '@/components/ui/FormField.vue'

// Matches the storage service's own 10 MB cap so oversized files are
// rejected client-side before an upload is even attempted.
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024

const wallet = useWalletStore()
const { pushToast } = useToasts()

const validationSchema = {
  title(value) {
    if (!value || !value.trim()) return 'Title is required.'
    if (value.length > 100) return 'Title must be 100 characters or fewer.'
    return true
  },
  description(value) {
    if (!value || !value.trim()) return 'Description is required.'
    if (value.length > 500) return 'Description must be 500 characters or fewer.'
    return true
  },
  location(value) {
    if (!value || !value.trim()) return 'Location is required.'
    if (value.length > 200) return 'Location must be 200 characters or fewer.'
    return true
  },
  reward(value) {
    if (!value) return 'Reward is required.'
    const parsed = Number(value)
    if (Number.isNaN(parsed) || parsed <= 0) return 'Reward must be a positive number of ETH.'
    return true
  },
  expirationDate(value) {
    if (!value) return true
    const timestamp = new Date(value).getTime()
    if (Number.isNaN(timestamp)) return 'Invalid date.'
    if (timestamp <= Date.now()) return 'Expiration must be in the future.'
    return true
  },
}

const { handleSubmit, resetForm } = useForm({ validationSchema })

const { value: title, errorMessage: titleError } = useField('title')
const { value: description, errorMessage: descriptionError } = useField('description')

const DESCRIPTION_MAX_LENGTH = 500
const DESCRIPTION_MAX_HEIGHT_PX = 256 // 16rem -- scrolls internally past this

const descriptionTextareaRef = ref(null)

function resizeDescriptionTextarea() {
  const el = descriptionTextareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, DESCRIPTION_MAX_HEIGHT_PX)}px`
}

// Covers typing, paste, and the field resetting after a successful submit --
// anything that changes the bound value, not just direct keystrokes.
watch(description, () => nextTick(resizeDescriptionTextarea))
const { value: location, errorMessage: locationError } = useField('location')
const { value: reward, errorMessage: rewardError } = useField('reward')
const { value: expirationDate, errorMessage: expirationDateError } = useField('expirationDate')

const imageFile = ref(null)
const imageError = ref('')
const imagePreviewUrl = ref(null)
const isDragActive = ref(false)
const fileInputRef = ref(null)

function validateAndSetImage(file) {
  imageError.value = ''

  if (!file) {
    imageFile.value = null
    return
  }
  if (!file.type.startsWith('image/')) {
    imageError.value = 'Please select an image file.'
    imageFile.value = null
    return
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    imageError.value = 'Image must be 10 MB or smaller.'
    imageFile.value = null
    return
  }
  imageFile.value = file
}

function onImageChange(event) {
  validateAndSetImage(event.target.files?.[0] ?? null)
}

function onImageDrop(event) {
  isDragActive.value = false
  validateAndSetImage(event.dataTransfer?.files?.[0] ?? null)
}

function browseForImage() {
  fileInputRef.value?.click()
}

function removeSelectedImage() {
  validateAndSetImage(null)
  // Clears the native input's own record of the file so re-selecting the
  // exact same file afterwards still fires a change event.
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

// Revoke the previous object URL whenever the selected file changes (or is
// cleared) so we don't leak one every time a new photo is picked, and again
// on unmount for whichever URL is still outstanding at that point.
watch(imageFile, (file) => {
  if (imagePreviewUrl.value) {
    URL.revokeObjectURL(imagePreviewUrl.value)
    imagePreviewUrl.value = null
  }
  if (file) {
    imagePreviewUrl.value = URL.createObjectURL(file)
  }
})

onUnmounted(() => {
  if (imagePreviewUrl.value) {
    URL.revokeObjectURL(imagePreviewUrl.value)
  }
})

const status = ref('idle')
const submitError = ref('')
const result = ref(null)

const isSubmitting = computed(() =>
  ['uploading-image', 'awaiting-signature', 'awaiting-confirmation'].includes(status.value),
)

const walletBlockReason = computed(() => {
  if (!wallet.isConnected) return 'Connect your wallet to publish a listing.'
  if (!wallet.isCorrectNetwork) return 'Switch to Sepolia to publish a listing.'
  if (!wallet.contract) return 'The contract address is not configured yet.'
  return ''
})

const statusMessage = computed(() => {
  switch (status.value) {
    case 'uploading-image':
      return 'Uploading photo and details...'
    case 'awaiting-signature':
      return 'Waiting for you to confirm in your wallet...'
    case 'awaiting-confirmation':
      return 'Waiting for the transaction to be confirmed on-chain...'
    default:
      return ''
  }
})

// Lets a manual Cancel click (during awaiting-signature only) abandon the
// in-flight wallet request immediately, instead of making the user wait
// out the full wallet-response timeout. The request itself isn't actually
// abortable, so it may still be hanging in the background -- see
// ignoreLateSettlement.
let cancelGate = null

const onSubmit = handleSubmit(async (values) => {
  submitError.value = ''
  result.value = null

  if (!imageFile.value) {
    imageError.value = 'Please select an image.'
    return
  }
  if (walletBlockReason.value) {
    submitError.value = walletBlockReason.value
    return
  }

  cancelGate = createCancelGate()

  try {
    status.value = 'uploading-image'
    const cid = await uploadListingMetadata({
      file: imageFile.value,
      title: values.title,
      description: values.description,
      location: values.location,
    })

    const rewardWei = parseEther(String(values.reward))
    const expirationTimestamp = values.expirationDate
      ? BigInt(Math.floor(new Date(values.expirationDate).getTime() / 1000))
      : 0n

    status.value = 'awaiting-signature'
    const sendPromise = sendCreateListingTx(wallet.contract, {
      cid,
      rewardWei,
      expirationTimestamp,
    })
    ignoreLateSettlement(sendPromise)
    const tx = await Promise.race([sendPromise, cancelGate.promise])

    status.value = 'awaiting-confirmation'
    const { listingId, transactionHash } = await waitForListingReceipt(wallet.contract, tx)

    result.value = { listingId, transactionHash }
    status.value = 'success'
    pushToast({ tone: 'success', message: 'Listing published!' })
    resetForm()
    imageFile.value = null
  } catch (err) {
    if (err instanceof CancelledError) {
      status.value = 'idle'
      return
    }
    status.value = 'error'
    if (err instanceof StorageServiceError || err instanceof ListingContractError) {
      submitError.value = err.message
    } else {
      submitError.value = err?.message || 'Something went wrong.'
    }
  } finally {
    cancelGate = null
  }
})

function cancelSubmit() {
  cancelGate?.cancel()
}
</script>

<template>
  <div class="mx-auto flex max-w-xl flex-col gap-6 rounded-lg bg-gradient-to-b from-[#eef3fc] to-white p-6">
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold tracking-tight">Publish a lost-item listing</h1>
      <p class="text-sm text-muted">
        Your reward is locked in the contract and only released once you confirm the item is back.
      </p>
    </div>

    <form novalidate class="flex flex-col gap-4" @submit="onSubmit">
      <FormField label="Title" field-id="title" :error="titleError">
        <input id="title" v-model="title" type="text" maxlength="100" placeholder="e.g. Lost wallet" />
      </FormField>

      <FormField label="Description" field-id="description" :error="descriptionError">
        <textarea
          id="description"
          ref="descriptionTextareaRef"
          v-model="description"
          rows="3"
          :maxlength="DESCRIPTION_MAX_LENGTH"
          class="resize-none overflow-y-auto"
          style="max-height: 16rem"
        />
        <p class="text-right text-xs text-muted">
          {{ (description || '').length }} / {{ DESCRIPTION_MAX_LENGTH }}
        </p>
      </FormField>

      <FormField label="Location lost" field-id="location" :error="locationError">
        <input id="location" v-model="location" type="text" maxlength="200" />
      </FormField>

      <FormField label="Photo" field-id="image" :error="imageError">
        <input
          id="image"
          ref="fileInputRef"
          type="file"
          accept="image/*"
          class="hidden"
          @change="onImageChange"
        />
        <div
          class="dropzone relative flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border p-6 text-center text-sm text-muted cursor-pointer"
          :class="{ 'border-brand bg-info-soft': isDragActive }"
          role="button"
          tabindex="0"
          @click="browseForImage"
          @keydown.enter.prevent="browseForImage"
          @keydown.space.prevent="browseForImage"
          @dragover.prevent="isDragActive = true"
          @dragleave.prevent="isDragActive = false"
          @drop.prevent="onImageDrop"
        >
          <button
            v-if="imagePreviewUrl"
            type="button"
            class="remove-image-button absolute top-2 right-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-danger text-white shadow"
            aria-label="Remove selected photo"
            @click.stop="removeSelectedImage"
            @keydown.stop
          >
            &times;
          </button>
          <img
            v-if="imagePreviewUrl"
            :src="imagePreviewUrl"
            alt="Selected photo preview"
            class="aspect-[4/3] w-full max-w-56 rounded-md object-cover"
          />
          <p v-else>Drag a photo here, or click to browse</p>
        </div>
      </FormField>

      <FormField label="Reward (ETH)" field-id="reward" :error="rewardError">
        <input
          id="reward"
          v-model="reward"
          type="number"
          step="any"
          min="0"
          @wheel="($event) => $event.target.blur()"
        />
      </FormField>

      <FormField label="Expires (optional)" field-id="expirationDate" :error="expirationDateError">
        <VueDatePicker
          v-model="expirationDate"
          :input-attrs="{ id: 'expirationDate' }"
          :min-date="new Date()"
          placeholder="No expiration"
          auto-apply
          teleport
        />
      </FormField>

      <Alert v-if="walletBlockReason && status === 'idle'" tone="warning">
        {{ walletBlockReason }}
      </Alert>

      <Button type="submit" variant="primary" class="w-full" :disabled="isSubmitting">
        {{ isSubmitting ? statusMessage : 'Publish listing' }}
      </Button>

      <Button
        v-if="status === 'awaiting-signature'"
        class="cancel-button w-full"
        variant="secondary"
        @click="cancelSubmit"
      >
        Cancel
      </Button>

      <Alert v-if="submitError" tone="danger" class="submit-error">{{ submitError }}</Alert>

      <Alert
        v-if="status === 'success' && result"
        as="div"
        tone="success"
        class="submit-success flex flex-col gap-1"
      >
        <p class="font-medium">Listing published!</p>
        <p v-if="result.listingId !== null">Listing ID: {{ result.listingId.toString() }}</p>
        <p class="break-all">
          Transaction:
          <a
            class="font-mono"
            :href="`https://sepolia.etherscan.io/tx/${result.transactionHash}`"
            target="_blank"
            rel="noopener"
          >
            {{ result.transactionHash }}
          </a>
        </p>
      </Alert>
    </form>
  </div>
</template>
