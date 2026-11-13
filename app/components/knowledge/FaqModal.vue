<script setup lang="ts">
import type {Faq} from "#shared/types"

const open = defineModel<boolean>("open", {default: false})
const props = defineProps<{projectId: string; faq?: Faq | null}>()
const emit = defineEmits<{saved: [faq: Faq]}>()

const {run, pending} = useAction()
const toast = useToast()
const form = reactive({question: "", answer: ""})
const errors = reactive({question: "", answer: ""})

watch(
    open,
    (isOpen) => {
        if (!isOpen) return
        form.question = props.faq?.question ?? ""
        form.answer = props.faq?.answer ?? ""
        errors.question = ""
        errors.answer = ""
    },
    {immediate: true}
)

async function submit() {
    errors.question = form.question.trim() ? "" : "Question is required"
    errors.answer = form.answer.trim() ? "" : "Answer is required"
    if (errors.question || errors.answer) return
    const body = {question: form.question.trim(), answer: form.answer.trim()}
    const saved = await run(() =>
        props.faq ? $fetch<Faq & {indexError?: string}>(`/api/projects/${props.projectId}/faqs/${props.faq._id}`, {method: "PATCH", body}) : $fetch<Faq & {indexError?: string}>(`/api/projects/${props.projectId}/faqs`, {method: "POST", body})
    )
    if (!saved) return
    if (saved.indexError) toast.error(`Saved, but indexing failed: ${saved.indexError}`)
    else toast.success(props.faq ? "FAQ updated" : "FAQ added")
    emit("saved", saved)
    open.value = false
}
</script>

<template>
    <UiModal v-model:open="open" :title="faq ? 'Edit FAQ' : 'Add FAQ'" description="FAQ entries are indexed immediately and take part in retrieval like any other source." width="620px">
        <form id="faq-form" class="stack" style="--gap: 16px" @submit.prevent="submit">
            <UiInput v-model="form.question" label="Question" placeholder="How do I reset my password?" :error="errors.question" maxlength="1000" required />
            <UiTextarea v-model="form.answer" label="Answer" :rows="9" :error="errors.answer" hint="Markdown supported: lists, links, **bold**, `code`." placeholder="Go to Settings → Security and click “Reset password”…" />
        </form>
        <template #footer>
            <UiButton variant="ghost" @click="open = false">Cancel</UiButton>
            <UiButton variant="primary" type="submit" form="faq-form" :loading="pending">{{ faq ? "Save changes" : "Add FAQ" }}</UiButton>
        </template>
    </UiModal>
</template>
