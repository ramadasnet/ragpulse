<script setup lang="ts">
import {Github} from "lucide-vue-next"
import {repositoryUrl} from "#shared/marketing"
</script>

<template>
    <footer class="foot">
        <div class="foot-in">
            <AppLogo />
            <a class="foot-github" :href="repositoryUrl" target="_blank" rel="noopener" aria-label="View RAGPulse on GitHub"><Github :size="20" aria-hidden="true" /></a>
        </div>
    </footer>
</template>

<style scoped>
.foot {
    margin-top: auto;
    border-top: 1px solid var(--border);
    background: var(--bg-elev);
}
.foot-in {
    max-width: 1080px;
    margin: 0 auto;
    padding: 44px 24px calc(44px + env(safe-area-inset-bottom, 0px));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
}
.foot-github {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    color: var(--text-muted);
    transition: color 0.15s var(--ease);
}
.foot-github:hover {
    color: var(--text);
}
@media (max-width: 720px) {
    .foot-in {
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 18px;
    }
}
</style>
