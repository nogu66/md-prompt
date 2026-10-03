import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { PALETTE } from "../plugins/md-prompt/hooks/lib/mdprompt"
import { at, expectValidRuns, paint, unstyled } from "./helpers"

const LINK = { underline: true, color: PALETTE.link }
const TAG = { color: PALETTE.tag }
const COMMENT = { dimColor: true, italic: true }

describe("emphasis: flanking rules", () => {
  test("a run next to whitespace on the inside is not emphasis", () => {
    for (const text of ["a * b *", "** spaced **", "x * a*", "*a *", "_ a_", "__ a __"]) {
      expect(unstyled(text, "italic", "bold")).toBe(true)
    }
  })

  test("punctuation on the inside needs a boundary on the outside", () => {
    expect(at("*(a)*", "(a)")).toMatchObject({ italic: true })
    expect(at("x **(a)** y", "(a)")).toMatchObject({ bold: true })
    expect(unstyled("a*(b)*c", "italic")).toBe(true)
  })

  test("_ never works inside a word; * does not open there either (but see the maths tests below)", () => {
    expect(unstyled("un**believ**able", "bold")).toBe(true)
    expect(unstyled("snake_case_name here", "italic")).toBe(true)
    expect(unstyled("foo__bar__baz", "bold")).toBe(true)
    expect(at("_a_ and __b__", "a")).toMatchObject({ italic: true })
  })

  test("_ next to punctuation still works", () => {
    expect(at("(_a_)", "a")).toMatchObject({ italic: true })
    expect(at("**_a_**", "a")).toMatchObject({ bold: true, italic: true })
  })

  test("unmatched runs are plain text", () => {
    for (const text of ["**a", "a**", "*a", "a_", "**a*", "***a", "~~a", "a~~"]) {
      const styles = paint(text)
      expect(styles.some((s) => s.italic || s.bold || s.strikethrough)).toBe(text === "**a*")
    }
    expect(at("**a*", "a")).toMatchObject({ italic: true }) // the inner `*a*` is emphasis, the extra `*` is text
  })

  test("the rule of 3: *foo**bar* pairs the single runs", () => {
    expect(at("*foo**bar*", "foo**bar")).toMatchObject({ italic: true })
  })

  test("bold + italic in every spelling", () => {
    expect(at("***x***", "x")).toMatchObject({ bold: true, italic: true })
    expect(at("___x___", "x")).toMatchObject({ bold: true, italic: true })
    expect(at("**a *b* c**", "b")).toMatchObject({ bold: true, italic: true })
    expect(at("*a **b** c*", "b")).toMatchObject({ bold: true, italic: true })
    expect(at("***a** b*", "a")).toMatchObject({ bold: true, italic: true })
    expect(at("***a** b*", " b")).toMatchObject({ italic: true })
  })

  test("nested and adjacent spans", () => {
    const text = "**a *b* c** and *dd* and ~~*e*~~"
    expect(at(text, "dd")).toMatchObject({ italic: true })
    expect(at(text, "dd").bold).toBeUndefined()
    expect(at(text, "e")).toMatchObject({ italic: true, strikethrough: true })
  })

  test("the markers are dimmed, the text between them is not", () => {
    expect(at("a **b** c", "**")).toEqual({ dimColor: true })
    expect(at("~~s~~", "~~")).toEqual({ dimColor: true })
    expect(at("a **b** c", "a ")).toEqual({})
  })

  test("a longer run than needed leaves the extra markers as text", () => {
    const text = "***a**"
    expect(at(text, "a")).toMatchObject({ bold: true })
    expect(paint(text)[0]).toEqual({})
  })

  test("strikethrough needs two tildes", () => {
    expect(at("~~gone~~", "gone")).toMatchObject({ strikethrough: true })
    expect(unstyled("~a~ and ~~~b~~~ and ~/x ~/y", "strikethrough")).toBe(true)
  })

  test("multi-line: emphasis spans the lines of one paragraph", () => {
    const text = "*one\ntwo\nthree*"
    for (const w of ["one", "two", "three"]) expect(at(text, w)).toMatchObject({ italic: true })
    expect(paint(text)[4]).toEqual({}) // the line break itself
    expectValidRuns(text)
  })

  test("multi-line emphasis stops at a blank line, a heading, a list item or a fence", () => {
    for (const sep of ["\n\n", "\n# h\n", "\n- x\n", "\n```\ncode\n```\n"]) {
      const text = `**a${sep}b**`
      expect(at(text, "a")).toEqual({}) // no closer in its own paragraph: the opener is plain text
      expect(paint(text)[text.lastIndexOf("b")]).toEqual({})
    }
  })

  test("lines of a quoted or list paragraph join too", () => {
    expect(at("> **a\n> b**", "b")).toMatchObject({ bold: true })
    expect(at("- **a\n  b**", "b")).toMatchObject({ bold: true })
  })
})

describe("emphasis: prompts are not maths", () => {
  test("2*3*4, a*b*c and x**2 + y**2 are left alone", () => {
    for (const text of ["2*3*4", "a*b*c", "x**2 + y**2", "price*qty*tax", "2 * 3 * 4", "x**n and y**m"]) {
      expect(unstyled(text, "italic", "bold")).toBe(true)
    }
  })

  test("globs are left alone", () => {
    for (const text of ["src/*.ts and lib/*.ts", "src/**/*.tsx", "**/*.js and **/*.ts", "find *.md and *.txt"]) {
      expect(unstyled(text, "italic", "bold")).toBe(true)
    }
  })

  test("Python dunders are not bold, real __bold__ still is", () => {
    for (const text of ["__init__.py", 'if __name__ == "__main__":', "call __repr__(x) and __len__", "in __init__ and __all__"]) {
      expect(unstyled(text, "bold")).toBe(true)
    }
    expect(at("a __bold__ b", "bold")).toMatchObject({ bold: true })
    expect(at("__init__ and __bold__", "bold")).toMatchObject({ bold: true })
    expect(at("**__init__**", "__init__")).toMatchObject({ bold: true }) // ** still wraps it
    expect(unstyled("snake__init__case", "bold")).toBe(true)
  })

  test("__tests__, __pycache__ and other _ path segments stay plain", () => {
    for (const text of [
      "see src/__tests__/a.test.ts",
      "see __tests__/a.test.ts",
      "jest/__snapshots__/x.snap",
      "drop __pycache__ and __mocks__",
      "see __generated__/a.ts",
      "src/__fixtures__/x and lib/__fixtures__/y",
      "path/_private_ file",
      "x/__bold__ y", // like src/*.ts, a run glued to a / does not open
    ]) {
      expect(unstyled(text, "italic", "bold")).toBe(true)
    }
    expect(at("a _em_ b", "em")).toMatchObject({ italic: true })
  })

  test("but a closing ** may sit against a word: **bold**text", () => {
    expect(at("**bold**text", "bold")).toMatchObject({ bold: true })
  })

  test("Japanese: no spaces are needed, and punctuation inside is fine", () => {
    expect(at("これは*重要*です", "重要")).toMatchObject({ italic: true })
    expect(at("日本語**太字**です", "太字")).toMatchObject({ bold: true })
    expect(at("日本語**「太字」**です", "「太字」")).toMatchObject({ bold: true })
    expect(at("テスト**（重要）**です", "（重要）")).toMatchObject({ bold: true })
    expect(at("**日本語**は", "日本語")).toMatchObject({ bold: true })
  })

  test("emoji count as punctuation next to _", () => {
    expect(at("😀_a_😀", "a")).toMatchObject({ italic: true })
    expect(at("😀**a**😀", "a")).toMatchObject({ bold: true })
  })
})

describe("escapes", () => {
  test("a backslash before any ASCII punctuation makes it literal", () => {
    for (const text of ["\\*a\\*", "\\_a\\_", "\\`a\\`", "\\[a\\](b)", "\\~\\~a\\~\\~", "\\<b>", "\\&amp;"]) {
      expect(paint(text).every((s) => !s.italic && !s.bold && !s.strikethrough && !s.underline && !s.backgroundColor && s.color === undefined)).toBe(true)
    }
  })

  test("a backslash before a letter is just a backslash", () => {
    expect(at("\\a *b*", "b")).toMatchObject({ italic: true })
  })

  test("an escaped backslash does not escape what follows", () => {
    expect(at("\\\\*a*", "a")).toMatchObject({ italic: true })
  })

  test("a backslash inside a code span is not an escape", () => {
    expect(at("`a\\` *b*", "b")).toMatchObject({ italic: true })
  })
})

describe("code spans", () => {
  test("a span binds tighter than emphasis", () => {
    const starred = "*a `b*` c*"
    expect(at(starred, "a ")).toMatchObject({ italic: true })
    expect(paint(starred)[starred.indexOf("b*") + 1].dimColor).toBeUndefined() // the `*` inside the span is text
    expect(paint(starred)[starred.indexOf("b*") + 1].backgroundColor).toBe(PALETTE.inlineBg)
    expect(at("**a `b**` c", "b**").backgroundColor).toBe(PALETTE.inlineBg)
    expect(at("**a `b**` c", "b**").bold).toBeUndefined()
  })

  test("a span binds tighter than links", () => {
    const text = "[a `]` b](http://x.y)"
    expect(at(text, "]", text.indexOf("`")).backgroundColor).toBe(PALETTE.inlineBg)
    expect(at(text, "a ")).toMatchObject(LINK)
  })

  test("the closer is a run of the same length: ``a ` b``, ```x``y```", () => {
    expect(at("``a ` b`` z", "a ` b").backgroundColor).toBe(PALETTE.inlineBg)
    expect(at("```x``y``` z", "x``y").backgroundColor).toBe(PALETTE.inlineBg)
    expect(at("`a`` z", "a")).toEqual({}) // the run of two does not close a run of one
  })

  test("a span may run over a line break inside a paragraph", () => {
    const text = "`multi\nline` span"
    expect(at(text, "multi").backgroundColor).toBe(PALETTE.inlineBg)
    expect(at(text, "line").backgroundColor).toBe(PALETTE.inlineBg)
    expect(paint(text)[6]).toEqual({}) // not the line break
    expect(at(text, "span")).toEqual({})
  })

  test("but not over a blank line", () => {
    expect(paint("`a\n\nb`").every((s) => s.backgroundColor === undefined)).toBe(true)
  })

  test("the backticks are grey, the chip has its own colours", () => {
    expect(at("x `y` z", "`")).toMatchObject({ color: PALETTE.fence })
    expect(at("x `y` z", "y")).toEqual({ backgroundColor: PALETTE.inlineBg, color: PALETTE.inlineFg })
  })

  test("many spans on a line, and a stray backtick among them", () => {
    const text = "`a` and `b` and it`s odd"
    expect(at(text, "a").backgroundColor).toBe(PALETTE.inlineBg)
    expect(at(text, "b").backgroundColor).toBe(PALETTE.inlineBg)
    expect(at(text, "`s odd")).toEqual({}) // the last backtick has no partner
    expect(at(text, "and", 5)).toEqual({})
  })
})

describe("links", () => {
  test("inline link: text underlined and coloured, the rest dimmed", () => {
    const text = "see [docs](https://a.com/x_y_z) ok"
    expect(at(text, "docs")).toEqual(LINK)
    expect(at(text, "[")).toEqual({ dimColor: true })
    expect(at(text, "](https://a.com/x_y_z)")).toEqual({ dimColor: true })
    expect(at(text, "see ")).toEqual({})
  })

  test("a title in double quotes, single quotes or parentheses", () => {
    for (const title of ['"T t"', "'T t'", "(T t)"]) {
      const text = `[a](/u ${title}) z`
      expect(at(text, "a")).toEqual(LINK)
      expect(at(text, "z")).toEqual({})
      expect(paint(text)[text.indexOf(title)]).toEqual({ dimColor: true })
    }
  })

  test("balanced parentheses and angle brackets in the destination", () => {
    expect(at("[a](https://x.y/(z)) w", "w")).toEqual({})
    expect(at("[a](https://x.y/(z)) w", "a")).toEqual(LINK)
    expect(at("[a](<my file.md>) w", "a")).toEqual(LINK)
    expect(at("[a](<my file.md>) w", "w")).toEqual({})
  })

  test("an empty destination is still a link; an unfinished one is not", () => {
    expect(at("[a]() b", "a")).toEqual(LINK)
    for (const text of ["[a](b", "[a](b c", "[a](", "[a] (b)", "[a]"]) {
      expect(paint(text).every((s) => s.underline === undefined)).toBe(true)
    }
  })

  test("emphasis and code inside the link text keep working, and the url is not emphasis", () => {
    const text = "[**b** and `c`](http://a_b_c/*x*)"
    expect(at(text, "b")).toMatchObject({ bold: true, underline: true })
    expect(at(text, "c")).toMatchObject({ backgroundColor: PALETTE.inlineBg })
    expect(at(text, "http://a_b_c/*x*")).toEqual({ dimColor: true })
  })

  test("emphasis does not pair across a link", () => {
    expect(at("*a [b*](u) c", "b")).toMatchObject(LINK)
    expect(at("*a [b*](u) c", "b").italic).toBeUndefined()
  })

  test("a link never holds a link: the inner one wins", () => {
    const text = "[a [b](c) d](e)"
    expect(at(text, "b")).toEqual(LINK)
    expect(at(text, "a ")).toEqual({})
    expect(at(text, "](e)")).toEqual({})
  })

  test("an image: alt in italics, `![` and the source dimmed", () => {
    const text = "![alt text](pic.png \"t\") z"
    expect(at(text, "alt text")).toEqual({ italic: true, color: PALETTE.link })
    expect(at(text, "![")).toEqual({ dimColor: true })
    expect(at(text, "](pic.png \"t\")")).toEqual({ dimColor: true })
  })

  test("a linked image", () => {
    const text = "[![alt](a.png)](https://x.y)"
    expect(at(text, "alt")).toMatchObject({ italic: true })
    expect(at(text, "](https://x.y)")).toEqual({ dimColor: true })
  })

  test("reference links need a definition: full, collapsed and shortcut", () => {
    const defs = "\n\n[Ref]: /u"
    expect(at(`[t][ref] x${defs}`, "t")).toEqual(LINK)
    expect(at(`[t][ref] x${defs}`, "][ref]")).toEqual({ dimColor: true })
    expect(at(`[ref][] x${defs}`, "ref")).toEqual(LINK)
    expect(at(`[ref] x${defs}`, "ref")).toEqual(LINK)
    expect(at(`![ref] x${defs}`, "ref")).toMatchObject({ italic: true })
    expect(unstyled("[t][ref] x", "underline")).toBe(true)
  })

  test("brackets inside a shortcut reference: only the innermost pair can be the label", () => {
    expect(at("[[ref]]\n\n[ref]: /u", "ref")).toEqual(LINK)
    const text = "[a [ref] b]\n\n[ref]: /u"
    expect(at(text, "ref")).toEqual(LINK)
    expect(at(text, "a ")).toEqual({})
    expect(at(text, " b")).toEqual({})
  })

  test("escaped brackets are not links", () => {
    expect(unstyled("\\[a\\](/u)", "underline")).toBe(true)
  })

  test("bare and angle-bracket autolinks", () => {
    expect(at("<https://a.com/x_y>", "https://a.com/x_y")).toEqual(LINK)
    expect(at("<https://a.com/x_y>", "<")).toEqual({ dimColor: true })
    expect(at("<mailto:a@b.co>", "mailto:a@b.co")).toEqual(LINK)
    expect(at("<me@example.com>", "me@example.com")).toEqual(LINK)
  })

  test("not autolinks: spaces, no scheme", () => {
    expect(unstyled("<not a link>", "underline")).toBe(true)
    expect(unstyled("<a@>", "underline")).toBe(true)
    expect(unstyled("<x:y z>", "underline")).toBe(true)
  })
})

describe("bare URLs (GFM)", () => {
  test("http, https and www are underlined and coloured", () => {
    expect(at("go to https://a.com/x_y now", "https://a.com/x_y")).toEqual(LINK)
    expect(at("see http://a.b/c", "http://a.b/c")).toEqual(LINK)
    expect(at("see www.foo.com/bar_baz now", "www.foo.com/bar_baz")).toEqual(LINK)
    expect(at("go to https://a.com/x_y now", "now")).toEqual({})
  })

  test("trailing punctuation is not part of the url", () => {
    expect(at("see https://a.com/x.", "https://a.com/x")).toEqual(LINK)
    expect(paint("see https://a.com/x.")[19]).toEqual({}) // the final full stop
    expect(at("(https://a.com/x), ok", ")")).toEqual({})
    expect(at("(see https://a.com/x)", "https://a.com/x")).toEqual(LINK)
    expect(at("https://a.com/(a)", "https://a.com/(a)")).toEqual(LINK)
    expect(at("https://a.com/a?b=1&c=2!", "https://a.com/a?b=1&c=2")).toEqual(LINK)
  })

  test("a url inside emphasis or a link text", () => {
    expect(at("**https://a.com**", "https://a.com")).toMatchObject({ bold: true, underline: true })
    expect(at("**https://a.com**", "**")).toEqual({ dimColor: true })
    expect(at("[https://a.com](https://a.com/x)", "](https://a.com/x)")).toEqual({ dimColor: true })
  })

  test("only at the start of a word", () => {
    expect(unstyled("nothttps://a.com and awww.x.com", "underline")).toBe(true)
  })

  test("needs something after the scheme", () => {
    expect(unstyled("https:// and www. and http://", "underline")).toBe(true)
  })

  test("underscores in a url are not emphasis", () => {
    expect(paint("https://a.com/a_b_c_d").some((s) => s.italic)).toBe(false)
  })
})

describe("inline HTML", () => {
  test("open, close and self-closing tags are one colour", () => {
    expect(at("a <b>bold</b> c", "<b>")).toEqual(TAG)
    expect(at("a <b>bold</b> c", "</b>")).toEqual(TAG)
    expect(at("a<br/>b", "<br/>")).toEqual(TAG)
    expect(at("a <br> b", "<br>")).toEqual(TAG)
    expect(at("a <b>bold</b> c", "bold")).toEqual({})
  })

  test("attributes, quoted and bare", () => {
    expect(at('<a href="x y" title=\'z\' data-k=v disabled>', '<a href="x y" title=\'z\' data-k=v disabled>')).toEqual(TAG)
    expect(at('<img src="a.png" />', '<img src="a.png" />')).toEqual(TAG)
  })

  test("a tag can span lines", () => {
    const text = '<a\n  href="x">t</a>'
    expect(at(text, "<a")).toEqual(TAG)
    expect(at(text, 'href="x">')).toEqual(TAG)
    expectValidRuns(text)
  })

  test("prompt-style tags: <thinking>, <user_input>, <doc:part>", () => {
    for (const tag of ["<thinking>", "</thinking>", "<user_input>", "<document index=\"1\">", "<ns:item id=\"a\">"]) {
      expect(at(`x ${tag} y`, tag)).toEqual(TAG)
    }
    expect(at("<thinking>\n**a**\n</thinking>", "a")).toMatchObject({ bold: true })
  })

  test("comments and declarations", () => {
    expect(at("a <!-- note --> b", "<!-- note -->")).toEqual(COMMENT)
    expect(at("a <!-- note --> b", "b")).toEqual({})
    expect(at("x <!-- a\nb --> y", "a")).toEqual(COMMENT)
    expect(at("x <!-- a\nb --> y", "b")).toEqual(COMMENT)
    expect(at("<!DOCTYPE html>", "<!DOCTYPE html>")).toEqual(TAG)
    expect(at("<?xml version=\"1.0\"?>", "<?xml version=\"1.0\"?>")).toEqual(COMMENT)
    expect(at("<![CDATA[x]]>", "<![CDATA[x]]>")).toEqual(COMMENT)
  })

  test("an unclosed comment or tag is text", () => {
    expect(at("a <!-- open and *it*", "<!-- open and ")).toEqual({})
    expect(at("a <!-- open and *it*", "it")).toMatchObject({ italic: true })
    expect(unstyled("<b", "color")).toBe(true)
    expect(unstyled("<a href=\"x", "color")).toBe(true)
  })

  test("comparisons and generics are not tags", () => {
    for (const text of ["a < b and c > d", "if (a<b && c>d)", "x <= y >= z", "Array<string>", "Map<string, number>", "f<T>(x: T)", "1<2>3", "a<-b", "<3 you", "< div>"]) {
      expect(unstyled(text, "color")).toBe(true)
    }
  })

  test("known HTML names are tags even glued to a word", () => {
    expect(at("line<br>two", "<br>")).toEqual(TAG)
    expect(at("word<b>x</b>", "<b>")).toEqual(TAG)
  })

  test("emphasis around a tag still pairs", () => {
    expect(at("**a <b> c**", " c")).toMatchObject({ bold: true })
  })
})

describe("entities", () => {
  test("named, decimal and hex", () => {
    for (const e of ["&amp;", "&lt;", "&copy;", "&#39;", "&#x1F600;", "&#X27;", "&hellip;"]) {
      expect(at(`a ${e} b`, e)).toEqual({ color: PALETTE.entity })
    }
  })

  test("not entities: bare &, no semicolon, junk", () => {
    for (const text of ["a & b", "&amp", "R&D;", "&;", "&#;", "&#xZZ;", "AT&T", "a&b=c;"]) {
      expect(unstyled(text, "color")).toBe(true)
    }
  })

  test("an entity is not emphasis-transparent: & inside a url stays dimmed", () => {
    expect(at("[a](https://x.y/?a=1&amp;b=2)", "https://x.y/?a=1&amp;b=2")).toEqual({ dimColor: true })
  })
})

describe("footnote references", () => {
  test("inside a sentence, with a defined label", () => {
    const text = "claim[^n1] and more.\n\n[^n1]: source"
    expect(at(text, "n1")).toEqual({ color: PALETTE.link })
    expect(at(text, "[^")).toEqual({ dimColor: true })
    expect(at(text, "claim")).toEqual({})
  })
})

describe("regressions found by comparing against commonmark.js", () => {
  test("a link that formed earlier does not switch off later, unrelated brackets", () => {
    // the inner link deactivates the outer `[`; once that `[` is closed, a fresh `[c](d)` is a link again
    const text = "[x [a](b) y] [c](d)"
    expect(at(text, "a")).toEqual(LINK)
    expect(at(text, "c")).toEqual(LINK)
    expect(at(text, "x ")).toEqual({})
  })

  test("a (title) in parentheses cannot hold a bare (", () => {
    expect(unstyled("[a](b (c(d))", "underline")).toBe(true)
    expect(at("[a](b (c))", "a")).toEqual(LINK)
    expect(at("[a](b (c\\(d))", "a")).toEqual(LINK)
  })
})

/**
 * Per letter, the emphasis / strong / code / link flags commonmark.js 0.31 gives 540 random inline
 * strings (tests/fixtures/commonmark-inline.json, generated once). Ours must agree on every one.
 */
describe("inline rules agree with commonmark.js", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/commonmark-inline.json", import.meta.url), "utf8")) as {
    cases: [string, string][]
  }

  function flags(text: string): string {
    const styles = paint(text)
    const out: string[] = []
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!
      const st = styles[i]!
      if (!/[a-z]/.test(ch) || st.dimColor) continue // markers and link destinations are not visible text
      out.push(ch + (st.italic ? "e" : "") + (st.bold ? "s" : "") + (st.backgroundColor === PALETTE.inlineBg ? "c" : "") + (st.underline ? "l" : ""))
    }
    return out.join(" ")
  }

  test("the fixture is what we think it is", () => {
    expect(fixture.cases.length).toBe(540)
    expect(fixture.cases.some(([, f]) => /\b[a-z]e[a-z]*\b/.test(f))).toBe(true)
    expect(fixture.cases.some(([, f]) => /\b[a-z]s[a-z]*\b/.test(f))).toBe(true)
    expect(fixture.cases.some(([, f]) => /\b[a-z]c[a-z]*\b/.test(f))).toBe(true)
    expect(fixture.cases.some(([, f]) => /\b[a-z]l[a-z]*\b/.test(f))).toBe(true)
  })

  test("every case", () => {
    const wrong: string[] = []
    for (const [text, expected] of fixture.cases) {
      const got = flags(text)
      if (got !== expected) wrong.push(`${JSON.stringify(text)}\n  commonmark.js: ${expected}\n  ours:         ${got}`)
    }
    expect(wrong.slice(0, 5).join("\n")).toBe("")
  })
})

describe("validity", () => {
  test("every run of these mixed drafts is a valid range", () => {
    const drafts = [
      "# T\n\n- [ ] a **b** `c`\n  > q *it* [l](u)\n\n| a | b |\n|---|---|\n| 1 | <b>2</b> |\n\n```ts\nx\n```\n---\n\\*x\\*",
      "日本語 **太字** 😀 *斜体* `コード` [リンク](https://例.jp/パス) <thinking>x</thinking>",
      "> - a\n>   - [x] b\n> ```\n> c\n> ```\n1) d\n2) e\n\n    code\n",
      "a\r\n===\r\n[r]: /u\r\n[r] and ![i][r]\r\n",
    ]
    for (const d of drafts) {
      expectValidRuns(d)
      expectValidRuns(d, { codeOnly: true })
    }
  })
})
