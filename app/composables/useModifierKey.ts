export function useModifierKey() {
    const key = ref("Ctrl")
    onMounted(() => {
        if (/Mac|iPhone|iPad|iPod/.test(navigator.userAgent)) key.value = "⌘"
    })
    return key
}
