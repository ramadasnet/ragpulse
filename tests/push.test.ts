import {expect, test} from "bun:test"
import {createDecipheriv, createECDH, createPublicKey, generateKeyPairSync, hkdfSync, verify} from "node:crypto"
import {encryptPushPayload, vapidAuthorization} from "../server/utils/push"

const b64 = (value: string) => Buffer.from(value, "base64url")

test("payload encryption matches the RFC 8291 example", () => {
    const body = encryptPushPayload(
        "When I grow up, I want to be a watermelon",
        {p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg"},
        b64("DGv6ra1nlYgDCS1FRnbzlw"),
        b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")
    )
    expect(body.toString("base64url")).toBe("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")
})

test("an encrypted payload decrypts with the subscription's private key", () => {
    const client = createECDH("prime256v1")
    const clientPublic = client.generateKeys()
    const auth = Buffer.from("0123456789abcdef")
    const payload = JSON.stringify({title: "Escalated question · Docs", body: "Ana: Where is my order? ✓", url: "/admin/projects/p/questions?q=q"})
    const body = encryptPushPayload(payload, {p256dh: clientPublic.toString("base64url"), auth: auth.toString("base64url")})

    const salt = body.subarray(0, 16)
    expect(body.readUInt32BE(16)).toBe(4096)
    const serverPublic = body.subarray(21, 21 + body.readUInt8(20))
    const ikm = Buffer.from(hkdfSync("sha256", client.computeSecret(serverPublic), auth, Buffer.concat([Buffer.from("WebPush: info\0"), clientPublic, serverPublic]), 32))
    const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16))
    const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12))
    const encrypted = body.subarray(21 + serverPublic.length)
    const decipher = createDecipheriv("aes-128-gcm", cek, nonce)
    decipher.setAuthTag(encrypted.subarray(-16))
    const plain = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()])
    expect(plain.at(-1)).toBe(2)
    expect(plain.subarray(0, -1).toString()).toBe(payload)
})

test("the VAPID header carries a valid ES256 token for the push service origin", () => {
    const jwk = generateKeyPairSync("ec", {namedCurve: "prime256v1"}).privateKey.export({format: "jwk"})
    const publicKey = Buffer.concat([Buffer.from([4]), b64(jwk.x!), b64(jwk.y!)]).toString("base64url")
    const now = Date.UTC(2026, 10, 22)
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", {publicKey, privateKey: jwk.d!}, "mailto:admin@example.com", now)

    const match = header.match(/^vapid t=([^,]+), k=(.+)$/)
    expect(match?.[2]).toBe(publicKey)
    const [head, claims, signature] = match![1]!.split(".")
    expect(JSON.parse(b64(head!).toString())).toEqual({typ: "JWT", alg: "ES256"})
    expect(JSON.parse(b64(claims!).toString())).toEqual({aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 3600, sub: "mailto:admin@example.com"})
    const key = createPublicKey({key: {kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y}, format: "jwk"})
    expect(verify("sha256", Buffer.from(`${head}.${claims}`), {key, dsaEncoding: "ieee-p1363"}, b64(signature!))).toBe(true)
})
