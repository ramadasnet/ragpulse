import {z} from "zod"
import {PUSH_EVENTS} from "#shared/types"
import logger from "../../../utils/logger"

const MAX_DEVICES_PER_USER = 20
/** Subscription keys: base64url, some browsers pad them */
const BASE64URL = /^[\w-]+={0,2}$/

const bodySchema = z.object({
    endpoint: z.url({protocol: /^https$/}).max(2000),
    keys: z.object({p256dh: z.string().regex(BASE64URL).max(200), auth: z.string().regex(BASE64URL).max(100)}),
    events: z.array(z.enum(PUSH_EVENTS)).max(PUSH_EVENTS.length)
})

/** Saves the push subscription of the current device with the notifications it wants. */
export default defineEventHandler(async (event) => {
    const user = await requireUser(event)
    const parsed = bodySchema.safeParse(await readBody(event).catch(() => null))
    if (!parsed.success) throw createError({statusCode: 400, statusMessage: parsed.error.issues[0]?.message || "Invalid subscription"})
    const {endpoint, keys} = parsed.data
    const events = [...new Set(parsed.data.events)]

    const {pushDevices} = await useCollections()
    const _id = sha256(endpoint)
    const now = new Date()
    // The device may have belonged to another user who signed in on it before
    const res = await pushDevices.updateOne({_id}, {$set: {userId: user._id, endpoint, keys, events, userAgent: getRequestHeader(event, "user-agent")?.slice(0, 300), updatedAt: now}, $setOnInsert: {createdAt: now}}, {upsert: true})
    if (res.upsertedCount) {
        // Browsers re-subscribe with a new endpoint from time to time: drop the oldest devices beyond the limit
        const stale = await pushDevices
            .find({userId: user._id}, {projection: {_id: 1}})
            .sort({updatedAt: -1})
            .skip(MAX_DEVICES_PER_USER)
            .toArray()
        if (stale.length) await pushDevices.deleteMany({_id: {$in: stale.map((d) => d._id)}})
        logger.info("Push.devices", `Device ${_id}`, `User ${user.email}`, `Subscribed to ${events.join(", ") || "nothing"}`)
    }
    return {_id, events}
})
