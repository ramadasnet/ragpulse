/** Names only the sign-in providers that are configured. */
export function signInProviderNames(providers?: {google: boolean; microsoft: boolean} | null): string {
    return [providers?.google && "Google", providers?.microsoft && "Microsoft"].filter(Boolean).join(" or ")
}
