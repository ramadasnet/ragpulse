// Logs which variables server/preload.ts loaded from Infisical (names only, never values).
export default defineNitroPlugin(() => {
  const loadedKeysJson = process.env[infisicalLoadedKeysEnv]
  delete process.env[infisicalLoadedKeysEnv]
  if (!loadedKeysJson) return
  try {
    const loadedKeys: unknown = JSON.parse(loadedKeysJson)
    if (Array.isArray(loadedKeys) && loadedKeys.every(key => typeof key === 'string')) {
      console.info(`[infisical] loaded keys: ${loadedKeys.join(', ') || '(none)'}`)
      return
    }
  } catch {}
  console.warn('[infisical] invalid loaded-key startup metadata')
})
