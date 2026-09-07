<script setup>
import { ref, computed } from 'vue'
import { useForm, useField } from 'vee-validate'
import { parseEther } from 'ethers'
import { useWalletStore } from '@/stores/wallet'
import { uploadListingMetadata, StorageServiceError } from '@/services/storageService'
import {
  sendCreateListingTx,
  waitForListingReceipt,
  ListingContractError,
} from '@/services/listingContract'

// Matches the storage service's own 10 MB cap so oversized files are
// rejected client-side before an upload is even attempted.
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024

const wallet = useWalletStore()

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
const { value: location, errorMessage: locationError } = useField('location')
const { value: reward, errorMessage: rewardError } = useField('reward')
const { value: expirationDate, errorMessage: expirationDateError } = useField('expirationDate')

const imageFile = ref(null)
const imageError = ref('')

function onImageChange(event) {
  const file = event.target.files?.[0] ?? null
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
    const tx = await sendCreateListingTx(wallet.contract, {
      cid,
      rewardWei,
      expirationTimestamp,
    })

    status.value = 'awaiting-confirmation'
    const { listingId, transactionHash } = await waitForListingReceipt(wallet.contract, tx)

    result.value = { listingId, transactionHash }
    status.value = 'success'
    resetForm()
    imageFile.value = null
  } catch (err) {
    status.value = 'error'
    if (err instanceof StorageServiceError || err instanceof ListingContractError) {
      submitError.value = err.message
    } else {
      submitError.value = err?.message || 'Something went wrong.'
    }
  }
})
</script>

<template>
  <div class="create-listing">
    <h1>Publish a lost-item listing</h1>

    <form novalidate @submit="onSubmit">
      <div class="field">
        <label for="title">Title</label>
        <input id="title" v-model="title" type="text" maxlength="100" placeholder="e.g. Lost wallet" />
        <p v-if="titleError" class="field-error">{{ titleError }}</p>
      </div>

      <div class="field">
        <label for="description">Description</label>
        <textarea id="description" v-model="description" rows="3" maxlength="500" />
        <p v-if="descriptionError" class="field-error">{{ descriptionError }}</p>
      </div>

      <div class="field">
        <label for="location">Location lost</label>
        <input id="location" v-model="location" type="text" maxlength="200" />
        <p v-if="locationError" class="field-error">{{ locationError }}</p>
      </div>

      <div class="field">
        <label for="image">Photo</label>
        <input id="image" type="file" accept="image/*" @change="onImageChange" />
        <p v-if="imageError" class="field-error">{{ imageError }}</p>
      </div>

      <div class="field">
        <label for="reward">Reward (ETH)</label>
        <input id="reward" v-model="reward" type="number" step="any" min="0" />
        <p v-if="rewardError" class="field-error">{{ rewardError }}</p>
      </div>

      <div class="field">
        <label for="expirationDate">Expires (optional)</label>
        <input id="expirationDate" v-model="expirationDate" type="datetime-local" />
        <p v-if="expirationDateError" class="field-error">{{ expirationDateError }}</p>
      </div>

      <p v-if="walletBlockReason && status === 'idle'" class="wallet-hint">
        {{ walletBlockReason }}
      </p>

      <button type="submit" :disabled="isSubmitting">
        {{ isSubmitting ? statusMessage : 'Publish listing' }}
      </button>

      <p v-if="submitError" class="submit-error">{{ submitError }}</p>

      <div v-if="status === 'success' && result" class="submit-success">
        <p>Listing published!</p>
        <p v-if="result.listingId !== null">Listing ID: {{ result.listingId.toString() }}</p>
        <p>
          Transaction:
          <a :href="`https://sepolia.etherscan.io/tx/${result.transactionHash}`" target="_blank" rel="noopener">
            {{ result.transactionHash }}
          </a>
        </p>
      </div>
    </form>
  </div>
</template>

<style scoped>
.create-listing {
  max-width: 32rem;
  margin: 0 auto;
  padding: 1rem;
}

.field {
  margin-bottom: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field-error {
  color: #b3261e;
  font-size: 0.85rem;
  margin: 0;
}

.wallet-hint {
  color: #a15c00;
  font-size: 0.9rem;
}

.submit-error {
  color: #b3261e;
}

.submit-success {
  color: #1e7a34;
}
</style>
