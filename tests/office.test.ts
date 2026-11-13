import {describe, expect, test} from "bun:test"
import {strToU8, zipSync} from "fflate"
import {DOCX_MIME, PPTX_MIME, XLSX_MIME, type BinaryMime} from "../server/utils/ingest/binary"
import {csvToMarkdown, officeToMarkdown} from "../server/utils/ingest/office"

function zip(files: Record<string, string | Uint8Array>): Uint8Array {
    return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])))
}

function file(mime: BinaryMime, bytes: Uint8Array, name = "file") {
    return {name, mime, bytes}
}

const W = 'xmlns:w="http://w" xmlns:r="http://r" xmlns:mc="http://mc"'

describe("docx", () => {
    const docx = zip({
        "docProps/core.xml": `<cp:coreProperties xmlns:dc="http://dc"><dc:title>Core Title</dc:title></cp:coreProperties>`,
        "word/document.xml": `<?xml version="1.0"?><w:document ${W}><w:body>
      <w:p><w:pPr><w:pStyle w:val="Ttl"/></w:pPr><w:r><w:t>Doc Title</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="berschrift1"/></w:pPr><w:r><w:t>Heading One</w:t></w:r></w:p>
      <w:p><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:r><w:t>Outline Three</w:t></w:r></w:p>
      <w:p><w:r><w:t>plain </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>more</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>it</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t> </w:t></w:r></w:p>
      <w:p><w:del><w:r><w:delText>deleted</w:delText></w:r></w:del><w:r><w:t>kept</w:t></w:r><w:r><w:instrText> HYPERLINK "x" </w:instrText></w:r></w:p>
      <mc:AlternateContent><mc:Choice><w:p><w:r><w:t>choice</w:t></w:r></w:p></mc:Choice><mc:Fallback><w:p><w:r><w:t>fallback</w:t></w:r></w:p></mc:AlternateContent>
      <w:p><w:hyperlink r:id="rId7"><w:r><w:t>Example</w:t></w:r></w:hyperlink></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>bullet</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>nested</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>numbered</w:t></w:r></w:p>
      <w:p><w:r><w:t>before</w:t><w:br/><w:t>after</w:t><w:tab/><w:t>tabbed</w:t></w:r></w:p>
      <w:tbl>
        <w:tr><w:tc><w:p><w:r><w:t>H1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>H2</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>a|b</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>c</w:t></w:r></w:p><w:p><w:r><w:t>d</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>e</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>
    </w:body></w:document>`,
        "word/styles.xml": `<w:styles xmlns:w="http://w"><w:style w:type="paragraph" w:styleId="Ttl"><w:name w:val="title"/></w:style><w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/></w:style></w:styles>`,
        "word/numbering.xml": `<w:numbering xmlns:w="http://w"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
        "word/_rels/document.xml.rels": `<Relationships><Relationship Id="rId7" Type="hyperlink" Target="https://example.com/x" TargetMode="External"/></Relationships>`
    })

    test("converts styles, lists, tables, links and formatting", () => {
        const res = officeToMarkdown(file(DOCX_MIME, docx))
        expect("skipped" in res).toBe(false)
        if ("skipped" in res) return
        const md = res.markdown
        expect(res.title).toBe("Core Title")
        // Title and localized styleId resolved via style name
        expect(md).toContain("# Doc Title")
        expect(md).toContain("# Heading One")
        // w:outlineLvl 2 → level 3
        expect(md).toContain("### Outline Three")
        // bold runs merged, italic marker kept outside trailing whitespace
        expect(md).toContain("plain **boldmore**_it_")
        expect(md).not.toContain("_ _")
        // deleted/field text excluded, mc:Choice kept once, mc:Fallback dropped
        expect(md).toContain("kept")
        expect(md).not.toContain("deleted")
        expect(md).not.toContain('HYPERLINK "x"')
        expect(md).toContain("choice")
        expect(md).not.toContain("fallback")
        // hyperlink via rels
        expect(md).toContain("[Example](https://example.com/x)")
        // bullet + nested + numbered lists
        expect(md).toContain("- bullet")
        expect(md).toContain("  - nested")
        expect(md).toContain("1. numbered")
        // break and tab
        expect(md).toContain("before\nafter tabbed")
        // table: gridSpan pads a cell, pipes escaped, paragraphs joined with <br>
        expect(md).toContain("| H1 | H2 |  |")
        expect(md).toContain("| a\\|b | c<br>d | e |")
    })
})

describe("pptx", () => {
    const slide = (title: string, extra = "", show?: boolean) => `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"${show === false ? ' show="0"' : ""}><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
    ${extra}
  </p:spTree></p:cSld></p:sld>`
    const pptx = zip({
        "ppt/presentation.xml": `<?xml version="1.0"?><p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>
      <p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/>
    </p:sldIdLst></p:presentation>`,
        "ppt/_rels/presentation.xml.rels": `<Relationships>
      <Relationship Id="rId2" Type="slide" Target="slides/slide2.xml"/>
      <Relationship Id="rId3" Type="slide" Target="slides/slide3.xml"/>
      <Relationship Id="rId4" Type="slide" Target="slides/slide1.xml"/>
    </Relationships>`,
        "ppt/slides/slide2.xml": slide(
            "First Slide",
            `
      <p:sp><p:nvSpPr><p:cNvPr id="3"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody>
        <a:p><a:pPr lvl="0"/><a:r><a:t>top</a:t></a:r></a:p>
        <a:p><a:pPr lvl="2"/><a:r><a:t>deep</a:t></a:r></a:p>
      </p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="4"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:fld><a:t>SLSLDNUM</a:t></a:fld></a:p></p:txBody></p:sp>
      <p:graphicFrame><p:nvGraphicFramePr/><a:graphic><a:graphicData><a:tbl>
        <a:tr><a:tc><a:txBody><a:p><a:r><a:t>K</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>V</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
        <a:tr><a:tc><a:txBody><a:p><a:r><a:t>a</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>1</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
        ),
        "ppt/slides/slide3.xml": slide("Hidden Slide", "", false),
        "ppt/slides/slide1.xml": slide("Third Slide"),
        "ppt/slides/_rels/slide1.xml.rels": `<Relationships><Relationship Id="rId1" Type="http://x/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
        "ppt/notesSlides/notesSlide1.xml": `<?xml version="1.0"?><p:notes xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="2"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:txBody/></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="3"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>remember this</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree></p:cSld></p:notes>`
    })

    test("follows sldIdLst order, renders bullets, tables and notes, skips hidden", () => {
        const res = officeToMarkdown(file(PPTX_MIME, pptx))
        expect("skipped" in res).toBe(false)
        if ("skipped" in res) return
        const md = res.markdown
        // slide2.xml listed first → Slide 1; hidden slide skipped; slide1.xml is Slide 3
        expect(md).toContain("## Slide 1: First Slide")
        expect(md).not.toContain("Hidden Slide")
        expect(md).not.toContain("Slide 2:")
        expect(md).toContain("## Slide 3: Third Slide")
        // bullet levels of a body placeholder
        expect(md).toContain("- top")
        expect(md).toContain("    - deep")
        // sldNum placeholder skipped
        expect(md).not.toContain("SLSLDNUM")
        // table
        expect(md).toContain("| K | V |")
        expect(md).toContain("| a | 1 |")
        // speaker notes
        expect(md).toContain("### Notes")
        expect(md).toContain("remember this")
    })
})

describe("xlsx", () => {
    const xlsx = (opts: {rows: string; sheets?: string; rels?: string; sst?: string; styles?: string; date1904?: boolean}) =>
        zip({
            "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns:r="r">${opts.date1904 ? '<workbookPr date1904="1"/>' : ""}<sheets>
        <sheet name="Data" sheetId="1" r:id="rId1"/>
        <sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/>
        ${opts.sheets ?? ""}
      </sheets></workbook>`,
            "xl/_rels/workbook.xml.rels": `<Relationships>
        <Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Type="ws" Target="worksheets/hidden.xml"/>
        ${opts.rels ?? ""}
      </Relationships>`,
            "xl/sharedStrings.xml": opts.sst ?? `<sst><si><t>Name</t></si><si><r><t>Hello</t></r><r><t> World</t></r></si></sst>`,
            "xl/styles.xml":
                opts.styles ??
                `<styleSheet><numFmts><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs>
        <xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="9"/>
      </cellXfs></styleSheet>`,
            "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData>${opts.rows}</sheetData></worksheet>`,
            "xl/worksheets/hidden.xml": `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hidden</t></is></c></row></sheetData></worksheet>`
        })

    test("converts shared strings, inline strings, dates, percents and booleans", () => {
        const res = officeToMarkdown(
            file(
                XLSX_MIME,
                xlsx({
                    rows: `
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Value</t></is></c></row>
        <row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2" t="b"><v>1</v></c><c r="D2"><v>0.30000000000000004</v></c></row>
        <row r="4"><c r="A4"><v>45000</v><f>0</f></c><c r="B4" s="1"><v>45000</v></c><c r="C4" s="2"><v>45000</v></c><c r="D4" s="3"><v>0.25</v></c></row>`
                })
            )
        )
        expect("skipped" in res).toBe(false)
        if ("skipped" in res) return
        const md = res.markdown
        expect(md).toContain("## Data")
        // hidden sheet skipped
        expect(md).not.toContain("hidden")
        // shared string + rich text runs concatenated; inline string header
        expect(md).toContain("| Name |  | Value |  |")
        expect(md).toContain("| Hello World |  | TRUE | 0.3 |")
        // float noise stripped; builtin numFmt 14 and custom yyyy-mm-dd → dates (45000 = 2023-03-15); percent ×100
        expect(md).toContain("| 45000 | 2023-03-15 | 2023-03-15 | 25% |")
        // row 3 was fully empty and is trimmed
        expect(md).not.toMatch(/\|\s*\|\s*\|\s*\|\s*\|\s*\|/)
    })

    test("honours the 1904 date system", () => {
        const res = officeToMarkdown(
            file(
                XLSX_MIME,
                xlsx({
                    date1904: true,
                    rows: `<row r="1"><c r="A1" t="inlineStr"><is><t>Day</t></is></c></row><row r="2"><c r="A2" s="1"><v>1461</v></c></row>`
                })
            )
        )
        if ("skipped" in res) throw new Error(res.skipped)
        expect(res.markdown).toContain("1908-01-01")
    })

    test("repeats the header across large table blocks and notes the row cap", () => {
        const rows = [
            `<row r="1"><c r="A1" t="inlineStr"><is><t>Col</t></is></c><c r="B1" t="inlineStr"><is><t>Val</t></is></c></row>`,
            ...Array.from({length: 200}, (_, i) => `<row r="${i + 2}"><c r="A${i + 2}" t="inlineStr"><is><t>row-${i}-with-a-rather-long-value</t></is></c><c r="B${i + 2}"><v>${i}</v></c></row>`)
        ].join("")
        const res = officeToMarkdown(file(XLSX_MIME, xlsx({rows})))
        if ("skipped" in res) throw new Error(res.skipped)
        const headers = res.markdown.match(/\| Col \| Val \|/g) ?? []
        expect(headers.length).toBeGreaterThan(1)
        expect(res.markdown.match(/\| --- \| --- \|/g)?.length).toBe(headers.length)
    })

    test("caps rows per sheet", () => {
        const rows = `<row r="1"><c r="A1" t="inlineStr"><is><t>Col</t></is></c></row>` + Array.from({length: 10_100}, (_, i) => `<row r="${i + 2}"><c r="A${i + 2}"><v>${i}</v></c></row>`).join("")
        const res = officeToMarkdown(file(XLSX_MIME, xlsx({rows})))
        if ("skipped" in res) throw new Error(res.skipped)
        expect(res.markdown).toContain("more rows not indexed")
    })
})

describe("csv", () => {
    test("detects the delimiter and renders a table", () => {
        const md = csvToMarkdown("a;b;c\n1;2;3")
        expect(md).toContain("| a | b | c |")
        expect(md).toContain("| 1 | 2 | 3 |")
    })

    test("parses RFC 4180 quotes, escapes and newlines", () => {
        const md = csvToMarkdown('name,note\n"x\ny","he said ""hi""",')
        expect(md).toContain("| name | note |")
        expect(md).toContain('| x<br>y | he said "hi" |  |')
    })

    test("accepts an explicit delimiter", () => {
        const md = csvToMarkdown("a\tb\n1\t2", "\t")
        expect(md).toContain("| a | b |")
        expect(md).toContain("| 1 | 2 |")
    })

    test("caps rows and notes the remainder", () => {
        const csv = ["h1,h2", ...Array.from({length: 10_100}, (_, i) => `${i},v`)].join("\n")
        const md = csvToMarkdown(csv)
        expect(md).toContain("(101 more rows not indexed)")
    })
})

describe("corrupt input", () => {
    test("never throws", () => {
        for (const mime of [DOCX_MIME, PPTX_MIME, XLSX_MIME] as const) {
            const res = officeToMarkdown(file(mime, strToU8("this is not a zip file")))
            expect("skipped" in res).toBe(true)
        }
        const empty = officeToMarkdown(file(DOCX_MIME, zip({"word/document.xml": '<w:document xmlns:w="w"><w:body/></w:document>'})))
        expect(empty).toEqual({skipped: "no readable content"})
    })
})
