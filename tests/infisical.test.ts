import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { loadInfisicalSecrets } from '../server/utils/infisical'

const settings = { RAGPULSE_INFISICAL_CLIENT_ID: 'client-id', RAGPULSE_INFISICAL_CLIENT_SECRET: 'client-secret', RAGPULSE_INFISICAL_PROJECT_ID: 'project-id' }

function secret(secretKey: string, secretValue: string) {
  return { secretKey, secretValue }
}

describe('Infisical secrets', () => {
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'))
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  test('does nothing without a client ID', async () => {
    expect(await loadInfisicalSecrets({ RAGPULSE_INFISICAL_PROJECT_ID: 'project-id' })).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('requires the client secret and project ID', async () => {
    await expect(loadInfisicalSecrets({ RAGPULSE_INFISICAL_CLIENT_ID: 'client-id', RAGPULSE_INFISICAL_PROJECT_ID: 'project-id' })).rejects.toThrow('RAGPULSE_INFISICAL_CLIENT_SECRET')
    await expect(loadInfisicalSecrets({ RAGPULSE_INFISICAL_CLIENT_ID: 'client-id', RAGPULSE_INFISICAL_CLIENT_SECRET: 'client-secret' })).rejects.toThrow('RAGPULSE_INFISICAL_PROJECT_ID')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('sets missing variables and keeps values that are already set', async () => {
    fetchSpy.mockResolvedValueOnce(Response.json({ accessToken: 'access-token' }))
    fetchSpy.mockResolvedValueOnce(
      Response.json({
        secrets: [secret('NUXT_APP_SECRET', 'direct'), secret('NUXT_MONGODB_URI', 'mongodb://infisical'), secret('NUXT_SMTP_PASS', 'smtp-password')],
        imports: [{ secrets: [secret('NUXT_APP_SECRET', 'imported'), secret('NUXT_OPENROUTER_API_KEY', 'imported')] }]
      })
    )
    const env: Record<string, string | undefined> = { ...settings, RAGPULSE_INFISICAL_ENVIRONMENT: 'staging', NUXT_MONGODB_URI: 'mongodb://local', NUXT_SMTP_PASS: '' }

    expect(await loadInfisicalSecrets(env)).toEqual(['NUXT_APP_SECRET', 'NUXT_OPENROUTER_API_KEY', 'NUXT_SMTP_PASS'])

    expect(env.NUXT_APP_SECRET).toBe('direct')
    expect(env.NUXT_OPENROUTER_API_KEY).toBe('imported')
    expect(env.NUXT_MONGODB_URI).toBe('mongodb://local')
    expect(env.NUXT_SMTP_PASS).toBe('smtp-password')
    expect(env.RAGPULSE_INFISICAL_CLIENT_SECRET).toBeUndefined()

    const [loginUrl, loginInit] = fetchSpy.mock.calls[0]!
    expect(String(loginUrl)).toBe('https://app.infisical.com/api/v1/auth/universal-auth/login')
    expect(JSON.parse(String(loginInit?.body))).toEqual({ clientId: 'client-id', clientSecret: 'client-secret' })
    const [secretsUrl, secretsInit] = fetchSpy.mock.calls[1]!
    const url = new URL(String(secretsUrl))
    expect(url.pathname).toBe('/api/v4/secrets')
    expect(Object.fromEntries(url.searchParams)).toEqual({ projectId: 'project-id', environment: 'staging', secretPath: '/' })
    expect(new Headers(secretsInit?.headers).get('Authorization')).toBe('Bearer access-token')
  })

  test('fails when Infisical rejects the request', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Invalid credentials', { status: 401 }))

    await expect(loadInfisicalSecrets({ ...settings })).rejects.toThrow('Infisical login failed: 401 Invalid credentials')
  })
})
