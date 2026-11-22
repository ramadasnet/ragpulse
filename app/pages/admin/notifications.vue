<script setup lang="ts">
import {AlertTriangle, Send} from "lucide-vue-next"
import type {PushEvent} from "#shared/types"
import {PUSH_EVENT_INFO, PUSH_EVENTS} from "#shared/types"

useHead({title: "Notifications · RAGPulse"})

const toast = useToast()
const {can} = useMe()
const {projects, ensure} = useProjects()
const push = usePush()
const {run: runTest, pending: testing} = useAction()

const supported = pushSupported()
// iPhone and iPad only deliver Web Push to the app added to the Home Screen (iPadOS reports itself as a Mac)
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
const permission = ref(supported ? Notification.permission : "denied")
const events = ref<PushEvent[] | null>(null)
const loading = ref(supported)
const busy = ref(false)

/** Notifications the user can receive on at least one project */
const available = computed(() => PUSH_EVENTS.filter((e) => projects.value.some((p) => can(p._id, PUSH_EVENT_INFO[e].permission))))

onMounted(async () => {
    await ensure()
    if (!supported) return
    try {
        events.value = await push.load()
    } catch (err) {
        toast.error(errorMessage(err))
    } finally {
        loading.value = false
    }
})

// Not async: the permission prompt must be requested synchronously within the click
function toggleDevice(on: boolean) {
    if (busy.value) return
    busy.value = true
    const initial = available.value
    const task = on ? push.enable(initial).then(() => (events.value = initial)) : push.disable().then(() => (events.value = null))
    task.then(() => toast.success(on ? "Notifications turned on" : "Notifications turned off"))
        .catch((err) => toast.error(errorMessage(err)))
        .finally(() => {
            busy.value = false
            permission.value = Notification.permission
        })
}

async function toggleEvent(event: PushEvent, on: boolean) {
    if (!events.value || busy.value) return
    const previous = events.value
    const next = on ? [...previous, event] : previous.filter((e) => e !== event)
    events.value = next
    busy.value = true
    try {
        await push.update(next)
    } catch (err) {
        events.value = previous
        toast.error(errorMessage(err))
    } finally {
        busy.value = false
    }
}

async function sendTest() {
    if (!events.value) return
    await runTest(async () => {
        try {
            await push.test(events.value!)
        } catch (err: any) {
            if ((err?.statusCode ?? err?.data?.statusCode) === 410) events.value = null
            throw err
        }
    }, "Test notification sent")
}
</script>

<template>
    <div class="page">
        <header class="page-header">
            <div>
                <p class="eyebrow">Workspace</p>
                <h1>Notifications</h1>
                <p>Get push notifications on this device, also while RAGPulse is closed. Tapping one opens its conversation, question or source. Each device has its own settings.</p>
            </div>
        </header>

        <UiCard title="This device">
            <div class="stack" style="--gap: 16px">
                <div v-if="!supported" class="notice" role="status">
                    <AlertTriangle :size="16" class="warn-icon" />
                    <p class="small">
                        <template v-if="ios">Add RAGPulse to your Home Screen first: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, and open it from there to turn notifications on.</template>
                        <template v-else>This browser does not support push notifications.</template>
                    </p>
                </div>
                <div v-else-if="permission === 'denied'" class="notice" role="alert">
                    <AlertTriangle :size="16" class="warn-icon" />
                    <p class="small">Notifications are blocked for RAGPulse. Allow them in the browser or system settings, then reload this page.</p>
                </div>

                <template v-if="supported">
                    <div v-if="loading" class="skeleton" style="height: 22px" />
                    <UiToggle
                        v-else
                        :model-value="!!events"
                        label="Notifications on this device"
                        :description="events ? 'Turned on' : 'Turn on to choose what to be notified about'"
                        :disabled="busy || permission === 'denied' || !available.length"
                        @update:model-value="toggleDevice"
                    />
                    <p v-if="!loading && !available.length" class="small muted">You don't have access to a project yet.</p>

                    <div v-if="events" class="events stack" style="--gap: 14px">
                        <UiToggle
                            v-for="e in available"
                            :key="e"
                            :model-value="events.includes(e)"
                            :label="PUSH_EVENT_INFO[e].label"
                            :description="PUSH_EVENT_INFO[e].description"
                            :disabled="busy"
                            @update:model-value="(on: boolean) => toggleEvent(e, on)"
                        />
                    </div>
                </template>
            </div>

            <template v-if="events" #footer>
                <UiButton size="sm" variant="secondary" :loading="testing" @click="sendTest"><Send :size="14" aria-hidden="true" /> Send test notification</UiButton>
            </template>
        </UiCard>
    </div>
</template>

<style scoped>
.notice {
    display: flex;
    gap: 10px;
    padding: 12px 14px;
    border-radius: var(--radius);
    border: 1px solid rgb(251 191 36 / 0.35);
    background: var(--warning-soft);
}
.warn-icon {
    color: var(--warning);
    flex-shrink: 0;
    margin-top: 1px;
}
.events {
    padding-top: 16px;
    border-top: 1px solid var(--border);
}
</style>
