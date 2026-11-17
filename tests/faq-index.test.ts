import {describe, expect, test} from "bun:test"
import {faqTextToMarkdown} from "../server/utils/faq-index"

describe("faqTextToMarkdown", () => {
    test("keeps plain text and markdown untouched", () => {
        expect(faqTextToMarkdown("How do I pay? Card, PayPal or transfer.")).toBe("How do I pay? Card, PayPal or transfer.")
        expect(faqTextToMarkdown("Use **this** when a < b")).toBe("Use **this** when a < b")
        expect(faqTextToMarkdown("Returns a <promise>")).toBe("Returns a <promise>")
    })

    test("converts HTML fragments to markdown", () => {
        expect(faqTextToMarkdown("<p>Yes, we ship to the <b>EU</b>.</p><ul><li>3–5 days</li></ul>")).toBe("Yes, we ship to the **EU**.\n\n-   3–5 days")
        expect(faqTextToMarkdown('Pay <a href="https://x.dev/pay">online</a> or call us')).toBe("Pay [online](https://x.dev/pay) or call us")
        expect(faqTextToMarkdown("Open <strong>Settings</strong>, then <code>Save</code>")).toBe("Open **Settings**, then `Save`")
    })

    test("leaves tags inside code untouched and converts the rest", () => {
        expect(faqTextToMarkdown("Use `<b>` for bold.")).toBe("Use `<b>` for bold.")
        expect(faqTextToMarkdown("<p>Use <b>x</b> and `<i>y</i>`</p>")).toBe("Use **x** and `<i>y</i>`")
        expect(faqTextToMarkdown("a <style>p{}</style> b <b>c</b>")).toBe("a  b **c**")
    })

    test("decodes entities and drops comments", () => {
        expect(faqTextToMarkdown("Fish &amp; Chips <!-- note -->")).toBe("Fish & Chips")
    })

    test("keeps the original when the conversion would leave nothing", () => {
        const form = "<form><input type='text'></form>"
        expect(faqTextToMarkdown(form)).toBe(form)
    })
})
