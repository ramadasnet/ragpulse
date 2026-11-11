<script setup lang="ts">
import { Check, Mail } from 'lucide-vue-next'

const props = defineProps<{ pending?: boolean, error?: string, doneEmail?: string, hasSupport?: boolean }>()
const emit = defineEmits<{ submit: [email: string] }>()
const email = ref('')

function submit() {
  const value = email.value.trim()
  if (!value || props.pending) return
  emit('submit', value)
}
</script>

<template>
  <div class="c-card compact">
    <p v-if="doneEmail" class="c-done" role="status"><Check :size="15" /> <span>Thanks! We'll reply to <strong>{{ doneEmail }}</strong>.</span></p>
    <form v-else class="c-inline" @submit.prevent="submit">
      <p class="c-card-text"><Mail :size="14" /> Get the answer by email</p>
      <div class="c-row">
        <input v-model="email" class="c-input" type="email" required maxlength="200" autocomplete="email" placeholder="you@example.com" aria-label="Your email">
        <button class="c-btn sm" type="submit" :disabled="!email.trim() || pending">
          <span v-if="pending" class="c-spin" aria-hidden="true" />
          <template v-else>Send</template>
        </button>
      </div>
      <p v-if="error" class="c-error" role="alert">{{ error }}</p>
    </form>
  </div>
</template>
