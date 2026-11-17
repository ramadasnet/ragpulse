import {describe, expect, test} from "bun:test"
import {faqListFrom, jsObjectToJson, parseFaqJson, stripJsonComments} from "../shared/utils/faq-import"

describe("stripJsonComments", () => {
    test("removes line and block comments but keeps // inside strings", () => {
        const input = `// top comment
[
    {"question": "See https://a.dev/x?", "answer": "A /* not a comment */ B"}, // trailing
    /* block
       spanning lines */
    {"question": "Q2 // kept", "answer": "A2"}
]`
        expect(JSON.parse(stripJsonComments(input))).toHaveLength(2)
    })

    test("keeps escaped quotes and handles unterminated comments", () => {
        expect(stripJsonComments('{"q": "a \\"//\\" b"}')).toBe('{"q": "a \\"//\\" b"}')
        expect(JSON.parse(stripJsonComments("[1] // never closed"))).toEqual([1])
        expect(JSON.parse(stripJsonComments("[1] /* never closed"))).toEqual([1])
    })
})

describe("jsObjectToJson", () => {
    test("quotes unquoted keys and converts single-quoted strings", () => {
        expect(JSON.parse(jsObjectToJson(`[{question: 'Q1', answer: 'A1'}, {q: "Q2", a: 'A2 "quoted"'}]`))).toEqual([
            {question: "Q1", answer: "A1"},
            {q: "Q2", a: 'A2 "quoted"'}
        ])
    })

    test("drops trailing commas and normalizes JS values", () => {
        expect(jsObjectToJson(`{a: 1, b: undefined, c: NaN, d: .5, e: 0x10, f: +2, g: null,}`)).toBe(`{"a": 1, "b": null, "c": null, "d": 0.5, "e": 16, "f": 2, "g": null}`)
    })

    test("handles escapes in single-quoted strings and bare words", () => {
        expect(JSON.parse(jsObjectToJson(`[{k: 'a \\'b\\' c \\\\x41 \\u0042', v: shipping}]`))).toEqual([{k: `a 'b' c \\x41 B`, v: "shipping"}])
    })

    test("keeps strings containing commas and brackets intact", () => {
        expect(JSON.parse(jsObjectToJson(`[{question: "a, ]b", answer: 'x, }y',}]`))).toEqual([{question: "a, ]b", answer: "x, }y"}])
    })
})

describe("faqListFrom", () => {
    test("accepts a top-level array, a wrapper field and a single object", () => {
        expect(faqListFrom([{q: "a"}])).toHaveLength(1)
        expect(faqListFrom({items: [{q: "a"}], total: 5})).toHaveLength(1)
        expect(faqListFrom({faqs: [{q: "a"}]})).toHaveLength(1)
        expect(faqListFrom({question: "q", answer: "a", tags: ["x"]})).toHaveLength(1)
        expect(faqListFrom({other: "x"})).toHaveLength(0)
        expect(faqListFrom("text")).toHaveLength(0)
    })
})

describe("parseFaqJson", () => {
    test("ignores extra fields and matches field names case-insensitively", () => {
        const {items, invalid} = parseFaqJson(`[
            {"Question": "Q1", "Answer": "A1", "category": "shipping"},
            {"q": "Q2", "a": "A2", "id": 7},
            {"question": "Q3", "answer": "A3"},
            {"question": "", "answer": "missing question"},
            {"note": "no fields"}
        ]`)
        expect(items).toEqual([
            {question: "Q1", answer: "A1"},
            {question: "Q2", answer: "A2"},
            {question: "Q3", answer: "A3"}
        ])
        expect(invalid).toBe(2)
    })

    test("parses JSON with comments", () => {
        const {items, invalid} = parseFaqJson(`// FAQ export
        {"items": [{"question": "Q", "answer": "A /* kept */"}]}`)
        expect(items).toEqual([{question: "Q", answer: "A /* kept */"}])
        expect(invalid).toBe(0)
    })

    test("keeps comment markers inside single-quoted and template strings", () => {
        const {items} = parseFaqJson("[{question: 'Q', answer: 'See https://x.dev/a /* kept */'}, {q: `Q2`, a: `//kept`}]")
        expect(items).toEqual([
            {question: "Q", answer: "See https://x.dev/a /* kept */"},
            {question: "Q2", answer: "//kept"}
        ])
    })

    test("ignores entries whose fields are not strings", () => {
        const {items, invalid} = parseFaqJson(`[{"question": {"text": "Q"}, "answer": ["A"]}, {"question": "Q", "answer": "A"}]`)
        expect(items).toEqual([{question: "Q", answer: "A"}])
        expect(invalid).toBe(1)
    })

    test("throws on invalid JSON", () => {
        expect(() => parseFaqJson("{broken")).toThrow()
    })
})
