<script setup lang="ts">
import { Check, Send } from 'lucide-vue-next'

const props = defineProps<{
  message: string
  pending?: boolean
  error?: string
  sent?: boolean
  initialEmail?: string
  initialQuestion?: string
}>()
const emit = defineEmits<{ submit: [payload: { email: string, question: string }] }>()
const email = ref(props.initialEmail || '')
const question = ref(props.initialQuestion || '')
watch(() => props.initialQuestion, (v) => {
  if (v && !question.value) question.value = v
})

function submit() {
  if (!email.value.trim() || !question.value.trim() || props.pending) return
  emit('submit', { email: email.value.trim(), question: question.value.trim() })
}
</script>

<template>
  <div class="c-card limit">
    <p v-if="sent" class="c-done" role="status"><Check :size="15" /> <span>Your question was sent. Our team will reply by email.</span></p>
    <template v-else>
      <div>
        <p class="c-card-title">Send your question to our team</p>
        <p class="c-card-text">{{ message }}</p>
      </div>
      <form class="c-form" @submit.prevent="submit">
        <input v-model="email" class="c-input" type="email" required maxlength="200" autocomplete="email" placeholder="Your email" aria-label="Your email">
        <textarea v-model="question" class="c-input" required rows="3" maxlength="2000" placeholder="Your question" aria-label="Your question" />
        <p v-if="error" class="c-error" role="alert">{{ error }}</p>
        <button class="c-btn" type="submit" :disabled="!email.trim() || !question.trim() || pending">
          <span v-if="pending" class="c-spin" aria-hidden="true" />
          <template v-else><Send :size="15" /> Send to the team</template>
        </button>
      </form>
    </template>
  </div>
</template>
