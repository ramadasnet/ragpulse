<script setup lang="ts">
definePageMeta({layout: "blank"})
useHead({title: "Sign in · RAGPulse"})

const route = useRoute()
const {loggedIn} = useUserSession()
// Admin page to open after signing in, kept in a short-lived cookie across the OAuth round trip (read by the login handler)
const redirect = String(route.query.redirect || "")
const target = isAdminPath(redirect) ? redirect : "/admin"
if (loggedIn.value) await navigateTo(target)
// A failed sign-in comes back with only `error`: the pending target is kept for the retry
if (!route.query.error) useCookie(LOGIN_REDIRECT_COOKIE, {path: "/", maxAge: 600, sameSite: "lax"}).value = target === "/admin" ? null : target

const errors: Record<string, string> = {
    not_invited: "This account has not been invited. Ask an admin to add your email.",
    disabled: "Your account has been disabled.",
    oauth: "Sign in failed. Please try again.",
    no_email: "Your account did not provide an email address.",
    unverified: "Your email address is not verified.",
    provider_mismatch: "This email is linked to a different account on that provider."
}
const error = computed(() => errors[String(route.query.error || "")] || (route.query.error ? "Sign in failed." : ""))

const {data: providerData} = await useFetch("/auth/providers")
// If the check cannot be loaded, show both buttons rather than locking the page
const providers = computed(() => providerData.value ?? {google: true, microsoft: true})
</script>

<template>
    <div class="login">
        <div class="glow" aria-hidden="true" />
        <div class="card panel fade-in">
            <AppLogo />
            <div class="stack" style="--gap: 6px">
                <h1>Admin section</h1>
                <p class="muted">Sign in to manage your RAGPulse projects.</p>
            </div>
            <p v-if="error" class="alert" role="alert">{{ error }}</p>
            <div class="stack" style="--gap: 10px">
                <a v-if="providers.google" href="/auth/google" class="provider">
                    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                    </svg>
                    Continue with Google
                </a>
                <a v-if="providers.microsoft" href="/auth/microsoft" class="provider">
                    <svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true">
                        <path fill="#f35325" d="M1 1h10v10H1z" />
                        <path fill="#81bc06" d="M12 1h10v10H12z" />
                        <path fill="#05a6f0" d="M1 12h10v10H1z" />
                        <path fill="#ffba08" d="M12 12h10v10H12z" />
                    </svg>
                    Continue with Microsoft
                </a>
                <p v-if="!providers.google && !providers.microsoft" class="muted">No sign-in provider is configured on this instance.</p>
            </div>
        </div>
    </div>
</template>

<style scoped>
.login {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 24px;
    position: relative;
    overflow: hidden;
}
.glow {
    position: absolute;
    width: 640px;
    height: 640px;
    border-radius: 50%;
    background: radial-gradient(circle, rgb(163 255 122 / 0.1), transparent 60%);
    top: -260px;
    right: -200px;
    pointer-events: none;
}
.card {
    width: 100%;
    max-width: 380px;
    padding: 32px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    position: relative;
    box-shadow: var(--shadow-lg);
}
.provider {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 44px;
    border-radius: var(--radius);
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    font-weight: 500;
    transition:
        background 0.15s var(--ease),
        border-color 0.15s;
}
.provider:hover {
    background: var(--surface-3);
    border-color: #3a4150;
}
.alert {
    background: var(--danger-soft);
    color: var(--danger);
    border-radius: var(--radius);
    padding: 10px 12px;
    font-size: 13px;
}
</style>
