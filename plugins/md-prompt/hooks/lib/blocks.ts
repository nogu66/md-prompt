// Block structure of the draft: which lines are a quote, a list item, a fence, a heading, a table,
// and where the paragraphs are. Pure and linear: every line is looked at a bounded number of times,
// and the container stack is capped, so no input makes this quadratic.
//
// It is CommonMark's block algorithm trimmed to what painting needs (no tree is built):
//   - containers first: each open `>` quote and list item must match the start of the line, or the
//     line is a lazy paragraph continuation, or the container closes;
//   - then leaf starts, in CommonMark's order: quote, ATX heading, fence, `<!--` comment, setext
//     underline, table delimiter row, thematic break, list item, link/footnote definition, text;
//   - a line indented 4+ columns (relative to its container) is indented code unless it continues
//     a paragraph, so a list item's wrapped lines never turn into code.
// Deliberate deviations for prompts: only `<!--` starts an HTML block (an XML tag on its own line
// is painted as a tag and its content is still Markdown), a table row without a `|` ends the table,
// a `[ ]` / `[x]` opening a line of text is a task box even with no bullet before it (a checklist
// typed as `[ ] todo`), and a setext heading is a single line, not ending like a sentence, over `===` / `---` of three or
// more characters (so a `---` divider under a paragraph stays a divider, and typing `- item` under a
// line never flashes it as a heading).
//
// Block chrome (`#`, `>`, bullets, rules, pipes) is painted while scanning; the text of every
// paragraph / heading / table cell is queued as a "run" and painted last, when every reference
// definition in the draft is known.

import { highlightCode, languageOf, type TokenKind } from "./highlight"
import { normalizeLabel, paintInline, type Emit } from "./inline"
import { PALETTE, type Decoration, type Style } from "./palette"

/** `[start, start + len)` of the draft: one line's worth of a run's text. */
type Seg = { o: number; len: number }
type Run = { segs: Seg[]; base?: Style }
type Para = { segs: Seg[]; quote: boolean }
type Fence = { char: number; len: number; language: string | null; segs: Seg[] }
type Row = { cells: number[]; pipes: number[] }

const MAX_DEPTH = 20
const QUOTE = -1

const DIM: Style = { dimColor: true }
const QUOTE_MARK: Style = { color: PALETTE.fence }
const QUOTE_TEXT: Style = { italic: true }
const BULLET: Style = { color: PALETTE.bullet, bold: true }
const TODO: Style = { color: PALETTE.taskTodo, bold: true }
const DONE: Style = { color: PALETTE.taskDone, bold: true }
const CARD: Style = { backgroundColor: PALETTE.codeBg, color: PALETTE.codeFg }
const FENCE_LINE: Style = { backgroundColor: PALETTE.codeBg, color: PALETTE.fence }
const LANG: Style = { color: PALETTE.lang, bold: true }
const TABLE_HEAD: Style = { bold: true }
const COMMENT: Style = { dimColor: true, italic: true }
const DEF_LABEL: Style = { color: PALETTE.link }
const DEF_TITLE: Style = { dimColor: true, italic: true }

// h1 underlined and bold, h2 bold, h3 bold italic, h4 plain, h5 italic, h6 italic and faint
const HEADINGS: readonly Style[] = [
  { bold: true, underline: true, color: PALETTE.heading },
  { bold: true, color: PALETTE.heading },
  { bold: true, italic: true, color: PALETTE.heading },
  { color: PALETTE.heading },
  { italic: true, color: PALETTE.heading },
  { italic: true, dimColor: true, color: PALETTE.heading },
]

const TOKEN_STYLE = Object.fromEntries(
  Object.entries(PALETTE.token).map(([kind, color]) => [kind, { color }]),
) as Record<TokenKind, Style>

const isSp = (c: number) => c === 32 || c === 9
/** A line ending in one of these reads as a sentence, not as a title. */
const SENTENCE_END = new Set([".", "。", "!", "！", ":", "：", ";", "；", ",", "、"])

/** An emitter for text that was cut out of several lines: virtual offsets in, one run per line out. */
function makeMapper(segs: readonly Seg[], sink: Emit): Emit {
  if (segs.length === 1) {
    const o = segs[0]!.o
    return (a, b, style) => sink(o + a, o + b, style)
  }
  const starts: number[] = []
  let v = 0
  for (const g of segs) {
    starts.push(v)
    v += g.len + 1 // the `\n` the pieces are joined with
  }
  return (a, b, style) => {
    let lo = 0
    let hi = segs.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid]! <= a) lo = mid
      else hi = mid - 1
    }
    for (let k = lo; k < segs.length && starts[k]! < b; k++) {
      const g = segs[k]!
      const from = Math.max(a, starts[k]!)
      const to = Math.min(b, starts[k]! + g.len)
      if (to > from) sink(g.o + (from - starts[k]!), g.o + (to - starts[k]!), style)
    }
  }
}

export function decorateBlocks(text: string, codeOnly: boolean): Decoration[] {
  const n = text.length
  const out: Decoration[] = []
  const runs: Run[] = []
  const links = new Set<string>()
  const footnotes = new Set<string>()

  const put: Emit = (start, end, style) => {
    if (end > start) out.push({ start, end, ...style })
  }
  /** chrome that only the full mode paints; code is `put` in every mode */
  const paint: Emit = codeOnly ? () => {} : put

  // ---- the line being read -------------------------------------------------------------------
  let p = 0 // next unread character
  let col = 0 // its column (tabs stop at multiples of 4)
  let le = 0 // end of the line (before its terminator)
  let nwPos = 0 // first non-blank at or after p
  let nwCol = 0

  const peek = () => {
    let q = p
    let c = col
    while (q < le) {
      const ch = text.charCodeAt(q)
      if (ch === 32) c++
      else if (ch === 9) c += 4 - (c & 3)
      else break
      q++
    }
    nwPos = q
    nwCol = c
  }
  /** Take up to `k` columns of blanks. A tab that is only partly taken stays at `p` with `col` inside it,
   *  so what is left of it still counts as blanks for whoever reads next (CommonMark's partial tabs). */
  const eatCols = (k: number) => {
    let need = k
    while (need > 0 && p < le) {
      const ch = text.charCodeAt(p)
      if (ch === 32) {
        p++
        col++
        need--
      } else if (ch === 9) {
        const w = 4 - (col & 3)
        if (need >= w) {
          p++
          col += w
          need -= w
        } else {
          col += need
          need = 0
        }
      } else break
    }
  }

  // ---- open blocks -----------------------------------------------------------------------------
  const stack: number[] = [] // QUOTE, or a list item's content indent
  /** per container: has a block started inside it yet? (an empty list item does not survive a blank line) */
  const filled: boolean[] = []
  let quotes = 0
  let matched = 0
  let all = true
  let para: Para | null = null
  let fence: Fence | null = null
  let table = false
  let icode = false
  let comment = false
  let boxed = false // a task box was painted on this line

  const recount = () => {
    quotes = 0
    for (const c of stack) if (c === QUOTE) quotes++
  }

  const paintFence = (f: Fence) => {
    const segs = f.segs
    if (segs.length === 0) return
    for (const g of segs) put(g.o, g.o + g.len, CARD)
    const body = segs.map((g) => text.slice(g.o, g.o + g.len)).join("\n")
    const map = makeMapper(segs, put)
    for (const span of highlightCode(body, f.language)) map(span.start, span.end, TOKEN_STYLE[span.kind])
  }
  const flushPara = () => {
    if (para) runs.push({ segs: para.segs, base: para.quote && !codeOnly ? QUOTE_TEXT : undefined })
    para = null
  }
  const flushFence = () => {
    if (fence) paintFence(fence)
    fence = null
  }
  const flushLeaf = () => {
    flushPara()
    flushFence()
    table = false
    icode = false
    comment = false
  }
  /** A new block begins here: whatever leaf is open ends, and containers this line did not match close. */
  const startBlock = () => {
    flushLeaf()
    closeTo(matched)
    if (stack.length > 0) filled[stack.length - 1] = true
    all = true
  }
  const closeTo = (k: number) => {
    if (k < stack.length) {
      stack.length = k
      filled.length = k
      recount()
    }
    matched = stack.length
  }

  // ---- small scanners over the current line ----------------------------------------------------
  const runOf = (pos: number, ch: number) => {
    let q = pos
    while (q < le && text.charCodeAt(q) === ch) q++
    return q - pos
  }
  const trimEnd = (from: number) => {
    let e = le
    while (e > from && isSp(text.charCodeAt(e - 1))) e--
    return e
  }
  /** `---`, `***`, `___` (3+, blanks between allowed); the end of the rule, or -1 */
  const thematicEnd = (pos: number, ch: number) => {
    let count = 0
    for (let q = pos; q < le; q++) {
      const c = text.charCodeAt(q)
      if (c === ch) count++
      else if (!isSp(c)) return -1
    }
    return count >= 3 ? trimEnd(pos) : -1
  }
  /**
   * `===` / `---` under a paragraph: one run of the character, then blanks. CommonMark takes a single
   * `-` too, but then typing `- item` under a line would flash that line as a heading, so 3+.
   */
  const underlineEnd = (pos: number, ch: number) => {
    const k = runOf(pos, ch)
    if (k < 3) return -1
    for (let q = pos + k; q < le; q++) if (!isSp(text.charCodeAt(q))) return -1
    return pos + k
  }

  /**
   * Whether a paragraph may become a setext heading. CommonMark makes any paragraph a heading when a
   * `---` follows it, but in a prompt `---` under a line is nearly always a divider, and painting a
   * whole paragraph as a heading is the worst misfire there is. So only a single line that does not
   * end like a sentence qualifies; anything else keeps its text and the `---` stays a rule.
   */
  const couldBeHeading = (candidate: Para) => {
    if (candidate.segs.length !== 1) return false
    const seg = candidate.segs[0]!
    let e = seg.o + seg.len
    while (e > seg.o && isSp(text.charCodeAt(e - 1))) e--
    return e > seg.o && !SENTENCE_END.has(text[e - 1]!)
  }

  /** Cells of a table row as trimmed [start, end) pairs, and where the unescaped pipes are. */
  const splitRow = (from: number, to: number): Row => {
    let a = from
    let b = to
    while (a < b && isSp(text.charCodeAt(a))) a++
    while (b > a && isSp(text.charCodeAt(b - 1))) b--
    const cells: number[] = []
    const pipes: number[] = []
    const add = (x: number, y: number) => {
      while (x < y && isSp(text.charCodeAt(x))) x++
      while (y > x && isSp(text.charCodeAt(y - 1))) y--
      cells.push(x, y)
    }
    let start = a
    let endsWithPipe = false
    for (let i = a; i < b; i++) {
      const c = text.charCodeAt(i)
      if (c === 92) {
        i++
      } else if (c === 124) {
        pipes.push(i)
        if (i !== a) add(start, i)
        start = i + 1
        endsWithPipe = i === b - 1
      }
    }
    if (!endsWithPipe && a < b) add(start, b)
    return { cells, pipes }
  }
  /** The column count of a `|---|:---:|` row, or 0 when the line is not one. */
  const delimiterColumns = (from: number, to: number) => {
    const row = splitRow(from, to)
    if (row.pipes.length === 0 || row.cells.length === 0) return 0
    for (let k = 0; k < row.cells.length; k += 2) {
      let a = row.cells[k]!
      let b = row.cells[k + 1]!
      if (text.charCodeAt(a) === 58) a++
      if (b > a && text.charCodeAt(b - 1) === 58) b--
      if (b <= a) return 0
      for (let i = a; i < b; i++) if (text.charCodeAt(i) !== 45) return 0
    }
    return row.cells.length / 2
  }
  const paintRow = (row: Row, base: Style | undefined) => {
    for (const pipe of row.pipes) paint(pipe, pipe + 1, DIM)
    for (let k = 0; k < row.cells.length; k += 2) {
      const a = row.cells[k]!
      const b = row.cells[k + 1]!
      if (b > a) runs.push({ segs: [{ o: a, len: b - a }], base: codeOnly ? undefined : base })
    }
  }

  // ---- one line ---------------------------------------------------------------------------------
  const processLine = () => {
    // 1. the open containers claim their part of the line
    boxed = false
    matched = 0
    for (; matched < stack.length; matched++) {
      peek()
      const c = stack[matched]!
      if (c === QUOTE) {
        if (nwCol - col <= 3 && nwPos < le && text.charCodeAt(nwPos) === 62) {
          paint(nwPos, nwPos + 1, QUOTE_MARK)
          p = nwPos + 1
          col = nwCol + 1
          eatCols(1) // the one blank that may follow `>` (part of a tab, if that is what it is)
        } else break
      } else if (nwPos >= le) {
        // a blank line keeps a list item open and takes nothing from it, unless the item is
        // still empty: an item may begin with one blank line, not two
        if (!filled[matched]) break
      } else if (nwCol - col >= c) eatCols(c)
      else break
    }
    all = matched === stack.length

    // 2. a leaf that swallows lines whole
    if (fence) {
      if (all) {
        peek()
        const k = nwCol - col <= 3 ? runOf(nwPos, fence.char) : 0
        if (k >= fence.len && trimEnd(nwPos + k) <= nwPos + k) {
          flushFence()
          put(p, le, FENCE_LINE)
          return
        }
        fence.segs.push({ o: p, len: le - p })
        return
      }
      flushFence()
    } else if (comment) {
      if (all) {
        const close = text.slice(p, le).indexOf("-->")
        paint(p, close === -1 ? le : p + close + 3, COMMENT)
        if (close !== -1) comment = false
        return
      }
      comment = false
    } else if (icode) {
      if (all) {
        peek()
        if (nwPos >= le) return
        if (nwCol - col >= 4) {
          put(p, le, CARD)
          return
        }
      }
      icode = false
    }
    if (table && !all) table = false

    // 3. the rest of the line: blank, or a new block, or text
    for (;;) {
      peek()
      if (nwPos >= le) {
        if (all) {
          flushPara()
          table = false
        } else {
          flushLeaf()
          closeTo(matched)
          all = true
        }
        return
      }
      const ind = nwCol - col
      const ch = text.charCodeAt(nwPos)

      if (ind >= 4) {
        if (table && tryTableRow()) return
        if (para) {
          para.segs.push({ o: nwPos, len: le - nwPos })
          return
        }
        startBlock()
        icode = true
        put(p, le, CARD)
        return
      }

      // block quote
      if (ch === 62 && stack.length < MAX_DEPTH) {
        startBlock()
        paint(nwPos, nwPos + 1, QUOTE_MARK)
        stack.push(QUOTE)
        filled.push(false)
        quotes++
        matched = stack.length
        p = nwPos + 1
        col = nwCol + 1
        eatCols(1)
        continue
      }

      // ATX heading
      if (ch === 35) {
        const k = runOf(nwPos, 35)
        if (k <= 6 && (nwPos + k >= le || isSp(text.charCodeAt(nwPos + k)))) {
          startBlock()
          paint(nwPos, nwPos + k, DIM)
          let cs = nwPos + k
          while (cs < le && isSp(text.charCodeAt(cs))) cs++
          let ce = trimEnd(cs)
          let q = ce
          while (q > cs && text.charCodeAt(q - 1) === 35) q--
          if (q < ce && (q === cs || isSp(text.charCodeAt(q - 1)))) {
            paint(q, ce, DIM) // the closing `##`
            ce = q
            while (ce > cs && isSp(text.charCodeAt(ce - 1))) ce--
          }
          if (ce > cs) runs.push({ segs: [{ o: cs, len: ce - cs }], base: codeOnly ? undefined : HEADINGS[k - 1] })
          return
        }
      }

      // fenced code
      if (ch === 96 || ch === 126) {
        const k = runOf(nwPos, ch)
        const info = k >= 3 ? text.slice(nwPos + k, le) : ""
        // a backtick fence's info string cannot hold a backtick: ```code``` on one line is inline code
        if (k >= 3 && !(ch === 96 && info.includes("`"))) {
          startBlock()
          put(p, le, FENCE_LINE)
          const language = languageOf(info)
          if (language) {
            // the language word as typed (`TS`, `.py`): first non-space char, past an optional dot
            const lead = info.search(/\S/)
            const at = nwPos + k + lead + (info[lead] === "." ? 1 : 0)
            put(at, at + language.length, LANG)
          }
          fence = { char: ch, len: k, language, segs: [] }
          return
        }
      }

      // HTML comment block
      if (ch === 60 && text.startsWith("<!--", nwPos)) {
        const rest = text.slice(nwPos, le)
        const close = rest.indexOf("-->", 4)
        if (close === -1 || rest.slice(close + 3).trim() === "") {
          startBlock()
          paint(nwPos, le, COMMENT)
          comment = close === -1
          return
        }
      }

      // setext underline
      if (para && all && (ch === 61 || ch === 45) && couldBeHeading(para)) {
        const end = underlineEnd(nwPos, ch)
        if (end !== -1) {
          runs.push({ segs: para.segs, base: codeOnly ? undefined : HEADINGS[ch === 61 ? 0 : 1] })
          para = null
          paint(nwPos, end, DIM)
          return
        }
      }

      // table: this is the delimiter row under a header line
      if (para && all && (ch === 124 || ch === 45 || ch === 58)) {
        const cols = delimiterColumns(nwPos, le)
        if (cols > 0) {
          const last = para.segs[para.segs.length - 1]!
          const header = splitRow(last.o, last.o + last.len)
          if (header.pipes.length > 0 && header.cells.length / 2 === cols) {
            para.segs.pop()
            if (para.segs.length > 0) flushPara()
            para = null
            table = true
            paintRow(header, TABLE_HEAD)
            paint(nwPos, trimEnd(nwPos), DIM)
            return
          }
        }
      }

      // thematic break
      if (ch === 42 || ch === 45 || ch === 95) {
        const end = thematicEnd(nwPos, ch)
        if (end !== -1) {
          startBlock()
          paint(nwPos, end, DIM)
          return
        }
      }

      // list item
      if (stack.length < MAX_DEPTH && listItem(ind, ch)) continue

      // link reference / footnote definition (only where a paragraph could start)
      if (ch === 91 && !para && definition()) return

      // table row
      if (table && tryTableRow()) return

      // a task box with no bullet before it: the box is painted, what follows is read as usual
      if (ch === 91 && !boxed) {
        p = nwPos
        col = nwCol
        if (taskBox()) continue
      }

      // paragraph text
      if (para) {
        para.segs.push({ o: nwPos, len: le - nwPos })
        return
      }
      startBlock()
      para = { segs: [{ o: nwPos, len: le - nwPos }], quote: quotes > 0 }
      return
    }
  }

  const tryTableRow = (): boolean => {
    const row = splitRow(nwPos, le)
    if (row.pipes.length === 0) return false
    paintRow(row, undefined)
    return true
  }

  /** Open a list item if the line has a marker at `nwPos`; true when it did (the rest is still to read). */
  const listItem = (ind: number, ch: number): boolean => {
    let width = 0
    let start = 1
    if (ch === 42 || ch === 43 || ch === 45) {
      if (nwPos + 1 === le || isSp(text.charCodeAt(nwPos + 1))) width = 1
    } else if (ch >= 48 && ch <= 57) {
      let q = nwPos
      while (q < le && text.charCodeAt(q) >= 48 && text.charCodeAt(q) <= 57) q++
      const digits = q - nwPos
      const d = text.charCodeAt(q)
      if (digits <= 9 && (d === 46 || d === 41) && (q + 1 === le || isSp(text.charCodeAt(q + 1)))) {
        width = digits + 1
        start = Number.parseInt(text.slice(nwPos, q), 10)
      }
    }
    if (width === 0) return false

    let q = nwPos + width
    let c = nwCol + width
    while (q < le && isSp(text.charCodeAt(q))) {
      c += text.charCodeAt(q) === 9 ? 4 - (c & 3) : 1
      q++
    }
    const empty = q >= le
    // an item can interrupt a paragraph only when it has content, and an ordered one only from 1
    if (para && all && (empty || (width > 1 && start !== 1))) return false

    const spaces = c - (nwCol + width)
    const takes = empty || spaces >= 5 ? 1 : spaces
    startBlock()
    paint(nwPos, nwPos + width, BULLET)
    stack.push(ind + width + takes)
    filled.push(false)
    matched = stack.length
    p = nwPos + width
    col = nwCol + width
    eatCols(takes)

    // GFM task list: `[ ]` / `[x]` opening the item's text
    if (!empty) taskBox()
    return true
  }

  /** `[ ]` / `[x]` at `p`, then a blank or the end of the line: paint the box and step past it and its blanks. */
  const taskBox = (): boolean => {
    if (text.charCodeAt(p) !== 91 || text.charCodeAt(p + 2) !== 93 || (p + 3 !== le && !isSp(text.charCodeAt(p + 3)))) return false
    const mark = text.charCodeAt(p + 1)
    if (mark !== 32 && mark !== 120 && mark !== 88) return false
    paint(p, p + 3, mark === 32 ? TODO : DONE)
    p += 3
    col += 3
    peek()
    p = nwPos
    col = nwCol
    boxed = true
    return true
  }

  /** `[label]: url "title"` and `[^note]: text` at `nwPos`; true when the line was one. */
  const definition = (): boolean => {
    if (text.charCodeAt(nwPos + 1) === 94) {
      let q = nwPos + 2
      while (q < le) {
        const c = text.charCodeAt(q)
        if (c === 93 || c === 91 || c <= 32) break
        q++
      }
      if (q === nwPos + 2 || text.charCodeAt(q) !== 93 || text.charCodeAt(q + 1) !== 58) return false
      if (q + 2 < le && !isSp(text.charCodeAt(q + 2))) return false
      startBlock()
      footnotes.add(normalizeLabel(text.slice(nwPos + 2, q)))
      paint(nwPos, nwPos + 2, DIM)
      paint(nwPos + 2, q, DEF_LABEL)
      paint(q, q + 2, DIM)
      let cs = q + 2
      while (cs < le && isSp(text.charCodeAt(cs))) cs++
      if (cs < le) para = { segs: [{ o: cs, len: le - cs }], quote: quotes > 0 }
      return true
    }

    let q = nwPos + 1
    const limit = Math.min(le, nwPos + 1000)
    while (q < limit && text.charCodeAt(q) !== 93) {
      const c = text.charCodeAt(q)
      if (c === 91) return false
      q += c === 92 ? 2 : 1
    }
    if (text.charCodeAt(q) !== 93 || text.charCodeAt(q + 1) !== 58) return false
    const label = text.slice(nwPos + 1, q)
    if (label.trim() === "") return false
    let r = q + 2
    while (r < le && isSp(text.charCodeAt(r))) r++
    const destStart = r
    if (text.charCodeAt(r) === 60) {
      while (r < le && text.charCodeAt(r) !== 62) r++
      if (r >= le) return false
      r++
    } else {
      while (r < le && !isSp(text.charCodeAt(r))) r++
    }
    if (r === destStart) return false
    const destEnd = r
    while (r < le && isSp(text.charCodeAt(r))) r++
    let titleStart = -1
    let titleEnd = -1
    if (r < le) {
      const open = text.charCodeAt(r)
      const last = trimEnd(r) - 1
      const closeCh = open === 40 ? 41 : open
      if (r === destEnd || (open !== 34 && open !== 39 && open !== 40) || last <= r || text.charCodeAt(last) !== closeCh) return false
      titleStart = r
      titleEnd = last + 1
    }
    startBlock()
    links.add(normalizeLabel(label))
    paint(nwPos, nwPos + 1, DIM)
    paint(nwPos + 1, q, DEF_LABEL)
    paint(q, q + 2, DIM)
    paint(destStart, destEnd, DIM)
    if (titleStart !== -1) paint(titleStart, titleEnd, DEF_TITLE)
    return true
  }

  // ---- read the draft line by line ---------------------------------------------------------------
  for (let pos = 0; ; ) {
    let e = pos
    while (e < n) {
      const c = text.charCodeAt(e)
      if (c === 10 || c === 13) break
      e++
    }
    p = pos
    col = 0
    le = e
    processLine()
    if (e >= n) break
    pos = e + (text.charCodeAt(e) === 13 && text.charCodeAt(e + 1) === 10 ? 2 : 1)
  }
  flushLeaf()

  // ---- the text of every paragraph, heading and cell, now that the definitions are known ---------
  const refs = { links, footnotes }
  for (const run of runs) {
    const segs = run.segs
    if (run.base && !codeOnly) for (const g of segs) put(g.o, g.o + g.len, run.base)
    const s =
      segs.length === 1 ? text.slice(segs[0]!.o, segs[0]!.o + segs[0]!.len) : segs.map((g) => text.slice(g.o, g.o + g.len)).join("\n")
    paintInline(s, refs, codeOnly, makeMapper(segs, put))
  }
  return out
}
