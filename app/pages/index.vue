<script setup lang="ts">
const {loggedIn} = useUserSession()
await navigateTo(loggedIn.value ? "/admin" : "/login", {replace: true})
</script>

<template>
    <div />
</template>
