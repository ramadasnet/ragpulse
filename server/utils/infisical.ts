// Load secrets from an Infisical project into the environment at process startup.
// Runs from server/preload.ts, outside the Nitro bundle, so it must not depend on Nitro or Nuxt.

interface InfisicalSecret {
    secretKey: string
    secretValue: string
}

export const infisicalLoadedKeysEnv = "RAGPULSE_INFISICAL_LOADED_KEYS"

/**
 * Copies the secrets of an Infisical environment into env, without replacing variables that already have a value.
 * Does nothing unless RAGPULSE_INFISICAL_CLIENT_ID is set.
 * @param env Environment to read the Infisical settings from and to write the secrets to.
 * @returns Keys of the variables that were set.
 */
export async function loadInfisicalSecrets(env: Record<string, string | undefined> = process.env): Promise<string[]> {
    const {RAGPULSE_INFISICAL_CLIENT_ID: clientId, RAGPULSE_INFISICAL_CLIENT_SECRET: clientSecret, RAGPULSE_INFISICAL_PROJECT_ID: projectId} = env
    if (!clientId) {
        return []
    }
    if (!clientSecret || !projectId) {
        throw new Error("RAGPULSE_INFISICAL_CLIENT_SECRET and RAGPULSE_INFISICAL_PROJECT_ID are required when RAGPULSE_INFISICAL_CLIENT_ID is set")
    }
    const siteUrl = env.RAGPULSE_INFISICAL_SITE_URL || "https://app.infisical.com"

    const login = await fetch(new URL("/api/v1/auth/universal-auth/login", siteUrl), {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({clientId, clientSecret}),
        signal: AbortSignal.timeout(10_000)
    })
    if (!login.ok) {
        throw new Error(`Infisical login failed: ${login.status} ${await login.text()}`)
    }
    const {accessToken} = (await login.json()) as {accessToken: string}

    const query = new URLSearchParams({projectId, environment: env.RAGPULSE_INFISICAL_ENVIRONMENT || "prod", secretPath: env.RAGPULSE_INFISICAL_SECRET_PATH || "/"})
    const response = await fetch(new URL(`/api/v4/secrets?${query}`, siteUrl), {headers: {Authorization: `Bearer ${accessToken}`}, signal: AbortSignal.timeout(10_000)})
    if (!response.ok) {
        throw new Error(`Infisical secrets request failed: ${response.status} ${await response.text()}`)
    }
    const {secrets, imports = []} = (await response.json()) as {secrets: InfisicalSecret[]; imports?: {secrets: InfisicalSecret[]}[]}

    // Secrets defined in the path itself come last, so they win over imported ones.
    const values = new Map([...imports.flatMap((item) => item.secrets), ...secrets].map((secret) => [secret.secretKey, secret.secretValue]))
    const loadedKeys: string[] = []
    for (const [key, value] of values) {
        if (!env[key]) {
            env[key] = value
            loadedKeys.push(key)
        }
    }
    delete env.RAGPULSE_INFISICAL_CLIENT_SECRET

    return loadedKeys
}
