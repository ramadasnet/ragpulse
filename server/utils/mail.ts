import nodemailer, {type Transporter} from "nodemailer"
import logger from "./logger"

const cloudflareSmtpHost = "smtp.mx.cloudflare.net"

let transporter: Transporter | null | undefined
let sender = ""

/** SMTP settings, defaulting to Cloudflare Email Service. Empty values (e.g. `NUXT_SMTP_HOST=` in .env) use the defaults. */
function getSmtpSettings() {
    const {smtp, public: pub} = useRuntimeConfig()
    const host = String(smtp.host || cloudflareSmtpHost)
    const port = Number(smtp.port) || 465
    const secureSetting = String(smtp.secure ?? "")
    const user = String(smtp.user || "api_token")
    const pass = String(smtp.pass || "")
    return {
        host,
        port,
        // Port 465 uses implicit TLS, other ports STARTTLS, unless NUXT_SMTP_SECURE is set
        secure: secureSetting === "" ? port === 465 : secureSetting === "true",
        user,
        pass,
        from: String(smtp.from || (user.includes("@") ? `${pub.appName} <${user}>` : ""))
    }
}

function getTransporter(): Transporter | null {
    if (transporter !== undefined) return transporter
    const smtp = getSmtpSettings()
    // Cloudflare needs the API token as password; other servers may accept mail without authentication
    if (!smtp.from || (!smtp.pass && smtp.host === cloudflareSmtpHost)) {
        transporter = null
        return null
    }
    sender = smtp.from
    transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.pass ? {user: smtp.user, pass: smtp.pass} : undefined
    })
    return transporter
}

export function isMailConfigured(): boolean {
    return !!getTransporter()
}

export interface MailOptions {
    to: string
    subject: string
    text: string
    html?: string
    replyTo?: string
}

/** Sends an email. Returns false (and logs) when SMTP is not configured or sending fails. */
export async function sendMail(opts: MailOptions): Promise<boolean> {
    const t = getTransporter()
    if (!t) {
        logger.warn("Mailer.send", "SMTP not configured, skipping email", opts.to, opts.subject)
        return false
    }
    try {
        await t.sendMail({
            from: sender,
            to: opts.to,
            subject: opts.subject,
            text: opts.text,
            html: opts.html,
            replyTo: opts.replyTo
        })
        return true
    } catch (err: any) {
        logger.error("Mailer.send", `Failed sending to ${opts.to}`, opts.subject, err)
        return false
    }
}

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]!)
}

/** Absolute URL for a path on the admin or chat instance (NUXT_PUBLIC_ADMIN_URL / NUXT_PUBLIC_CHAT_URL). */
export function publicUrl(app: "admin" | "chat", path: string): string {
    const {adminUrl, chatUrl} = useRuntimeConfig().public
    const base = String((app === "admin" ? adminUrl : chatUrl) || "").replace(/\/$/, "")
    return `${base}${path}`
}
