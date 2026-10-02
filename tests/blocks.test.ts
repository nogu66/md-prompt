import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { PALETTE, decorateMarkdown } from "../plugins/md-prompt/hooks/lib/mdprompt"
import { at, expectValidRuns, paint, unstyled } from "./helpers"

const BULLET = { color: PALETTE.bullet, bold: true }

describe("lists", () => {
  test("bullets - * + are coloured and bold, the text is left alone", () => {
    for (const marker of ["-", "*", "+"]) {
      const text = `${marker} item`
      expect(at(text, marker)).toMatchObject(BULLET)
      expect(at(text, "item")).toEqual({})
    }
  })

  test("ordered markers 1. and 1) are coloured with their number", () => {
    expect(at("1. first", "1.")).toMatchObject(BULLET)
    expect(at("2) second", "2)")).toMatchObject(BULLET)
    expect(at("10. ten", "10.")).toMatchObject(BULLET)
    expect(at("1. first", "first")).toEqual({})
  })

  test("a marker needs a space after it: *emphasis*, -x and 1.5 are not lists", () => {
    expect(at("*it*", "it")).toMatchObject({ italic: true })
    expect(at("-x", "-x")).toEqual({})
    expect(at("1.5 million", "1.5")).toEqual({})
    expect(paint("**bold** start").some((s) => s.color === PALETTE.bullet)).toBe(false)
  })

  test("nested items by indentation, at any depth", () => {
    const text = "- a\n  - b\n    - c\n      1. d"
    const styles = paint(text)
    expect(styles[text.indexOf("- b")]).toMatchObject(BULLET)
    expect(styles[text.indexOf("- c")]).toMatchObject(BULLET)
    expect(styles[text.indexOf("1. d")]).toMatchObject(BULLET)
    expect(at(text, "d")).toEqual({})
  })

  test("inline Markdown works inside an item", () => {
    expect(at("- a **b** `c`", "b")).toMatchObject({ bold: true })
    expect(at("1. see [x](http://y)", "x")).toMatchObject({ underline: true })
  })

  test("an empty item is still a bullet", () => {
    expect(at("-", "-")).toMatchObject(BULLET)
    expect(at("- a\n-\n- b", "-", 4)).toMatchObject(BULLET)
  })

  test("`- - -` and `* * *` are rules, not bullets", () => {
    expect(at("- - -", "- - -")).toEqual({ dimColor: true })
    expect(at("* * *", "* * *")).toEqual({ dimColor: true })
  })

  test("a bullet can interrupt a paragraph, an ordered item only from 1", () => {
    expect(paint("intro\n- a")[6]).toMatchObject(BULLET)
    expect(paint("intro\n1. a")[6]).toMatchObject(BULLET)
    expect(paint("intro\n2. a")[6]).toEqual({})
    expect(paint("intro\n-\nmore")[6]).toEqual({}) // an empty bullet cannot, and a lone `-` is not a setext underline either
  })

  test("a wrapped line and a lazy line stay part of the item's paragraph", () => {
    const text = "- one\n  two *it*\nthree *it2*"
    expect(at(text, "it")).toMatchObject({ italic: true })
    expect(at(text, "it2")).toMatchObject({ italic: true })
    expect(at(text, "two")).toEqual({})
  })

  test("a new marker at the same indent starts a new item", () => {
    const text = "- a\n- b\n\n1. c\n2. d"
    const styles = paint(text)
    for (const m of ["- a", "- b", "1. c", "2. d"]) expect(styles[text.indexOf(m)]).toMatchObject(BULLET)
  })

  test("two spaces then a marker is still a top-level item (up to 3 spaces)", () => {
    expect(at("  - a", "-")).toMatchObject(BULLET)
  })

  test("an item stays open across blank lines: an indented line after them is still its text", () => {
    const text = "- a\n\n\n    x *it*"
    expect(at(text, "x")).toEqual({})
    expect(at(text, "it")).toMatchObject({ italic: true })
    expect(at("- a\n\n\nplain *it*", "plain")).toEqual({}) // an unindented line ends the item
  })

  test("a tab after the marker is fine", () => {
    expect(at("-\tItem", "-")).toMatchObject(BULLET)
    expect(at("-\tItem", "Item")).toEqual({})
  })

  test("nesting is capped, and past the cap a marker is just text", () => {
    const text = `${"- ".repeat(40)}x`
    expectValidRuns(text)
    expect(decorateMarkdown(text).length).toBeLessThan(80)
  })
})

describe("task lists", () => {
  test("unchecked and checked boxes get different colours", () => {
    expect(at("- [ ] todo", "[ ]")).toMatchObject({ color: PALETTE.taskTodo, bold: true })
    expect(at("- [x] done", "[x]")).toMatchObject({ color: PALETTE.taskDone, bold: true })
    expect(at("- [X] done", "[X]")).toMatchObject({ color: PALETTE.taskDone })
    expect(PALETTE.taskTodo).not.toBe(PALETTE.taskDone)
  })

  test("the task text is left alone", () => {
    expect(at("- [ ] todo", "todo")).toEqual({})
    expect(at("- [x] done", "done")).toEqual({})
  })

  test("works in ordered and nested items, and with an empty text", () => {
    expect(at("1. [x] one", "[x]")).toMatchObject({ color: PALETTE.taskDone })
    expect(at("- a\n  - [ ] b", "[ ]")).toMatchObject({ color: PALETTE.taskTodo })
    expect(at("- [ ]", "[ ]")).toMatchObject({ color: PALETTE.taskTodo })
  })

  test("a box that is not followed by a space, or not opening an item, is plain", () => {
    expect(at("- [x]done", "[x]done")).toEqual({})
    expect(at("- [y] other", "[y]")).toEqual({})
    expect(at("- text [ ] later", "[ ]")).toEqual({})
  })

  test("a box opening a line is a task even with no bullet before it", () => {
    expect(at("[ ] todo", "[ ]")).toMatchObject({ color: PALETTE.taskTodo, bold: true })
    expect(at("[x] done", "[x]")).toMatchObject({ color: PALETTE.taskDone, bold: true })
    expect(at("[X] done", "[X]")).toMatchObject({ color: PALETTE.taskDone })
    expect(at("[ ]", "[ ]")).toMatchObject({ color: PALETTE.taskTodo })
    expect(at("[x] done", "done")).toEqual({})
    expect(at("  [x] indented", "[x]")).toMatchObject({ color: PALETTE.taskDone })
  })

  test("every line of a bulletless checklist gets its box, under a line of text or in a quote too", () => {
    const text = "todo:\n[x] one\n[ ] two\n[x] three"
    const styles = paint(text)
    expect(styles[text.indexOf("[x] one")]).toMatchObject({ color: PALETTE.taskDone })
    expect(styles[text.indexOf("[ ] two")]).toMatchObject({ color: PALETTE.taskTodo })
    expect(styles[text.indexOf("[x] three")]).toMatchObject({ color: PALETTE.taskDone })
    expect(at("> [ ] quoted", "[ ]")).toMatchObject({ color: PALETTE.taskTodo })
    expect(at("> [ ] quoted", "quoted")).toEqual({ italic: true })
    expectValidRuns(text)
  })

  test("the text after a bulletless box keeps its inline Markdown", () => {
    expect(at("[x] **bold** and `code`", "bold")).toMatchObject({ bold: true })
    expect(at("[x] **bold** and `code`", "code")).toMatchObject({ backgroundColor: PALETTE.inlineBg })
    expect(at("[ ] see [docs](https://a.dev)", "docs")).toMatchObject({ underline: true })
  })

  test("a bracket that is not a box at the start of a line is plain", () => {
    expect(at("[x]done", "[x]done")).toEqual({})
    expect(at("[y] other", "[y]")).toEqual({})
    expect(at("text [ ] later", "[ ]")).toEqual({})
    expect(at("- [x] [ ] twice", "[ ]")).toEqual({})
    expect(at("[x]: https://a.dev", "x")).toMatchObject({ color: PALETTE.link }) // still a link definition
    expect(at("    [x] code", "[x] code")).toMatchObject({ backgroundColor: PALETTE.codeBg })
    expect(at("```\n[x] code\n```", "[x] code")).toMatchObject({ backgroundColor: PALETTE.codeBg, color: PALETTE.codeFg })
  })

  test("code-only mode paints no box", () => {
    expect(at("[x] done", "[x]", 0, { codeOnly: true })).toEqual({})
  })
})

describe("block quotes", () => {
  test("the marker is grey, the text italic", () => {
    expect(at("> a", ">")).toEqual({ color: PALETTE.fence })
    expect(at("> a", "a")).toEqual({ italic: true })
  })

  test("nested quotes: every > is grey, `>>` too", () => {
    const spaced = paint("> > deep")
    expect(spaced[0]).toEqual({ color: PALETTE.fence })
    expect(spaced[2]).toEqual({ color: PALETTE.fence })
    const compact = paint(">> deep")
    expect(compact[0]).toEqual({ color: PALETTE.fence })
    expect(compact[1]).toEqual({ color: PALETTE.fence })
    expect(at(">> deep", "deep")).toEqual({ italic: true })
  })

  test("inline Markdown inside a quote composes with the italic", () => {
    expect(at("> **b**", "b")).toMatchObject({ bold: true, italic: true })
    expect(at("> `c`", "c")).toMatchObject({ backgroundColor: PALETTE.inlineBg })
  })

  test("a lazy line keeps the quote going; a blank line ends it", () => {
    const text = "> a\nlazy\n\nplain"
    expect(at(text, "lazy")).toEqual({ italic: true })
    expect(at(text, "plain")).toEqual({})
  })

  test("a quote ends where a rule or a heading starts", () => {
    expect(at("> a\n---", "---")).toEqual({ dimColor: true })
    expect(at("> a\n# H", "H")).toMatchObject({ bold: true })
    expect(at("> a\n# H", "H").italic).toBeUndefined()
  })

  test("a fenced block inside a quote is a code card, from after the `> `", () => {
    const text = "> ```ts\n> const a = 1\n> ```"
    expect(at(text, ">")).toEqual({ color: PALETTE.fence })
    expect(at(text, "const")).toMatchObject({ color: PALETTE.token.keyword, backgroundColor: PALETTE.codeBg })
    expect(at(text, "```")).toMatchObject({ backgroundColor: PALETTE.codeBg, color: PALETTE.fence })
    expect(at(text, "const").italic).toBeUndefined()
    expect(paint(text)[text.indexOf("\n> const") + 1]).toEqual({ color: PALETTE.fence }) // the second `>`
  })

  test("a quoted fence ends with its quote", () => {
    const text = "> ```\n> a\nplain *it*"
    expect(at(text, "a", 6).backgroundColor).toBe(PALETTE.codeBg)
    expect(at(text, "it")).toMatchObject({ italic: true })
    expect(at(text, "plain")).toEqual({})
  })

  test("a list inside a quote, a quote inside a list", () => {
    expect(at("> - a", "-")).toMatchObject(BULLET)
    expect(at("- > q", ">")).toEqual({ color: PALETTE.fence })
    expect(at("- > q", "q")).toEqual({ italic: true })
  })

  test("an empty quote line", () => {
    const text = "> a\n>\n> b"
    expect(at(text, ">", 4)).toEqual({ color: PALETTE.fence })
    expect(at(text, "b")).toEqual({ italic: true })
  })

  test("`>` needs no space after it", () => {
    expect(at(">tight", "tight")).toEqual({ italic: true })
  })
})

describe("headings", () => {
  test("each level looks different (h1 to h6)", () => {
    const seen = new Set<string>()
    for (let level = 1; level <= 6; level++) {
      const text = `${"#".repeat(level)} Title`
      expect(at(text, "#".repeat(level))).toEqual({ dimColor: true })
      const style = at(text, "Title")
      expect(style.color).toBe(PALETTE.heading)
      seen.add(JSON.stringify(style))
    }
    expect(seen.size).toBe(6)
  })

  test("h1 is bold and underlined, h2 bold, h6 faint", () => {
    expect(at("# a", "a")).toMatchObject({ bold: true, underline: true })
    expect(at("## a", "a")).toMatchObject({ bold: true })
    expect(at("###### a", "a")).toMatchObject({ dimColor: true, italic: true })
  })

  test("a closing run of # is dimmed and not part of the title", () => {
    const text = "## Title ##"
    expect(at(text, "Title")).toMatchObject({ bold: true })
    expect(at(text, "##", 3)).toEqual({ dimColor: true })
    expect(at("# a #b", "#b")).toMatchObject({ bold: true }) // not a closing run: no space before it, text after it
    expect(at("# a\\#", "a\\#")).toMatchObject({ bold: true })
  })

  test("an empty heading paints only its marker", () => {
    expect(at("#", "#")).toEqual({ dimColor: true })
    expect(at("## ##", "##")).toEqual({ dimColor: true })
  })

  test("not headings: no space, seven hashes, four-space indent after a blank line", () => {
    expect(unstyled("#hashtag", "bold", "color")).toBe(true)
    expect(unstyled("####### seven", "bold", "color")).toBe(true)
    expect(at("a\n\n    # code", "# code").backgroundColor).toBe(PALETTE.codeBg)
  })

  test("up to three spaces of indent are allowed", () => {
    expect(at("   # a", "a")).toMatchObject({ bold: true })
  })

  test("a heading interrupts a paragraph and needs no blank line", () => {
    expect(at("text\n# H\ntext", "H")).toMatchObject({ bold: true })
  })

  test("setext: === is h1 and --- is h2, the underline is dimmed", () => {
    expect(at("Title\n=====", "Title")).toMatchObject({ bold: true, underline: true })
    expect(at("Title\n=====", "=====")).toEqual({ dimColor: true })
    expect(at("Sub\n---", "Sub")).toMatchObject({ bold: true })
    expect(at("Sub\n---", "Sub").underline).toBeUndefined()
    expect(at("Sub\n---", "---")).toEqual({ dimColor: true })
  })

  test("setext: inline Markdown works in the title", () => {
    const text = "one *two*\n---"
    expect(at(text, "one")).toMatchObject({ bold: true })
    expect(at(text, "two")).toMatchObject({ bold: true, italic: true })
  })

  test("setext is only for a single line that does not end like a sentence: a divider stays a divider", () => {
    // CommonMark would make each of these a heading; in a prompt they are a paragraph and a `---`
    for (const under of ["---", "====="]) {
      expect(at(`Two\nlines\n${under}`, "Two")).toEqual({})
      expect(at(`Two\nlines\n${under}`, "lines")).toEqual({})
    }
    for (const sentence of ["以上です。", "Done.", "Note:", "Wow!", "a, b,", "これは説明：", "終わり！"]) {
      expect(at(`${sentence}\n---`, sentence)).toEqual({})
      expect(at(`${sentence}\n---`, "---")).toEqual({ dimColor: true })
    }
    expect(at("Do this?\n---", "Do this?")).toMatchObject({ bold: true }) // a question is a fine title
    expect(at("Section (v2)\n===", "Section")).toMatchObject({ bold: true, underline: true })
  })

  test("--- after a blank line is a rule, not a setext underline", () => {
    expect(at("text\n\n---", "text")).toEqual({})
    expect(at("text\n\n---", "---")).toEqual({ dimColor: true })
  })

  test("a setext underline must be one run of three or more: `= =`, `==` and a lone `-` are text", () => {
    expect(at("a\n= =", "= =")).toEqual({})
    expect(at("a\n==", "a")).toEqual({})
    expect(at("a\n-", "a")).toEqual({}) // typing `- item` under a line must not flash it as a heading
    expect(at("a\n- ", "a")).toEqual({})
    expect(at("a\n---", "a")).toMatchObject({ bold: true })
  })

  test("emphasis inside a heading still works, and links keep their colour", () => {
    expect(at("# a *b*", "b")).toMatchObject({ bold: true, italic: true })
    expect(at("## see [x](u)", "x")).toMatchObject({ underline: true, color: PALETTE.link })
  })
})

describe("thematic breaks", () => {
  test("--- *** ___ and spaced ones are dimmed as a whole", () => {
    for (const rule of ["---", "***", "___", "- - -", "_ _ _", "----------", "  ***  "]) {
      expect(at(rule, rule.trim())).toEqual({ dimColor: true })
    }
  })

  test("--, ** and mixed characters are not rules", () => {
    expect(paint("--").every((s) => s.dimColor === undefined)).toBe(true)
    expect(paint("**").every((s) => s.dimColor === undefined)).toBe(true)
    expect(paint("-*-").every((s) => s.dimColor === undefined)).toBe(true)
    expect(at("***bold***", "bold")).toMatchObject({ bold: true, italic: true }) // emphasis, not a rule
  })

  test("a rule interrupts a paragraph when it is not made of dashes", () => {
    expect(at("text\n***", "***")).toEqual({ dimColor: true })
    expect(at("text\n___", "___")).toEqual({ dimColor: true })
  })
})

describe("tables", () => {
  const table = "| Name | Qty |\n|:-----|----:|\n| apple | 3 |\n| **pear** | `4` |"

  test("header cells are bold, pipes are dimmed", () => {
    expect(at(table, "Name")).toEqual({ bold: true })
    expect(at(table, "Qty")).toEqual({ bold: true })
    expect(paint(table)[0]).toEqual({ dimColor: true })
    expect(paint(table)[table.indexOf("Name") + 5]).toEqual({ dimColor: true })
  })

  test("the delimiter row is dimmed whole", () => {
    expect(at(table, "|:-----|----:|")).toEqual({ dimColor: true })
  })

  test("body cells are plain text with inline Markdown", () => {
    expect(at(table, "apple")).toEqual({})
    expect(at(table, "pear")).toMatchObject({ bold: true })
    expect(at(table, "4")).toMatchObject({ backgroundColor: PALETTE.inlineBg })
    expect(paint(table)[table.indexOf("| apple")]).toEqual({ dimColor: true })
  })

  test("pipes at the edges are optional", () => {
    const text = "a | b\n--|--\n1 | 2"
    expect(at(text, "a")).toEqual({ bold: true })
    expect(at(text, "--|--")).toEqual({ dimColor: true })
    expect(paint(text)[2]).toEqual({ dimColor: true })
    expect(at(text, "1")).toEqual({})
  })

  test("a row with fewer or more cells than the header stays in the table", () => {
    const text = "| a | b |\n|---|---|\n| only |\n| x | y | z | w |\nafter"
    expect(paint(text)[text.indexOf("| only")]).toEqual({ dimColor: true })
    expect(paint(text)[text.indexOf("| x")]).toEqual({ dimColor: true })
    expect(at(text, "w")).toEqual({})
  })

  test("a table needs the header and the delimiter row to agree", () => {
    const text = "| a | b |\n|---|"
    expect(paint(text).every((s) => s.bold === undefined && s.dimColor === undefined)).toBe(true)
    expect(unstyled("| a |\n|---|---|", "bold")).toBe(true)
  })

  test("a header without a pipe is not a table header", () => {
    expect(unstyled("a\n|-|", "bold")).toBe(true)
  })

  test("an escaped pipe is text, not a cell edge", () => {
    const text = "| a \\| b | c |\n|---|---|\n| 1 | 2 |"
    expect(at(text, "a \\| b")).toEqual({ bold: true })
    expect(paint(text)[text.indexOf("\\|") + 1]).toEqual({ bold: true })
  })

  test("typing a table: nothing breaks at any prefix, and it lights up once the delimiter row fits", () => {
    const full = "| Name | Qty |\n|------|-----|\n| apple | 3 |"
    for (let i = 1; i <= full.length; i++) expectValidRuns(full.slice(0, i))
    expect(at(full, "Name")).toEqual({ bold: true })
    expect(paint(full.slice(0, full.indexOf("\n|------|-----|") + 5)).every((s) => s.bold === undefined)).toBe(true)
  })

  test("the table ends at a blank line or at a line without a pipe", () => {
    const text = "| a |\n|---|\n| 1 |\n\n| loose | row |\nplain *it*"
    expect(paint(text)[text.indexOf("| 1")]).toEqual({ dimColor: true }) // still the table
    expect(paint(text)[text.indexOf("| loose")]).toEqual({}) // after the blank line, with no delimiter row: just text
    expect(at(text, "loose")).toEqual({})
    expect(at(text, "it")).toMatchObject({ italic: true })
    const glued = "| a |\n|---|\n| 1 |\nplain *it*"
    expect(at(glued, "plain")).toEqual({}) // a line without a pipe leaves the table
    expect(at(glued, "it")).toMatchObject({ italic: true })
  })

  test("a table inside a list item and inside a quote", () => {
    const inList = "- | a | b |\n  |---|---|\n  | 1 | 2 |"
    expect(at(inList, "a")).toEqual({ bold: true })
    expect(at(inList, "|---|---|")).toEqual({ dimColor: true })
    const inQuote = "> | a | b |\n> |---|---|\n> | 1 | 2 |"
    expect(at(inQuote, "a")).toEqual({ bold: true })
  })

  test("text before the header line stays a paragraph", () => {
    const text = "Results:\n| a | b |\n|---|---|"
    expect(at(text, "Results:")).toEqual({})
    expect(at(text, "a")).toEqual({ bold: true })
  })

  test("alignment colons are part of the dimmed delimiter row", () => {
    expect(at("| a | b | c |\n|:--|:-:|--:|", "|:--|:-:|--:|")).toEqual({ dimColor: true })
  })
})

describe("indented code", () => {
  test("four spaces after a blank line is a code card", () => {
    const text = "intro\n\n    code line\n    more"
    expect(at(text, "code line")).toMatchObject({ backgroundColor: PALETTE.codeBg, color: PALETTE.codeFg })
    expect(at(text, "more")).toMatchObject({ backgroundColor: PALETTE.codeBg })
    expect(at(text, "intro")).toEqual({})
  })

  test("a tab is four columns", () => {
    expect(at("a\n\n\tcode", "code").backgroundColor).toBe(PALETTE.codeBg)
  })

  test("a blank line inside the block keeps it going; a less indented line ends it", () => {
    const text = "\n    a\n\n    b\n\nplain *it*"
    expect(at(text, "b").backgroundColor).toBe(PALETTE.codeBg)
    expect(at(text, "it")).toMatchObject({ italic: true })
  })

  test("it cannot interrupt a paragraph: an indented wrapped line is text", () => {
    const text = "para\n    wrapped *it*"
    expect(at(text, "wrapped")).toEqual({})
    expect(at(text, "it")).toMatchObject({ italic: true })
  })

  test("a list item's own indentation is not code, but four more columns are", () => {
    const wrapped = "- item\n    continued *it*"
    expect(at(wrapped, "continued")).toEqual({})
    const code = "- item\n\n      code in item"
    expect(at(code, "code in item").backgroundColor).toBe(PALETTE.codeBg)
    const sub = "1. one\n\n    - four spaces is a nested item here"
    expect(at(sub, "-")).toMatchObject(BULLET)
  })

  test("the body is a plain card: no token colours, no Markdown", () => {
    const text = "\n    const x = 1 // **c**"
    expect(at(text, "const x = 1 // **c**")).toEqual({ backgroundColor: PALETTE.codeBg, color: PALETTE.codeFg })
  })

  test("three spaces are not code", () => {
    expect(at("\n   three *it*", "three")).toEqual({})
  })
})

describe("fenced code inside containers", () => {
  const list = "1. Run:\n   ```bash\n   npm test\n   ```\n2. Next *it*"

  test("a fence in a list item is a card from the item's text column", () => {
    expect(at(list, "npm")).toMatchObject({ backgroundColor: PALETTE.codeBg })
    expect(at(list, "```")).toMatchObject({ backgroundColor: PALETTE.codeBg, color: PALETTE.fence })
    expect(at(list, "bash", list.indexOf("```"))).toMatchObject({ color: PALETTE.lang, bold: true })
    expect(at(list, "1.")).toMatchObject(BULLET)
    expect(at(list, "2.")).toMatchObject(BULLET)
    expect(at(list, "it")).toMatchObject({ italic: true })
  })

  test("the spaces that belong to the item are not painted", () => {
    expect(paint(list)[list.indexOf("\n   ```bash") + 1]).toEqual({})
  })

  test("a fence that is not indented ends the list and stands alone", () => {
    const text = "- a\n```\nx\n```"
    expect(at(text, "x").backgroundColor).toBe(PALETTE.codeBg)
    expect(at(text, "-")).toMatchObject(BULLET)
  })

  test("a fence left open by its item ends when the item does", () => {
    const text = "- ```\n  code\nplain *it*"
    expect(at(text, "code").backgroundColor).toBe(PALETTE.codeBg)
    expect(at(text, "plain")).toEqual({})
    expect(at(text, "it")).toMatchObject({ italic: true })
  })

  test("multi-line tokens inside a container are cut per line", () => {
    const text = "- ```c\n  /* one\n  two */ int y;\n  ```"
    expect(at(text, "one").color).toBe(PALETTE.token.comment)
    expect(at(text, "two */").color).toBe(PALETTE.token.comment)
    expect(at(text, "int")).toMatchObject({ color: PALETTE.token.keyword })
    expectValidRuns(text)
  })

  test("a longer closing fence closes; a shorter one does not", () => {
    expect(at("- ````\n  ```\n  in\n  ````\nout", "in").backgroundColor).toBe(PALETTE.codeBg)
    expect(at("- ````\n  ```\n  in\n  ````\nout", "out")).toEqual({})
  })
})

describe("link reference definitions and footnotes", () => {
  test("a definition: label coloured, colon and url dimmed, title dimmed italic", () => {
    const text = '[docs]: https://a.com/x_y "The Docs"'
    expect(at(text, "docs")).toEqual({ color: PALETTE.link })
    expect(at(text, "https://a.com/x_y")).toEqual({ dimColor: true })
    expect(at(text, '"The Docs"')).toEqual({ dimColor: true, italic: true })
    expect(at(text, "[")).toEqual({ dimColor: true })
    expect(at(text, "]:")).toEqual({ dimColor: true })
  })

  test("a definition without a title, and with an angle-bracket url", () => {
    expect(at("[a]: <https://x.y/z>", "<https://x.y/z>")).toEqual({ dimColor: true })
    expect(at("[a]: /path", "/path")).toEqual({ dimColor: true })
  })

  test("a definition makes reference links work, wherever it is", () => {
    const text = "see [the docs][d] and [d] and [d][]\n\n[d]: https://a.com"
    expect(at(text, "the docs")).toMatchObject({ underline: true, color: PALETTE.link })
    expect(at(text, "d", text.indexOf("and [d]") + 5)).toMatchObject({ underline: true })
    expect(paint(text)[text.indexOf("[d][]") + 1]).toMatchObject({ underline: true })
  })

  test("labels match without regard to case or spacing", () => {
    expect(at("[Foo   Bar]: /x\n\n[foo bar]", "foo bar", 16)).toMatchObject({ underline: true })
    expect(at("[FOO]: /x\n\n[text][foo]", "text")).toMatchObject({ underline: true })
  })

  test("an undefined reference is plain text: array[i][j], [x], [text][ref]", () => {
    for (const text of ["matrix[i][j]", "[x] and [ ] and [1]", "[text][ref]", "see [nothing]"]) {
      expect(paint(text).every((s) => s.underline === undefined)).toBe(true)
    }
    expect(paint("[a]: /x\n\nmatrix[i][j] and [a b]").filter((s) => s.underline).length).toBe(0)
  })

  test("a definition cannot interrupt a paragraph", () => {
    const text = "para\n[d]: /x\n\n[d]"
    expect(at(text, "[d]: /x")).toEqual({})
    expect(paint(text).every((s) => s.underline === undefined)).toBe(true)
  })

  test("not a definition: no url, junk after the url, brackets in the label", () => {
    expect(at("[a]:", "[a]:")).toEqual({})
    expect(at("[a]: b c", "[a]: b c")).toEqual({})
    expect(at("[a[b]]: /x", "[a[b]]: /x")).toEqual({})
  })

  test("a footnote definition: label coloured, its text is a paragraph", () => {
    const text = "[^1]: The *note*."
    expect(at(text, "1")).toEqual({ color: PALETTE.link })
    expect(at(text, "[^")).toEqual({ dimColor: true })
    expect(at(text, "note")).toMatchObject({ italic: true })
    expect(at(text, "The ")).toEqual({})
  })

  test("a footnote reference is painted when it is defined, or looks like a number", () => {
    expect(at("text[^1] more", "1")).toEqual({ color: PALETTE.link })
    expect(at("text[^note] more\n\n[^note]: x", "note")).toEqual({ color: PALETTE.link })
    expect(at("regex [^abc] class", "[^abc]")).toEqual({})
  })
})

describe("HTML comment blocks", () => {
  test("a multi-line comment is dim italic on every line", () => {
    const text = "<!-- one\n\ntwo\n-->\nafter *it*"
    expect(at(text, "<!-- one")).toEqual({ dimColor: true, italic: true })
    expect(at(text, "two")).toEqual({ dimColor: true, italic: true })
    expect(at(text, "-->")).toEqual({ dimColor: true, italic: true })
    expect(at(text, "after")).toEqual({})
    expect(at(text, "it")).toMatchObject({ italic: true })
  })

  test("an unclosed comment runs to the end of the draft", () => {
    expect(at("<!-- open\nstill in", "still in")).toEqual({ dimColor: true, italic: true })
  })

  test("a comment closed on its own line, and one followed by text", () => {
    expect(at("<!-- c -->\nnext", "<!-- c -->")).toEqual({ dimColor: true, italic: true })
    expect(at("<!-- c --> text", "text")).toEqual({})
    expect(at("<!-- c --> text", "<!-- c -->")).toEqual({ dimColor: true, italic: true })
  })
})

describe("line endings and odd whitespace", () => {
  test("CRLF and lone CR are line breaks: no run holds one, and the marks land on the right text", () => {
    const text = "# H\r\n- a\r\n> q\r\n```\r\ncode\r\n```\rlast *it*"
    expectValidRuns(text)
    expect(at(text, "H")).toMatchObject({ bold: true })
    expect(at(text, "-")).toMatchObject(BULLET)
    expect(at(text, "code")).toMatchObject({ backgroundColor: PALETTE.codeBg })
    expect(at(text, "it")).toMatchObject({ italic: true })
  })

  test("a trailing newline and blank lines are harmless", () => {
    expectValidRuns("\n\n# a\n\n\n- b\n\n")
    expect(at("# a\n", "a")).toMatchObject({ bold: true })
  })

  test("non-breaking and ideographic spaces are text, not indentation", () => {
    expectValidRuns("  - a\n　# b")
  })
})

describe("code mode paints code and nothing else", () => {
  const draft = [
    "# Head `hc`",
    "- [ ] task `tc`",
    "> quote `qc`",
    "> ```ts",
    "> const a = 1",
    "> ```",
    "| h `x` | i |",
    "|---|---|",
    "| `y` | **z** |",
    "",
    "    indented",
    "",
    "1. step",
    "   ```sh",
    "   echo hi",
    "   ```",
    "---",
    "**b** [l](http://u) <b> &amp;",
  ].join("\n")

  test("no heading, bullet, quote, table, rule, emphasis, link, tag or entity style", () => {
    for (const d of decorateMarkdown(draft, { codeOnly: true })) {
      expect(d.bold === true && d.backgroundColor === undefined && d.color !== PALETTE.lang).toBe(false)
      expect(d.italic).toBeUndefined()
      expect(d.underline).toBeUndefined()
      expect(d.dimColor).toBeUndefined()
      // (the heading and link blue is also the fence's language colour, so it cannot be told apart here)
      expect([PALETTE.bullet, PALETTE.taskTodo, PALETTE.taskDone, PALETTE.tag, PALETTE.entity]).not.toContain(d.color)
    }
  })

  test("every kind of code is still painted: inline (in heading, item, quote, cell), fenced in a quote or item, indented", () => {
    const code = (needle: string, from = 0) => at(draft, needle, from, { codeOnly: true })
    for (const inline of ["hc", "tc", "qc", "x", "y"]) {
      expect(code(inline, inline === "x" || inline === "y" ? draft.indexOf("| h") : 0)).toMatchObject({ backgroundColor: PALETTE.inlineBg })
    }
    expect(code("const")).toMatchObject({ backgroundColor: PALETTE.codeBg, color: PALETTE.token.keyword })
    expect(code("echo")).toMatchObject({ backgroundColor: PALETTE.codeBg })
    expect(code("indented")).toMatchObject({ backgroundColor: PALETTE.codeBg })
  })

  test("the code runs are exactly the ones the full mode paints", () => {
    const full = new Set(decorateMarkdown(draft).map((d) => JSON.stringify(d)))
    for (const d of decorateMarkdown(draft, { codeOnly: true })) expect(full.has(JSON.stringify(d))).toBe(true)
  })

  test("text that is only Markdown chrome is not painted at all", () => {
    expect(decorateMarkdown("# H\n- a\n1. b\n> q\n---\n| a |\n|---|\n**b** *i* [l](u)\n- [x] t", { codeOnly: true })).toEqual([])
  })

  test("a definition still feeds nothing: reference links are chrome too", () => {
    expect(decorateMarkdown("[a]: /x\n\n[a]", { codeOnly: true })).toEqual([])
  })
})

/**
 * Random documents of quotes, lists, fences, headings, rules and indented code (tests/fixtures/
 * commonmark-blocks.json), with the line kinds commonmark.js 0.31 gives them. Ours must agree on every
 * line: nesting, lazy lines, partial tabs, the empty-item rule, fences that a container cuts short.
 */
describe("block structure agrees with commonmark.js", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/commonmark-blocks.json", import.meta.url), "utf8")) as {
    cases: [string, string][]
  }

  /** What our paint says each line is, in the same vocabulary as the fixture. */
  function kinds(text: string): string {
    const styles = paint(text)
    let offset = 0
    return text
      .split("\n")
      .map((line) => {
        const at = (i: number) => styles[offset + i]!
        const found: string[] = []
        if (line.trim() !== "") {
          const chars = Array.from({ length: line.length }, (_, i) => i)
          if (!/^[\s>]*$/.test(line) && chars.some((i) => at(i).backgroundColor === PALETTE.codeBg)) found.push("C")
          const h = chars.find((i) => at(i).color === PALETTE.heading && at(i).backgroundColor === undefined && (!at(i).dimColor || at(i).italic))
          if (h !== undefined) {
            const s = at(h)
            found.push(`H${s.underline ? 1 : s.bold && !s.italic ? 2 : s.bold ? 3 : !s.italic && !s.dimColor ? 4 : !s.dimColor ? 5 : 6}`)
          }
          for (const i of chars) if (at(i).color === PALETTE.bullet && (i === 0 || at(i - 1).color !== PALETTE.bullet)) found.push("I")
          for (let i = 0; i < line.length; ) {
            if (!at(i).dimColor) {
              i++
              continue
            }
            let j = i
            while (j < line.length && at(j).dimColor) j++
            const run = line.slice(i, j).trim()
            const before = line.slice(0, i).replace(/[>\s]|(?:[-+*]|\d+[.)])(?=\s)/g, "")
            if (/^([-*_])(\s*\1){2,}$/.test(run) && before === "") found.push("T")
            i = j
          }
        }
        offset += line.length + 1
        return found.sort().join("+") || "-"
      })
      .join("|")
  }

  test("the fixture is what we think it is", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(400)
    const all = fixture.cases.map(([, k]) => k).join("|")
    for (const kind of ["I", "C", "T", "H1", "H6"]) expect(all).toContain(kind)
  })

  test("every document, line by line", () => {
    const wrong: string[] = []
    for (const [text, expected] of fixture.cases) {
      const got = kinds(text)
      if (got !== expected) {
        const lines = text.split("\n")
        const a = expected.split("|")
        const b = got.split("|")
        wrong.push(lines.map((l, i) => `  ${JSON.stringify(l).padEnd(20)} commonmark.js=${a[i]!.padEnd(6)} ours=${b[i]}${a[i] === b[i] ? "" : "  <--"}`).join("\n"))
      }
    }
    expect(wrong.slice(0, 3).join("\n\n")).toBe("")
  })
})
