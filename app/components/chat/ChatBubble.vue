<script setup lang="ts">
import {CircleAlert, Headset} from "lucide-vue-next"
import {DEFAULT_SUPPORT_DISPLAY_NAME} from "#shared/types"

const props = defineProps<{message: ChatUiMessage; botInitial: string; botIcon?: string; grouped?: boolean}>()

const typing = computed(() => props.message.streaming && !props.message.content)
const linkSources = computed(() => (props.message.sources || []).filter((s) => s.url && /^https?:\/\//i.test(s.url)))
</script>

<template>
    <div class="msg" :class="[`msg-${message.role}`, {grouped}]">
        <div v-if="message.role !== 'user'" class="who" aria-hidden="true">
            <span v-if="!grouped" class="who-mark" :class="{agent: message.role === 'agent', icon: message.role !== 'agent' && botIcon}">
                <Headset v-if="message.role === 'agent'" :size="14" />
                <img v-else-if="botIcon" :src="botIcon" alt="" />
                <template v-else>{{ botInitial }}</template>
            </span>
        </div>
        <div class="body">
            <p v-if="message.role === 'agent'" class="agent-label">
                <span class="agent-dot" /> <span class="agent-name">{{ message.supportName || DEFAULT_SUPPORT_DISPLAY_NAME }}</span>
            </p>
            <div class="bubble" :class="{error: !!message.error}">
                <span v-if="typing" class="typing" role="status" aria-label="Assistant is typing"><i /><i /><i /></span>
                <p v-else-if="message.error" class="err"><CircleAlert :size="15" /> {{ message.error }}</p>
                <p v-else-if="message.role === 'user'" class="plain">{{ message.content }}</p>
                <ChatMarkdown v-else :content="message.content" :streaming="message.streaming" />
                <ChatSources v-if="linkSources.length && !message.streaming && !message.error" :sources="linkSources" />
            </div>
            <slot />
        </div>
    </div>
</template>

<style scoped>
.msg {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    animation: rp-in 0.28s var(--ease) both;
}
.msg + .msg {
    margin-top: 14px;
}
.msg.grouped {
    margin-top: 6px;
}
.who {
    width: 28px;
    flex-shrink: 0;
}
.who-mark {
    width: 28px;
    height: 28px;
    border-radius: 9px;
    display: grid;
    place-items: center;
    font-size: 12.5px;
    font-weight: 700;
    background: linear-gradient(135deg, var(--c-accent), var(--c-accent2));
    color: var(--c-accent-ink);
}
.who-mark.icon {
    background: #fff;
    padding: 3px;
    box-shadow: inset 0 0 0 1px var(--c-border);
}
.who-mark img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}
.who-mark.agent {
    background: var(--c-highlight-soft);
    color: var(--c-highlight);
    box-shadow: inset 0 0 0 1px var(--c-highlight-soft);
}
.body {
    min-width: 0;
    max-width: min(86%, 560px);
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.bubble {
    padding: 10px 14px;
    border-radius: 16px;
    font-size: 14.5px;
    line-height: 1.55;
}
.msg-assistant .bubble,
.msg-agent .bubble {
    background: var(--c-surface);
    color: var(--c-text);
    border: 1px solid var(--c-border);
    box-shadow: var(--c-shadow);
    border-top-left-radius: 6px;
}
.msg-agent .bubble {
    border-left: 3px solid var(--c-highlight);
}
.msg-user {
    justify-content: flex-end;
}
.msg-user .body {
    align-items: flex-end;
}
.msg-user .bubble {
    background: var(--c-accent);
    color: var(--c-accent-ink);
    border-top-right-radius: 6px;
}
.plain {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0;
}
.bubble.error {
    background: var(--c-error-soft);
    border: 1px solid var(--c-error-border);
    color: var(--c-error);
}
.msg-agent .bubble.error {
    border-left: 3px solid var(--c-highlight);
}
.err {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin: 0;
    font-size: 13.5px;
}
.err svg {
    margin-top: 3px;
    flex-shrink: 0;
}

.agent-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--c-muted);
    letter-spacing: 0.02em;
    margin: 0;
}
.agent-dot {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--c-highlight);
}
.agent-name {
    overflow-wrap: anywhere;
}

.typing {
    display: inline-flex;
    gap: 4px;
    padding: 6px 2px;
}
.typing i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--c-muted);
    animation: rp-bounce 1.2s infinite var(--ease);
}
.typing i:nth-child(2) {
    animation-delay: 0.15s;
}
.typing i:nth-child(3) {
    animation-delay: 0.3s;
}
@keyframes rp-bounce {
    0%,
    60%,
    100% {
        transform: translateY(0);
        opacity: 0.45;
    }
    30% {
        transform: translateY(-4px);
        opacity: 1;
    }
}
@keyframes rp-in {
    from {
        opacity: 0;
        transform: translateY(6px);
    }
}
@media (prefers-reduced-motion: reduce) {
    .msg,
    .typing i {
        animation: none;
    }
}
</style>
