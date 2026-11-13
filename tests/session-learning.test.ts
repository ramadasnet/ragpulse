import {describe, expect, test} from "bun:test"
import {parseLearnedFaq, sanitizeFaqText} from "../server/utils/session-learning"

const session = {visitorName: "Jane Doe", visitorEmail: "jane@example.com"}

describe("sanitizeFaqText", () => {
    test("removes the visitor's name and email verbatim", () => {
        const out = sanitizeFaqText("Jane Doe asked; reply to jane@example.com about it", session)
        expect(out).not.toContain("Jane Doe")
        expect(out).not.toContain("jane@example.com")
        expect(out).toContain("the visitor")
    })

    test("removes other emails but keeps the project support email", () => {
        const out = sanitizeFaqText("Write to bob@acme.com or support@acme.com", session, "support@acme.com")
        expect(out).not.toContain("bob@acme.com")
        expect(out).toContain("support@acme.com")
    })

    test("removes card-like digit runs, phone numbers and tokens", () => {
        const out = sanitizeFaqText("card 4111 1111 1111 1111, phone +49 151 2345678, jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc12345def.sig9987xy", session)
        expect(out).not.toContain("4111")
        expect(out).not.toContain("2345678")
        expect(out).not.toContain("eyJ")
    })

    test("keeps version numbers and ordinary text", () => {
        const out = sanitizeFaqText("Requires Node 20.11.1 and a stable connection", session)
        expect(out).toContain("20.11.1")
        expect(out).toContain("stable connection")
    })
})

describe("parseLearnedFaq", () => {
    test("parses a plain JSON object", () => {
        expect(parseLearnedFaq('{"question": "How do I reset?", "answer": "Use Settings"}')).toEqual({question: "How do I reset?", answer: "Use Settings"})
    })

    test("parses JSON wrapped in prose or fences", () => {
        expect(parseLearnedFaq('Sure!\n```json\n{"question": "Q?", "answer": "A"}\n```')?.question).toBe("Q?")
    })

    test("parses a skip reply", () => {
        expect(parseLearnedFaq('{"skip": "personal account issue"}')).toEqual({skip: "personal account issue"})
    })

    test("returns null for non-JSON output", () => {
        expect(parseLearnedFaq("I cannot summarize this")).toBeNull()
    })
})
