<script setup lang="ts">
import {Check, Mail} from "lucide-vue-next"

const props = defineProps<{pending?: boolean; error?: string; doneEmail?: string; hasSupport?: boolean; initialName?: string; initialEmail?: string}>()
const emit = defineEmits<{submit: [payload: {name: string; email: string}]}>()
const name = ref(props.initialName || "")
const email = ref(props.initialEmail || "")

function submit() {
    const n = name.value.trim()
    const e = email.value.trim()
    if (!n || !e || props.pending) return
    emit("submit", {name: n, email: e})
}
</script>

<template>
    <div class="c-card compact">
        <p v-if="doneEmail" class="c-done" role="status">
            <Check :size="15" />
            <span
                >Thanks! Our team can reach you at <strong>{{ doneEmail }}</strong>.</span
            >
        </p>
        <form v-else class="c-form" @submit.prevent="submit">
            <p class="c-card-text"><Mail :size="14" /> Leave your name and email for our team</p>
            <input v-model="name" class="c-input" required maxlength="80" autocomplete="name" placeholder="Your name" aria-label="Your name" />
            <div class="c-row">
                <input v-model="email" class="c-input" type="email" required maxlength="200" autocomplete="email" placeholder="you@example.com" aria-label="Your email" />
                <button class="c-btn sm" type="submit" :disabled="!name.trim() || !email.trim() || pending">
                    <span v-if="pending" class="c-spin" aria-hidden="true" />
                    <template v-else>Send</template>
                </button>
            </div>
            <p v-if="error" class="c-error" role="alert">{{ error }}</p>
        </form>
    </div>
</template>
