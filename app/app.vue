<template>
    <NuxtLayout>
        <NuxtPage />
    </NuxtLayout>
    <ClientOnly>
        <UiToaster />
        <UiConfirm />
    </ClientOnly>
</template>
<script setup lang="ts">
// The admin dashboard is installable as a PWA. The combined (development) build also serves the public chat and
// landing pages through this component, so the manifest is only advertised outside those routes.
const route = useRoute()
const installable = computed(() => !route.path.startsWith("/chat/") && route.path !== "/landing")

useHead({
    link: computed(() =>
        installable.value
            ? [
                  {rel: "manifest", href: "/manifest.webmanifest"},
                  {rel: "apple-touch-icon", href: "/apple-touch-icon.png"}
              ]
            : []
    )
})
</script>
