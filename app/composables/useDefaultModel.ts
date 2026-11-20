/** The default chat model of the Global Settings, used by projects without a model of their own (empty while loading). */
export function useDefaultModel() {
    const {data} = useFetch<{model: string}>("/api/models/default", {server: false})
    return computed(() => data.value?.model ?? "")
}
