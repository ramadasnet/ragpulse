import {describe, expect, test} from "bun:test"
import {stripComments} from "../server/utils/ingest/comments"

describe("stripComments", () => {
    test("removes JS/TS comments but keeps strings, templates and regexes", () => {
        const code = [
            "/**",
            " * Docs",
            " */",
            'import x from "y" // trailing',
            "",
            "",
            "const url = \"http://a.dev/*not*/\" + '//b'",
            'const t = `// ${a /* c */ + `/* ${"//"} */`} //`',
            "const re = /\\/\\/|[/*]/g.test(s) // check",
            "const d = a / b / c",
            "let n = a/*inline*/+b",
            "// last"
        ].join("\n")
        expect(stripComments(code, "src/a.ts")).toBe(
            ['import x from "y"', "", "const url = \"http://a.dev/*not*/\" + '//b'", 'const t = `// ${a   + `/* ${"//"} */`} //`', "const re = /\\/\\/|[/*]/g.test(s)", "const d = a / b / c", "let n = a +b"].join("\n")
        )
    })

    test("handles hash, dash and markup comment styles", () => {
        expect(stripComments('#!/usr/bin/env python\n# hi\ns = "#x"  # c\n"""\n# doc\n"""', "a.py")).toBe('#!/usr/bin/env python\ns = "#x"\n"""\n# doc\n"""')
        expect(stripComments("echo $# ${#a} # c\n  # only", "run.sh")).toBe("echo $# ${#a}")
        expect(stripComments("SELECT '--x' -- c\n/* b */ FROM t", "q.sql")).toBe("SELECT '--x'\n  FROM t")
        expect(stripComments("a --> b -- c\n{- x -}", "M.hs")).toBe("a --> b")
        expect(stripComments("fn f<'a>(x: &'a str) -> char { '\"' } // c\nlet s = \"//\";", "a.rs")).toBe("fn f<'a>(x: &'a str) -> char { '\"' }\nlet s = \"//\";")
        expect(stripComments("#[Attr]\n# c\n$a = 1; // c", "a.php")).toBe("#[Attr]\n$a = 1;")
        expect(stripComments("FROM node # not a comment\n# comment\nRUN x", "Dockerfile")).toBe("FROM node # not a comment\nRUN x")
        expect(stripComments("<!-- c -->\n<p>http://x</p>\n<script setup>\n// c\nconst a = 1\n</script>\n<style>a { background: url(http://x) } /* c */</style>", "A.vue")).toBe(
            "<p>http://x</p>\n<script setup>\nconst a = 1\n</script>\n<style>a { background: url(http://x) }  </style>"
        )
    })

    test("keeps unknown languages and unclosed comments", () => {
        expect(stripComments("// x", "a.unknown")).toBe("// x")
        expect(stripComments("a = 1 /* never closed", "a.c")).toBe("a = 1 /* never closed")
    })
})
