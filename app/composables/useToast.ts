export interface Toast {
    id: number
    message: string
    tone: "success" | "error" | "info"
}

let counter = 0

export function useToast() {
    const toasts = useState<Toast[]>("toasts", () => [])
    function dismiss(id: number) {
        toasts.value = toasts.value.filter((t) => t.id !== id)
    }
    function push(message: string, tone: Toast["tone"] = "info", ms = 3500) {
        const id = ++counter
        toasts.value = [...toasts.value, {id, message, tone}]
        if (import.meta.client) setTimeout(() => dismiss(id), ms)
    }
    return {
        toasts,
        dismiss,
        success: (m: string) => push(m, "success"),
        error: (m: string) => push(m, "error", 6000),
        info: (m: string) => push(m, "info")
    }
}
