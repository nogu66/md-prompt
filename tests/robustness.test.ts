import { describe, expect, test } from "bun:test"
import { MAX_CHARS, PALETTE, decorateMarkdown } from "../plugins/md-prompt/hooks/lib/mdprompt"
import { paintFor } from "../plugins/md-prompt/hooks/lib/mode"
import { expectValidRuns } from "./helpers"

const N = MAX_CHARS
/** `piece` repeated up to exactly `n` characters. */
const repeat = (piece: string, n = N) => piece.repeat(Math.ceil(n / piece.length)).slice(0, n)

/**
 * CPU milliseconds (user + system), best of a few runs. CPU time rather than the wall clock, so a busy
 * machine (parallel test runs, a video render) cannot fail the test: a quadratic blow-up still costs
 * seconds of CPU, a linear pass costs a few milliseconds.
 */
function bestMs(text: string, options = {}): number {
  let best = Infinity
  for (let i = 0; i < 3; i++) {
    const before = process.cpuUsage()
    decorateMarkdown(text, options)
    const used = process.cpuUsage(before)
    best = Math.min(best, (used.user + used.system) / 1000)
  }
  return best
}

describe("limits", () => {
  test("a draft over MAX_CHARS is left alone, one at the limit is painted", () => {
    expect(decorateMarkdown("**a** ".repeat(MAX_CHARS))).toEqual([])
    expect(decorateMarkdown(`# h\n${"x".repeat(MAX_CHARS - 4)}`).length).toBeGreaterThan(0)
    expect(decorateMarkdown(`${"x".repeat(MAX_CHARS)}y`)).toEqual([])
    expect(decorateMarkdown("x".repeat(MAX_CHARS + 1), { codeOnly: true })).toEqual([])
  })
})

describe("performance: 60000 characters of hostile input stay under 100 ms", () => {
  // each is a shape that makes a naive implementation quadratic (lazy regex + look-behind, rescanning
  // for a closer, re-walking a stack); the point is that every one of them is linear here
  const cases: Record<string, string> = {
    "*a*a*a...": repeat("*a"),
    "**** (one long run)": repeat("**"),
    "* * * ...": repeat("* "),
    "_a_a_a...": repeat("_a"),
    "~~a~~a...": repeat("~~a"),
    "***a**b*...": repeat("***a**b*"),
    "**a*...": repeat("**a*"),
    "[[[[...": repeat("["),
    "]]]]...": repeat("]"),
    "[a][a][a]...": repeat("[a]"),
    "[a](b [a](b ...": repeat("[a](b "),
    "[a](x[a](x...": repeat("[a](x"),
    "![[![[...": repeat("!["),
    "[a][ [a][ ...": repeat("[a]["),
    "unclosed refs with a definition": `[x]: y\n${repeat("[a][x] [x] [[x]]", N - 8)}`,
    "nested brackets around a definition": `[x]: y\n${"[".repeat(N / 4)}x${"]".repeat(N / 4)}`,
    "one huge line of | cells": `|${repeat("a|", N - 2)}`,
    "a huge table body": `| a | b |\n|---|---|\n${repeat("x | y ", N - 30)}`,
    "many delimiter-looking rows": repeat("|-|\n"),
    "backticks only": repeat("`"),
    "backtick runs of every length": Array.from({ length: 400 }, (_, i) => `${"`".repeat(i + 1)}x`).join(" ").slice(0, N),
    "alternating backtick runs": repeat("` `` ``` "),
    "unclosed backtick with long text": `\`${repeat("word ", N - 1)}`,
    "quote markers on one line": repeat("> "),
    "quote markers on many lines": repeat("> > > > > > > > > > > > > > > > > > > > > > > > > > >\n"),
    "list markers on one line": repeat("- "),
    "deeply nested indented list": Array.from({ length: 300 }, (_, i) => `${" ".repeat(i * 2)}- x`).join("\n").slice(0, N),
    "a full stack then thousands of blank lines": `${"- ".repeat(30)}x\n${"\n".repeat(N - 70)}`,
    "a full stack of quotes then lines": `${"> ".repeat(30)}x\n${repeat("> > > > > > > > > > > > > > > > > > > > x\n", N - 70)}`,
    "list items separated by blank lines": repeat("- a\n\n\n\n"),
    "tab-indented nesting": repeat("\t- a\n\t\t- b\n"),
    "indented code and blanks": repeat("    a\n\n"),
    "unclosed tag starts": repeat("<a "),
    "unclosed quoted attribute starts": repeat('<a "'),
    "alternating quote kinds in tags": repeat('<a x=\'<a x="'),
    "bare <": repeat("<"),
    "unclosed comment starts": repeat("<!--"),
    "unclosed inline comments": repeat("a <!-- b\n"),
    "comment block starts": repeat("<!--\n"),
    "entity starts": repeat("&amp"),
    "url starts": repeat("http://a"),
    "www starts": repeat("(www."),
    "url with trailing parens": `https://a.com/${")".repeat(N - 20)}`,
    "url with trailing entities": `https://a.com/${"&a;".repeat(N / 3 - 10)}`,
    "autolink starts": repeat("<a:b<a:b"),
    "email autolink starts": repeat("<a@b<a@b."),
    "fences opened and never closed": repeat("```a\nb\n"),
    "one huge unclosed fence": `\`\`\`ts\n${repeat('const a = "b" // c\n', N - 10)}`,
    "fences in quotes": repeat("> ```\n> a\n"),
    "backslashes": repeat("\\*"),
    "headings with closing runs": repeat("# a #\n"),
    "hash runs": repeat("#"),
    "setext heading pairs": repeat("a\n===\n"),
    "definitions": repeat("[a]: b\n"),
    "malformed definitions": repeat("[a]: <b\n"),
    "footnotes": repeat("[^1]: a\n[^1]"),
    "CRLF and lone CR": repeat("a\r\n*b*\r"),
    "Japanese emphasis": repeat("日本語**「太字」**です"),
    "emoji emphasis": repeat("😀*a*😀_b_"),
    "one 60000-character word": repeat("word"),
  }

  for (const [name, text] of Object.entries(cases)) {
    test(name, () => {
      expect(text.length).toBeLessThanOrEqual(N)
      expect(bestMs(text)).toBeLessThan(100)
      expect(bestMs(text, { codeOnly: true })).toBeLessThan(100)
    })
  }

  test("what the hostile inputs paint is still valid", () => {
    for (const name of ["*a*a*a...", "[a](x[a](x...", "unclosed tag starts", "a full stack of quotes then lines", "footnotes"]) {
      expectValidRuns(cases[name]!)
    }
  })
})

// ---- random Markdown-shaped input ----------------------------------------------------------------

/** mulberry32: a small seeded generator, so a failure is reproducible from the seed printed with it. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PIECES = [
  "*", "**", "***", "_", "__", "~~", "~", "`", "``", "```", "```ts\n", "```\n", "~~~", "~~~py\n",
  "#", "## ", "###### ", "> ", ">> ", "> > ", "- ", "* ", "+ ", "1. ", "2) ", "10. ", "- [ ] ", "- [x] ", "[ ]", "[x]",
  "|", "| a | b |", "|---|:-:|", "|:--|--:|", "---", "***", "___", "===", "- - -",
  "    ", "\t", "  ", "   ", " ", "  ", "[", "]", "(", ")", "![", "](", "](x)", "](x \"t\")", "[a]: /u", "[a]: <u> 't'",
  "[^1]", "[^1]: n", "[a][a]", "[a][]", "<", ">", "<b>", "</b>", "<br/>", "<thinking>", "<a href=\"x\">", "<!--", "-->", "<https://x.y>", "<a@b.c>",
  "&amp;", "&", "&#39;", "\\", "\\*", "\\`", "http://a.b/c_d", "https://x.y/(z)).", "www.x.y", "$", "{", "}", "'", "\"", ";", "!", "?", ".", ",", ":",
  "日本語", "太字", "「", "」", "😀", "é", " ", "　", " ",
  "a", "b", "word", "b1", "_x_", "**b**", "*i*", "`c`", "~~s~~", "[l](u)",
  "\n", "\n", "\n", "\n\n", "\r\n", "\r",
]

function randomDraft(next: () => number): string {
  const count = 1 + Math.floor(next() * 70)
  let s = ""
  for (let i = 0; i < count; i++) s += PIECES[Math.floor(next() * PIECES.length)]
  return s
}

const KEYS = new Set(["start", "end", "color", "backgroundColor", "dimColor", "bold", "italic", "underline", "strikethrough"])

describe("fuzz: random Markdown-shaped drafts", () => {
  test("no exception, every run valid, in both modes (4000 drafts)", () => {
    const next = rng(20261001)
    for (let n = 0; n < 4000; n++) {
      const text = randomDraft(next)
      for (const options of [{}, { codeOnly: true }]) {
        let runs
        try {
          runs = decorateMarkdown(text, options)
        } catch (err) {
          throw new Error(`threw on draft #${n} ${JSON.stringify(text)} ${JSON.stringify(options)}: ${err}`)
        }
        for (const d of runs) {
          const where = `draft #${n} ${JSON.stringify(text)} run ${JSON.stringify(d)}`
          if (!(d.start >= 0 && d.end <= text.length && d.end > d.start)) throw new Error(`bad range: ${where}`)
          if (/[\n\r]/.test(text.slice(d.start, d.end))) throw new Error(`run holds a line break: ${where}`)
          if (Object.keys(d).some((k) => !KEYS.has(k))) throw new Error(`unknown key: ${where}`)
          if (!Number.isInteger(d.start) || !Number.isInteger(d.end)) throw new Error(`non-integer: ${where}`)
        }
      }
    }
  })

  test("code mode paints a subset of what the full mode paints (4000 drafts)", () => {
    const next = rng(7)
    for (let n = 0; n < 4000; n++) {
      const text = randomDraft(next)
      const full = new Set(decorateMarkdown(text).map((d) => JSON.stringify(d)))
      for (const d of decorateMarkdown(text, { codeOnly: true })) {
        if (!full.has(JSON.stringify(d))) throw new Error(`code-only run missing from the full paint: draft ${JSON.stringify(text)} run ${JSON.stringify(d)}`)
      }
    }
  })

  test("code mode paints only code: card, chip, fence, language, tokens", () => {
    const next = rng(99)
    const codeColors = new Set<string>([PALETTE.codeFg, PALETTE.fence, PALETTE.lang, PALETTE.inlineFg, ...Object.values(PALETTE.token)])
    for (let n = 0; n < 3000; n++) {
      const text = randomDraft(next)
      for (const d of decorateMarkdown(text, { codeOnly: true })) {
        const isCode = d.backgroundColor === PALETTE.codeBg || d.backgroundColor === PALETTE.inlineBg || (d.color !== undefined && codeColors.has(d.color) && d.dimColor === undefined)
        if (!isCode || d.italic || d.underline || d.strikethrough || d.dimColor) throw new Error(`non-code run in code mode: draft ${JSON.stringify(text)} run ${JSON.stringify(d)}`)
      }
    }
  })

  test("the same draft always paints the same way, and paintFor agrees with decorateMarkdown", () => {
    const next = rng(5)
    for (let n = 0; n < 500; n++) {
      const text = randomDraft(next)
      expect(decorateMarkdown(text)).toEqual(decorateMarkdown(text))
      expect(paintFor("on", text)).toEqual(decorateMarkdown(text))
      expect(paintFor("off", text)).toEqual([])
    }
  })

  test("a few big random drafts (about 20000 characters) are fast and valid", () => {
    const next = rng(31337)
    for (let n = 0; n < 5; n++) {
      let text = ""
      while (text.length < 20000) text += randomDraft(next)
      expect(bestMs(text)).toBeLessThan(100)
      expectValidRuns(text)
      expectValidRuns(text, { codeOnly: true })
    }
  })
})

describe("typing: every prefix of a realistic draft paints without a problem", () => {
  const draft = [
    "# Refactor plan",
    "",
    "Fix the `add` helper: it should **not** throw on *empty* input. See [the docs](https://example.com/docs_v2).",
    "",
    "- [x] read the code",
    "- [ ] write tests",
    "  1. unit",
    "  2. e2e",
    "",
    "> Note: keep the API stable.",
    "> ```ts",
    "> export const add = (a: number, b: number) => a + b",
    "> ```",
    "",
    "| Step | Owner |",
    "|:-----|------:|",
    "| plan | me |",
    "",
    "1. run `bun test`",
    "   ```bash",
    "   bun test --watch",
    "   ```",
    "",
    "Setext",
    "------",
    "",
    "    indented code",
    "",
    "<thinking>ok &amp; done</thinking> <!-- todo -->",
    "日本語の **太字** と *斜体* と ~~打消し~~ 😀 [^1]",
    "",
    "[^1]: a note",
    "[docs]: https://example.com \"Docs\"",
    "---",
  ].join("\n")

  test("no prefix throws or yields a bad run", () => {
    for (let i = 0; i <= draft.length; i++) {
      const prefix = draft.slice(0, i)
      for (const options of [{}, { codeOnly: true }]) {
        for (const d of decorateMarkdown(prefix, options)) {
          if (!(d.start >= 0 && d.end <= prefix.length && d.end > d.start) || /[\n\r]/.test(prefix.slice(d.start, d.end))) {
            throw new Error(`bad run at prefix length ${i}: ${JSON.stringify(d)}`)
          }
        }
      }
    }
  })

  test("the whole draft paints every kind of thing", () => {
    const runs = decorateMarkdown(draft)
    const has = (pred: (d: (typeof runs)[number]) => boolean) => runs.some(pred)
    expect(has((d) => d.color === PALETTE.heading && d.underline === true)).toBe(true) // h1
    expect(has((d) => d.color === PALETTE.bullet)).toBe(true)
    expect(has((d) => d.color === PALETTE.taskDone)).toBe(true)
    expect(has((d) => d.color === PALETTE.taskTodo)).toBe(true)
    expect(has((d) => d.backgroundColor === PALETTE.codeBg)).toBe(true)
    expect(has((d) => d.backgroundColor === PALETTE.inlineBg)).toBe(true)
    expect(has((d) => d.color === PALETTE.tag)).toBe(true)
    expect(has((d) => d.color === PALETTE.entity)).toBe(true)
    expect(has((d) => d.strikethrough === true)).toBe(true)
    expect(has((d) => d.bold === true && d.dimColor === undefined && d.color === undefined)).toBe(true) // bold text / table header
  })
})
