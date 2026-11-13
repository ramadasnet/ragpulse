/** Extracts a readable message from a $fetch / H3 error. */
export function errorMessage(err: any): string {
    return err?.data?.statusMessage || err?.data?.message || err?.statusMessage || err?.message || "Something went wrong"
}

/**
 * Wraps an async action with loading state and error toasts.
 * const { run, pending } = useAction(); await run(() => $fetch(...), 'Saved')
 */
export function useAction() {
    const pending = ref(false)
    const toast = useToast()
    async function run<T>(fn: () => Promise<T>, successMessage?: string): Promise<T | undefined> {
        pending.value = true
        try {
            const result = await fn()
            if (successMessage) toast.success(successMessage)
            return result
        } catch (err) {
            toast.error(errorMessage(err))
            return undefined
        } finally {
            pending.value = false
        }
    }
    return {run, pending}
}
