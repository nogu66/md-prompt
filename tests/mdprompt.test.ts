import { describe, expect, test } from "bun:test"
import { MAX_CHARS, PALETTE, decorateMarkdown, type Decoration } from "../plugins/md-prompt/hooks/lib/mdprompt"

type Style = Omit<Decoration, "start" | "end">

/** Per character, the style the engine ends up with: later runs win per style key. */
function paint(text: string): Style[] {
  const styles: Style[] = Array.from({ length: text.length }, () => ({}))
  for (const { start, end, ...style } of decorateMarkdown(text)) {
    for (let i = start; i < end; i++) Object.assign(styles[i]!, style)
  }
  return styles
}

/** Style of the first occurrence of `needle` (all its characters must agree). */
function at(text: string, needle: string, from = 0): Style {
  const i = text.indexOf(needle, from)
  if (i === -1) throw new Error(`no ${JSON.stringify(needle)} in ${JSON.stringify(text)}`)
  const styles = paint(text)
  const first = styles[i]!
  for (let k = i; k < i + needle.length; k++) expect(styles[k]).toEqual(first)
  return first
}

describe("decorateMarkdown: basics", () => {
  test("empty text has no decorations", () => {
    expect(decorateMarkdown("")).toEqual([])
  })

  test("plain text has no decorations", () => {
    expect(decorateMarkdown("just a normal prompt, nothing to see")).toEqual([])
  })

  test("a draft over the limit is left alone", () => {
    expect(decorateMarkdown("**a** ".repeat(MAX_CHARS))).toEqual([])
  })

  test("every run is inside the text, non-empty, and never crosses a newline", () => {
    const samples = [
      "# Title\n\n**bold** and *it* and `code`\n\n```ts\nconst a = `x\ny`\n/* c\nd */\n```\n> quote\n[l](http://a_b_c)",
      "```py\n\"\"\"doc\nstring\"\"\"\nx = 1\n",
      "~~~\nplain\n~~~\n***x***\n~~s~~",
      "日本語 **太字** 😀 *斜体* `コード`",
    ]
    for (const text of samples) {
      for (const d of decorateMarkdown(text)) {
        expect(d.start).toBeGreaterThanOrEqual(0)
        expect(d.end).toBeLessThanOrEqual(text.length)
        expect(d.end).toBeGreaterThan(d.start)
        expect(text.slice(d.start, d.end)).not.toContain("\n")
      }
    }
  })
})

describe("decorateMarkdown: fenced code blocks", () => {
  const block = "before\n```ts\nconst x = 1\n```\nafter"

  test("the block is a card: fences and body carry the code background", () => {
    const styles = paint(block)
    const openFence = block.indexOf("```")
    const closeFence = block.lastIndexOf("```")
    for (let i = openFence; i < openFence + "```ts".length; i++) expect(styles[i]!.backgroundColor).toBe(PALETTE.codeBg)
    for (let i = block.indexOf("const"); i < block.indexOf("const") + "const x = 1".length; i++) {
      expect(styles[i]!.backgroundColor).toBe(PALETTE.codeBg)
    }
    for (let i = closeFence; i < closeFence + 3; i++) expect(styles[i]!.backgroundColor).toBe(PALETTE.codeBg)
  })

  test("text outside the block is untouched", () => {
    expect(at(block, "before")).toEqual({})
    expect(at(block, "after")).toEqual({})
  })

  test("the fence marker is grey and the language word is highlighted, bold", () => {
    expect(at(block, "```").color).toBe(PALETTE.fence)
    expect(at(block, "ts")).toMatchObject({ color: PALETTE.lang, bold: true })
  })

  test("the language word is found however it is typed", () => {
    expect(at("```TS\nx\n```", "TS")).toMatchObject({ color: PALETTE.lang, bold: true })
    expect(at("```.py\nx\n```", "py")).toMatchObject({ color: PALETTE.lang, bold: true })
    expect(at("``` ts title=a\nx\n```", "ts")).toMatchObject({ color: PALETTE.lang, bold: true })
  })

  test("token colours sit on top of the card background", () => {
    expect(at(block, "const")).toMatchObject({ color: PALETTE.token.keyword, backgroundColor: PALETTE.codeBg })
    expect(at(block, "1", block.indexOf("=")).color).toBe(PALETTE.token.number)
    expect(at(block, "x", block.indexOf("const")).color).toBe(PALETTE.codeFg)
  })

  test("a block still being typed (no closing fence) is painted to the end", () => {
    const typing = "```js\nlet a = 1\nlet b"
    const styles = paint(typing)
    const firstLine = typing.indexOf("let a")
    for (let i = firstLine; i < typing.length; i++) {
      if (typing[i] !== "\n") expect(styles[i]!.backgroundColor).toBe(PALETTE.codeBg)
    }
  })

  test("an opening fence alone paints just that line", () => {
    expect(at("```", "```").backgroundColor).toBe(PALETTE.codeBg)
  })

  test("Markdown inside the block is not Markdown", () => {
    const text = "```\n**not bold** and `not code`\n```"
    expect(at(text, "not bold").bold).toBeUndefined()
    expect(at(text, "not code").backgroundColor).toBe(PALETTE.codeBg)
  })

  test("tilde fences work, and only a matching fence closes them", () => {
    const text = "~~~\nbody\n```\nstill body\n~~~\nout"
    expect(at(text, "still body").backgroundColor).toBe(PALETTE.codeBg)
    expect(at(text, "out")).toEqual({})
  })

  test("a longer fence is not closed by a shorter one", () => {
    const text = "````md\n```\ninner\n```\n````\nout"
    expect(at(text, "inner").backgroundColor).toBe(PALETTE.codeBg)
    expect(at(text, "out")).toEqual({})
  })

  test("a fence line with its closer on the same line is inline code, not a fence", () => {
    const text = "```code``` here"
    expect(at(text, "code").backgroundColor).toBe(PALETTE.inlineBg)
    expect(at(text, "here")).toEqual({})
  })

  test("empty lines inside a block get no run (there is nothing to paint)", () => {
    const text = "```\na\n\nb\n```"
    const styles = paint(text)
    expect(styles[text.indexOf("a")]!.backgroundColor).toBe(PALETTE.codeBg)
    expect(styles[text.indexOf("\n\n") + 1]).toEqual({}) // the empty line's newline
  })

  test("a multi-line comment is coloured line by line", () => {
    const text = "```c\n/* one\ntwo */ int y;\n```"
    expect(at(text, "one").color).toBe(PALETTE.token.comment)
    expect(at(text, "two */").color).toBe(PALETTE.token.comment)
    expect(at(text, "int")).toMatchObject({ color: PALETTE.token.keyword })
  })

  test("two blocks in one draft are each painted", () => {
    const text = "```\na\n```\ntext\n```\nb\n```"
    expect(at(text, "a").backgroundColor).toBe(PALETTE.codeBg)
    expect(at(text, "text")).toEqual({})
    expect(at(text, "b", text.indexOf("text")).backgroundColor).toBe(PALETTE.codeBg)
  })
})

describe("decorateMarkdown: emphasis", () => {
  test("bold, with dimmed markers", () => {
    const text = "a **b** c"
    expect(at(text, "b").bold).toBe(true)
    expect(at(text, "**")).toMatchObject({ dimColor: true })
    expect(at(text, "a ")).toEqual({})
    expect(at(text, " c")).toEqual({})
  })

  test("__bold__ and *italic* and _italic_", () => {
    expect(at("x __b__ y", "b").bold).toBe(true)
    expect(at("x *i* y", "i").italic).toBe(true)
    expect(at("x _i_ y", "i").italic).toBe(true)
  })

  test("bold + italic", () => {
    expect(at("***x***", "x")).toMatchObject({ bold: true, italic: true })
  })

  test("italic inside bold", () => {
    const text = "**a _b_ c**"
    expect(at(text, "a ").bold).toBe(true)
    expect(at(text, "b")).toMatchObject({ bold: true, italic: true })
    expect(at(text, " c").italic).toBeUndefined()
  })

  test("strikethrough", () => {
    expect(at("~~gone~~", "gone").strikethrough).toBe(true)
  })

  test("things that only look like emphasis are left alone", () => {
    expect(paint("snake_case_name here").every((s) => s.italic === undefined)).toBe(true)
    expect(paint("2 * 3 * 4").every((s) => s.italic === undefined)).toBe(true)
    expect(paint("* item one\n* item two").every((s) => s.italic === undefined)).toBe(true)
    expect(paint("**not closed").every((s) => s.bold === undefined)).toBe(true)
    expect(paint("** spaced **").every((s) => s.bold === undefined)).toBe(true)
  })

  test("emphasis reaches across a line break inside a paragraph, but not across a blank line", () => {
    // changed from "does not reach across a line break": a paragraph is now read as a whole
    const styles = paint("**a\nb**")
    expect(styles[3]).toEqual({}) // the "\n" itself is never painted (no run holds it)
    expect(at("**a\nb**", "a").bold).toBe(true)
    expect(at("**a\nb**", "b").bold).toBe(true)
    expect(paint("**a\n\nb**").every((s) => s.bold === undefined)).toBe(true)
  })

  test("an escaped marker is a literal character", () => {
    expect(paint("\\*a\\*").every((s) => s.italic === undefined)).toBe(true)
  })

  test("offsets are UTF-16 code units: Japanese and emoji before the match", () => {
    const text = "日本語 😀 **太字**"
    expect(at(text, "太字").bold).toBe(true)
    expect(at(text, "日本語")).toEqual({})
    expect(at("😀 *x*", "x").italic).toBe(true)
  })
})

describe("decorateMarkdown: inline code, links, headings", () => {
  test("inline code is a chip, backticks grey, emphasis inside is ignored", () => {
    const text = "run `npm **test**` now"
    expect(at(text, "npm **test**")).toMatchObject({ backgroundColor: PALETTE.inlineBg, color: PALETTE.inlineFg })
    expect(at(text, "npm **test**").bold).toBeUndefined()
    expect(at(text, "`")).toMatchObject({ color: PALETTE.fence })
    expect(at(text, "run ")).toEqual({})
  })

  test("a double-backtick span can hold a single backtick", () => {
    const text = "``a ` b`` z"
    expect(at(text, "a ` b").backgroundColor).toBe(PALETTE.inlineBg)
    expect(at(text, "z")).toEqual({})
  })

  test("an unpaired backtick is plain", () => {
    expect(paint("it`s odd").every((s) => s.backgroundColor === undefined)).toBe(true)
  })

  test("links: text underlined, url dimmed and not read as emphasis", () => {
    const text = "see [docs](https://a.com/x_y_z) ok"
    expect(at(text, "docs")).toMatchObject({ underline: true, color: PALETTE.link })
    expect(at(text, "https://a.com/x_y_z")).toEqual({ dimColor: true })
  })

  test("headings: marker dim, text bold and coloured", () => {
    const text = "## Plan\nbody"
    expect(at(text, "##")).toMatchObject({ dimColor: true })
    expect(at(text, "Plan")).toMatchObject({ bold: true, color: PALETTE.heading })
    expect(at(text, "body")).toEqual({})
  })

  test("# without a space is not a heading", () => {
    expect(paint("#hashtag").every((s) => s.bold === undefined)).toBe(true)
  })

  test("emphasis inside a heading still works", () => {
    expect(at("# a *b*", "b")).toMatchObject({ bold: true, italic: true })
  })

  test("the quote marker is grey and the quoted text is italic", () => {
    // changed from `said` being untouched: quoted text is now italic (nothing else about it changes)
    expect(at("> said", ">").color).toBe(PALETTE.fence)
    expect(at("> said", "said")).toEqual({ italic: true })
  })
})
