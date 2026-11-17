<script setup lang="ts">
import {parseFaqJson, stripJsonComments, type FaqDraft} from "#shared/utils/faq-import"

const open = defineModel<boolean>("open", {default: false})
const props = defineProps<{projectId: string}>()
const emit = defineEmits<{imported: []}>()

const {run, pending} = useAction()
const toast = useToast()
const text = ref("")

watch(open, (isOpen) => {
    if (isOpen) text.value = ""
})

const parsed = computed<{items: FaqDraft[]; invalid: number; error?: string}>(() => {
    const raw = text.value.trim()
    if (!raw) return {items: [], invalid: 0}
    // JSON may contain // and /* */ comments, extra fields and a wrapper object
    if (stripJsonComments(raw).trimStart().match(/^[[{]/)) {
        try {
            return parseFaqJson(raw)
        } catch (err: any) {
            return {items: [], invalid: 0, error: `Invalid JSON: ${err?.message || err}`}
        }
    }
    const items: FaqDraft[] = []
    let invalid = 0
    for (const line of raw.split("\n")) {
        if (!line.trim()) continue
        const sep = line.search(/[;\t]/)
        const question = sep > 0 ? line.slice(0, sep).trim() : ""
        const answer =
            sep > 0
                ? line
                      .slice(sep + 1)
                      .trim()
                      .replace(/\\n/g, "\n")
                : ""
        if (question && answer) items.push({question, answer})
        else invalid++
    }
    return {items, invalid}
})

// AI fallback: when nothing is detected locally, the model is asked to extract the entries
const aiItems = ref<FaqDraft[]>([])
const aiPending = ref(false)
const aiError = ref("")
let aiTimer: ReturnType<typeof setTimeout> | undefined
let aiSeq = 0

// Entries the local parser found, or the ones the AI extracted when it could not
const items = computed<FaqDraft[]>(() => (parsed.value.items.length ? parsed.value.items : aiItems.value))

watch(text, () => {
    aiItems.value = []
    aiError.value = ""
    aiPending.value = false
    clearTimeout(aiTimer)
    const raw = text.value.trim()
    if (!raw || parsed.value.items.length) return
    aiTimer = setTimeout(() => parseWithAi(raw), 800)
})

async function parseWithAi(raw: string) {
    const seq = ++aiSeq
    aiPending.value = true
    try {
        const res = await $fetch<{items: FaqDraft[]}>(`/api/projects/${props.projectId}/faqs/parse`, {method: "POST", body: {text: raw.slice(0, 50_000)}})
        if (seq !== aiSeq || text.value.trim() !== raw) return
        aiItems.value = res.items
        if (!res.items.length) aiError.value = "No question/answer pairs found"
    } catch (err) {
        if (seq !== aiSeq || text.value.trim() !== raw) return
        aiError.value = errorMessage(err)
    } finally {
        if (seq === aiSeq) aiPending.value = false
    }
}

async function submit() {
    const list = items.value
    if (!list.length) return
    const res = await run(() => $fetch<{imported: number; skipped: number; indexErrors: number; indexError?: string}>(`/api/projects/${props.projectId}/faqs/import`, {method: "POST", body: {items: list.slice(0, 1000)}}))
    if (!res) return
    toast.success(`Imported ${res.imported} FAQ${res.imported === 1 ? "" : "s"}${res.skipped ? ` · ${res.skipped} duplicate${res.skipped === 1 ? "" : "s"} skipped` : ""}`)
    if (res.indexErrors) toast.error(`${res.indexErrors} entr${res.indexErrors === 1 ? "y" : "ies"} could not be indexed: ${res.indexError ?? ""}`)
    emit("imported")
    open.value = false
}
</script>

<template>
    <UiModal v-model:open="open" title="Import FAQ" description="Paste a JSON array or one entry per line. Other formats are detected with AI." width="640px">
        <div class="stack" style="--gap: 12px">
            <UiTextarea
                v-model="text"
                label="Entries"
                mono
                :rows="12"
                placeholder='[{"question": "Do you ship to EU?", "answer": "Yes, within 3–5 days."}]

or

Do you ship to EU?;Yes, within 3–5 days.
How can I pay?;Card, PayPal or bank transfer.'
                :error="items.length ? undefined : parsed.error"
                hint="Lines use “question;answer” (or a tab). Write \n for line breaks inside an answer. JSON may contain comments and unquoted keys. Existing questions are skipped."
            />
            <div v-if="items.length || parsed.invalid || aiPending || aiError" class="row wrap small">
                <UiBadge v-if="items.length" tone="accent">{{ items.length }} entr{{ items.length === 1 ? "y" : "ies" }} detected{{ parsed.items.length ? "" : " with AI" }}</UiBadge>
                <UiBadge v-if="parsed.invalid" tone="warning">{{ parsed.invalid }} ignored</UiBadge>
                <UiBadge v-if="items.length > 1000" tone="danger">only the first 1000 are imported</UiBadge>
                <UiBadge v-if="aiPending" tone="info">Detecting with AI…</UiBadge>
                <UiBadge v-else-if="aiError" tone="warning">{{ aiError }}</UiBadge>
            </div>
            <ul v-if="items.length" class="preview">
                <li v-for="(item, i) in items.slice(0, 3)" :key="i">
                    <p class="strong small truncate">{{ item.question }}</p>
                    <p class="dim tiny truncate">{{ item.answer }}</p>
                </li>
                <li v-if="items.length > 3" class="dim tiny">…and {{ items.length - 3 }} more</li>
            </ul>
        </div>
        <template #footer>
            <UiButton variant="ghost" @click="open = false">Cancel</UiButton>
            <UiButton variant="primary" :disabled="!items.length" :loading="pending" @click="submit"> Import {{ items.length || "" }} </UiButton>
        </template>
    </UiModal>
</template>

<style scoped>
.preview {
    list-style: none;
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elev);
    display: flex;
    flex-direction: column;
    gap: 8px;
}
</style>
