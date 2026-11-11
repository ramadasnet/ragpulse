<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ imported: [] }>()

const { run, pending } = useAction()
const toast = useToast()
const text = ref('')

watch(open, (isOpen) => {
  if (isOpen) text.value = ''
})

interface Item { question: string, answer: string }

const parsed = computed<{ items: Item[], invalid: number, error?: string }>(() => {
  const raw = text.value.trim()
  if (!raw) return { items: [], invalid: 0 }
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const data = JSON.parse(raw)
      const list: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
      const items = list
        .map((x: any) => ({ question: String(x?.question ?? x?.q ?? '').trim(), answer: String(x?.answer ?? x?.a ?? '').trim() }))
        .filter(x => x.question && x.answer)
      return { items, invalid: list.length - items.length }
    }
    catch (err: any) {
      return { items: [], invalid: 0, error: `Invalid JSON: ${err?.message || err}` }
    }
  }
  const items: Item[] = []
  let invalid = 0
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const sep = line.search(/[;\t]/)
    const question = sep > 0 ? line.slice(0, sep).trim() : ''
    const answer = sep > 0 ? line.slice(sep + 1).trim().replace(/\\n/g, '\n') : ''
    if (question && answer) items.push({ question, answer })
    else invalid++
  }
  return { items, invalid }
})

async function submit() {
  const items = parsed.value.items
  if (!items.length) return
  const res = await run(() => $fetch<{ imported: number, skipped: number, indexErrors: number, indexError?: string }>(
    `/api/projects/${props.projectId}/faqs/import`,
    { method: 'POST', body: { items: items.slice(0, 1000) } }
  ))
  if (!res) return
  toast.success(`Imported ${res.imported} FAQ${res.imported === 1 ? '' : 's'}${res.skipped ? ` · ${res.skipped} duplicate${res.skipped === 1 ? '' : 's'} skipped` : ''}`)
  if (res.indexErrors) toast.error(`${res.indexErrors} entr${res.indexErrors === 1 ? 'y' : 'ies'} could not be indexed: ${res.indexError ?? ''}`)
  emit('imported')
  open.value = false
}
</script>

<template>
  <UiModal v-model:open="open" title="Import FAQ" description="Paste a JSON array or one entry per line." width="640px">
    <div class="stack" style="--gap: 12px">
      <UiTextarea
        v-model="text"
        label="Entries"
        mono
        :rows="12"
        placeholder="[{&quot;question&quot;: &quot;Do you ship to EU?&quot;, &quot;answer&quot;: &quot;Yes, within 3–5 days.&quot;}]

or

Do you ship to EU?;Yes, within 3–5 days.
How can I pay?;Card, PayPal or bank transfer."
        :error="parsed.error"
        hint="Lines use “question;answer” (or a tab). Write \n for line breaks inside an answer. Existing questions are skipped."
      />
      <div v-if="parsed.items.length || parsed.invalid" class="row wrap small">
        <UiBadge tone="accent">{{ parsed.items.length }} entr{{ parsed.items.length === 1 ? 'y' : 'ies' }} detected</UiBadge>
        <UiBadge v-if="parsed.invalid" tone="warning">{{ parsed.invalid }} ignored</UiBadge>
        <UiBadge v-if="parsed.items.length > 1000" tone="danger">only the first 1000 are imported</UiBadge>
      </div>
      <ul v-if="parsed.items.length" class="preview">
        <li v-for="(item, i) in parsed.items.slice(0, 3)" :key="i">
          <p class="strong small truncate">{{ item.question }}</p>
          <p class="dim tiny truncate">{{ item.answer }}</p>
        </li>
        <li v-if="parsed.items.length > 3" class="dim tiny">…and {{ parsed.items.length - 3 }} more</li>
      </ul>
    </div>
    <template #footer>
      <UiButton variant="ghost" @click="open = false">Cancel</UiButton>
      <UiButton variant="primary" :disabled="!parsed.items.length" :loading="pending" @click="submit">
        Import {{ parsed.items.length || '' }}
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.preview { list-style: none; margin: 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-elev); display: flex; flex-direction: column; gap: 8px; }
</style>
