<script setup lang="ts">
import {ArrowRight} from "lucide-vue-next"

const props = defineProps<{pending?: boolean; error?: string; initialName?: string; initialEmail?: string}>()
const emit = defineEmits<{submit: [payload: {name: string; email?: string}]}>()

const name = ref(props.initialName || "")
const email = ref(props.initialEmail || "")
const nameEl = ref<HTMLInputElement | null>(null)

onMounted(() => {
    // Avoid popping the keyboard on mobile
    if (window.matchMedia("(min-width: 640px)").matches) nameEl.value?.focus()
})

function submit() {
    const n = name.value.trim()
    if (!n || props.pending) return
    emit("submit", {name: n, email: email.value.trim() || undefined})
}
</script>

<template>
    <form class="c-card intro" @submit.prevent="submit">
        <div>
            <p class="c-card-title">How should we call you?</p>
            <p class="c-card-text">Just so we know who we're talking to.</p>
        </div>
        <label class="c-field">
            <span class="c-label">Your name</span>
            <input ref="nameEl" v-model="name" class="c-input" required maxlength="80" autocomplete="given-name" placeholder="e.g. Alex" />
        </label>
        <label class="c-field">
            <span class="c-label">Email <span class="c-opt">optional, for replies from our team</span></span>
            <input v-model="email" class="c-input" type="email" maxlength="200" autocomplete="email" placeholder="you@example.com" />
        </label>
        <p v-if="error" class="c-error" role="alert">{{ error }}</p>
        <button class="c-btn" type="submit" :disabled="!name.trim() || pending">
            <span v-if="pending" class="c-spin" aria-hidden="true" />
            <template v-else>Start chatting <ArrowRight :size="16" /></template>
        </button>
    </form>
</template>
