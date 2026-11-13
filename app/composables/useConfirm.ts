interface ConfirmState {
    open: boolean
    title: string
    message: string
    confirmLabel: string
    danger: boolean
}

let resolver: ((v: boolean) => void) | null = null

/** Promise based confirm dialog: `if (await confirm({ title, message, danger: true })) ...` */
export function useConfirm() {
    const state = useState<ConfirmState>("confirm", () => ({open: false, title: "", message: "", confirmLabel: "Confirm", danger: false}))
    function confirm(opts: {title: string; message: string; confirmLabel?: string; danger?: boolean}): Promise<boolean> {
        resolver?.(false)
        state.value = {open: true, title: opts.title, message: opts.message, confirmLabel: opts.confirmLabel || "Confirm", danger: !!opts.danger}
        return new Promise((resolve) => {
            resolver = resolve
        })
    }
    function resolve(value: boolean) {
        state.value = {...state.value, open: false}
        resolver?.(value)
        resolver = null
    }
    return {state, confirm, resolve}
}
