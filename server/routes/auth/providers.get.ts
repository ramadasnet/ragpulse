// Which social login buttons the login page may show (booleans only, no credentials are exposed)
export default defineEventHandler(() => {
    const oauth: any = useRuntimeConfig().oauth || {}
    return {
        google: !!(oauth.google?.clientId && oauth.google?.clientSecret),
        microsoft: !!(oauth.microsoft?.clientId && oauth.microsoft?.clientSecret)
    }
})
