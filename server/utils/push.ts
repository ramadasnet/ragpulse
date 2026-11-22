// Web Push notifications of the admin PWA (RFC 8030 delivery, RFC 8291 payload encryption, RFC 8292 VAPID).
// The VAPID key pair is generated on first use and stored in the `settings` collection, so the admin and chat
// instances sign with the same key. Both instances send: the chat instance for conversations and escalations,
// the admin instance (scheduler) for knowledge syncs.
import {createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign} from "node:crypto"
import type {PushDevice, PushEvent} from "#shared/types"
import {PUSH_EVENT_INFO} from "../../shared/types"
import logger from "./logger"

const VAPID_ID = "vapid"
/** Lifetime of the VAPID token (push services accept up to 24 hours) */
const VAPID_TOKEN_SECONDS = 12 * 3600
const PUSH_TIMEOUT_MS = 10_000
/** Record size of the encrypted body: the payload must stay below it (texts are truncated well before) */
const RECORD_SIZE = 4096
const BODY_MAX_CHARS = 180

interface VapidDoc {
    _id: string
    /** Uncompressed P-256 public key (65 bytes), base64url: the `applicationServerKey` of browser subscriptions */
    publicKey: string
    /** Private scalar `d` of the key, base64url */
    privateKey: string
    createdAt: Date
}

export interface PushMessage {
    title: string
    body: string
    /** Admin path opened when the notification is tapped */
    url: string
    /** Notifications with the same tag replace each other on the device */
    tag?: string
    /** Stays on screen until dismissed and asks the push service for immediate delivery */
    priority?: boolean
}

let vapidPromise: Promise<VapidDoc> | null = null

/** The VAPID key pair shared by all instances, created on first use. */
export function getVapidKeys(): Promise<VapidDoc> {
    if (!vapidPromise) {
        vapidPromise = loadVapidKeys().catch((err) => {
            vapidPromise = null
            throw err
        })
    }
    return vapidPromise
}

async function loadVapidKeys(): Promise<VapidDoc> {
    const settings = (await useDb()).collection<VapidDoc>("settings")
    const existing = await settings.findOne({_id: VAPID_ID})
    if (existing) return existing
    const jwk = generateKeyPairSync("ec", {namedCurve: "prime256v1"}).privateKey.export({format: "jwk"})
    const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64url")
    try {
        // Another instance may create the keys at the same time: the first one wins
        await settings.updateOne({_id: VAPID_ID}, {$setOnInsert: {publicKey, privateKey: jwk.d!, createdAt: new Date()}}, {upsert: true})
    } catch (err: any) {
        if (err?.code !== 11000) throw err
    }
    const stored = await settings.findOne({_id: VAPID_ID})
    if (!stored) throw new Error("VAPID keys could not be stored")
    logger.info("Push.vapid", "Created the Web Push key pair")
    return stored
}

/** `Authorization` header value for a push endpoint, signed with the VAPID key (RFC 8292). */
export function vapidAuthorization(endpoint: string, keys: Pick<VapidDoc, "publicKey" | "privateKey">, subject: string, now = Date.now()): string {
    const pub = Buffer.from(keys.publicKey, "base64url")
    const key = createPrivateKey({key: {kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33, 65).toString("base64url"), d: keys.privateKey}, format: "jwk"})
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
    const unsigned = `${encode({typ: "JWT", alg: "ES256"})}.${encode({aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + VAPID_TOKEN_SECONDS, sub: subject})}`
    const signature = sign("sha256", Buffer.from(unsigned), {key, dsaEncoding: "ieee-p1363"}).toString("base64url")
    return `vapid t=${unsigned}.${signature}, k=${keys.publicKey}`
}

/** Encrypts a payload for a subscription with `aes128gcm` content encoding (RFC 8291), as a single record. */
export function encryptPushPayload(payload: string, subscriptionKeys: PushDevice["keys"], salt = randomBytes(16), serverPrivateKey?: Buffer): Buffer {
    const clientPublic = Buffer.from(subscriptionKeys.p256dh, "base64url")
    const authSecret = Buffer.from(subscriptionKeys.auth, "base64url")
    // A new ephemeral key per message (fixed only by tests)
    const ecdh = createECDH("prime256v1")
    if (serverPrivateKey) ecdh.setPrivateKey(serverPrivateKey)
    const serverPublic = serverPrivateKey ? ecdh.getPublicKey() : ecdh.generateKeys()
    const shared = ecdh.computeSecret(clientPublic)
    const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), clientPublic, serverPublic]), 32))
    const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16))
    const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12))
    const cipher = createCipheriv("aes-128-gcm", cek, nonce)
    // 0x02 delimits the last (and only) record, without padding
    const encrypted = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])
    const header = Buffer.alloc(21)
    salt.copy(header, 0)
    header.writeUInt32BE(RECORD_SIZE, 16)
    header.writeUInt8(serverPublic.length, 20)
    return Buffer.concat([header, serverPublic, encrypted])
}

/** Contact of the VAPID token: push services (Apple) require an https URL or a mailto: address. */
function vapidSubject(): string {
    const config = useRuntimeConfig()
    const adminUrl = String(config.public.adminUrl || "")
    if (adminUrl.startsWith("https://")) return new URL(adminUrl).origin
    const email = String(config.adminEmails || "")
        .split(",")
        .map((e) => e.trim())
        .find(Boolean)
    return `mailto:${email || "admin@ragpulse.local"}`
}

/** Sends one notification to a device. Returns the push service's HTTP status. */
export async function sendPush(device: Pick<PushDevice, "endpoint" | "keys">, message: PushMessage): Promise<number> {
    const keys = await getVapidKeys()
    const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
    const payload = JSON.stringify({...message, title: truncate(message.title.replace(/\s+/g, " "), 100), body: truncate(message.body.replace(/\s+/g, " ").trim(), BODY_MAX_CHARS)})
    const res = await safeFetch(
        device.endpoint,
        {
            method: "POST",
            headers: {
                Authorization: vapidAuthorization(device.endpoint, keys, vapidSubject()),
                "Content-Encoding": "aes128gcm",
                "Content-Type": "application/octet-stream",
                // Undelivered notifications expire: a stale "new conversation" a day later is noise
                TTL: String(message.priority ? 24 * 3600 : 3600),
                Urgency: message.priority ? "high" : "normal"
            },
            body: new Uint8Array(encryptPushPayload(payload, device.keys)),
            signal: AbortSignal.timeout(PUSH_TIMEOUT_MS)
        },
        "Push endpoint",
        {sameOriginOnly: true}
    )
    await res.body?.cancel().catch(() => {})
    return res.status
}

/** Sends to one device and removes its subscription when the push service says it is gone. Never throws. */
async function deliver(device: PushDevice, message: PushMessage): Promise<boolean> {
    try {
        const status = await sendPush(device, message)
        if (status === 404 || status === 410) {
            const {pushDevices} = await useCollections()
            await pushDevices.deleteOne({_id: device._id})
            logger.info("Push.send", `Device ${device._id}`, `User ${device.userId}`, "Subscription expired, removed")
            return false
        }
        if (status >= 300) logger.warn("Push.send", `Device ${device._id}`, `${urlForLog(device.endpoint)} returned ${status}`)
        return status < 300
    } catch (err: any) {
        logger.warn("Push.send", `Device ${device._id}`, `Delivery to ${urlForLog(device.endpoint)} failed`, err)
        return false
    }
}

/**
 * Notifies every device subscribed to `event` whose (enabled) user has the event's permission on the project.
 * Never throws: call it fire-and-forget so a slow push service can't delay the request.
 */
export async function notifyProject(projectId: string, event: PushEvent, message: PushMessage): Promise<void> {
    try {
        const {pushDevices, users} = await useCollections()
        const devices = await pushDevices.find({events: event}).toArray()
        if (!devices.length) return
        const recipients = await users.find({_id: {$in: [...new Set(devices.map((d) => d.userId))]}, disabled: {$ne: true}}).toArray()
        const allowed = new Set(recipients.filter((u) => hasProjectPermission(u, projectId, PUSH_EVENT_INFO[event].permission)).map((u) => u._id))
        const targets = devices.filter((d) => allowed.has(d.userId))
        if (!targets.length) return
        const sent = (await Promise.all(targets.map((d) => deliver(d, message)))).filter(Boolean).length
        logger.info("Push.notify", `Project ${projectId}`, `Event ${event}`, `Sent to ${sent}/${targets.length} device(s)`)
    } catch (err: any) {
        logger.warn("Push.notify", `Project ${projectId}`, `Event ${event} failed`, err)
    }
}
