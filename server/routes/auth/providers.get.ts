// Which social login buttons the login page may show (booleans only, no credentials are exposed)
export default defineEventHandler((event) => configuredSignInProviders(useRuntimeConfig(event).oauth))
