// Passed to Bun with --preload by the dev, start and Docker commands, so secrets are set before the runtime config is read.
// A parent process may have already loaded the secrets and passed them down in the environment
// (`nuxt dev` forks the dev server as a child); the loaded-keys marker makes the preload idempotent.
import { infisicalLoadedKeysEnv, loadInfisicalSecrets } from './utils/infisical'

if (!process.env[infisicalLoadedKeysEnv]) {
  const loadedKeys = await loadInfisicalSecrets()
  if (process.env.RAGPULSE_INFISICAL_CLIENT_ID) {
    process.env[infisicalLoadedKeysEnv] = JSON.stringify(loadedKeys)
  }
}
