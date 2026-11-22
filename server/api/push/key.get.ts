// Public VAPID key the browser subscribes with (`applicationServerKey`)
export default defineEventHandler(async (event) => {
    await requireUser(event)
    return {publicKey: (await getVapidKeys()).publicKey}
})
