// Scanners for the markup languages: HTML / XML and Markdown. Same contract as `highlight.ts`
// (source text in, ordered non-overlapping spans out, one linear pass, never throws), but these
// two are not "keywords, strings and numbers" languages, so they get their own small scanners.

import type { Span } from "./highlight"
import { isAlpha, isBlank, isDigit, isWord, lineEnd, push, trimCr } from "./highlight-util"

const ENTITY = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/y
// Text inside <script> / <style> is not markup: skip to the closing tag so `a<b` is not a tag.
const RAW_END: Record<string, RegExp> = { script: /<\/script/gi, style: /<\/style/gi }

const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f"
const isNameChar = (c: string): boolean => isWord(c) || c === "-" || c === ":" || c === "." || c > "\x7f"
const isAttrEnd = (c: string): boolean =>
  isSpace(c) || c === '"' || c === "'" || c === ">" || c === "/" || c === "=" || c === "<"

/**
 * HTML / XML: tag names (keyword), attribute names (type), attribute values (string), comments,
 * `<!DOCTYPE>` / `<?xml?>` (meta), CDATA (string) and entities (literal). `<` opens a tag only
 * when a letter, `/`, `!` or `?` follows and a `>` comes later; text between tags is left alone.
 */
export function highlightMarkup(code: string): Span[] {
  const spans: Span[] = []
  const n = code.length
  const lastGt = code.lastIndexOf(">")
  let raw = null as string | null // set by `tag` for an opening <script> / <style>
  let i = 0

  const quoted = (open: number): number => {
    const close = code.indexOf(code[open]!, open + 1)
    const end = close === -1 ? n : close + 1
    push(spans, open, end, "string")
    return end
  }

  // One tag from its `<`. Returns where to resume: past the `>`, or at a `<` that broke the tag.
  const tag = (start: number): number => {
    raw = null
    let j = start + 1
    const closing = code[j] === "/"
    if (closing) j++
    const nameStart = j
    while (j < n && isNameChar(code[j]!)) j++
    push(spans, nameStart, j, "keyword")
    const name = code.slice(nameStart, j).toLowerCase()
    let selfClosed = false
    let ended = false
    while (j < n) {
      const c = code[j]!
      if (c === ">") {
        j++
        ended = true
        break
      }
      if (c === "<") break
      if (c === "/") {
        if (code[j + 1] === ">") {
          selfClosed = true
          ended = true
          j += 2
          break
        }
        j++
        continue
      }
      if (isSpace(c) || c === "=") {
        j++
        continue
      }
      if (c === '"' || c === "'") {
        j = quoted(j)
        continue
      }
      const attr = j
      while (j < n && !isAttrEnd(code[j]!)) j++
      push(spans, attr, j, "type")
      let k = j
      while (k < n && isSpace(code[k]!)) k++
      if (code[k] === "=") {
        k++
        while (k < n && isSpace(code[k]!)) k++
        const q = code[k]
        if (q === '"' || q === "'") j = quoted(k)
        else {
          const value = k
          while (k < n && !isSpace(code[k]!) && code[k] !== ">") k++
          push(spans, value, k, "string")
          j = k
        }
      }
    }
    if (ended && !closing && !selfClosed && (name === "script" || name === "style")) raw = name
    return j
  }

  while (i < n) {
    const c = code[i]!
    if (c === "<") {
      const next = code[i + 1]
      if (next === "!" && code.startsWith("<!--", i)) {
        const close = code.indexOf("-->", i + 4)
        const end = close === -1 ? n : close + 3 // an unclosed comment runs to the end
        push(spans, i, end, "comment")
        i = end
        continue
      }
      if ((next === "!" || next === "?") && i < lastGt) {
        if (code.startsWith("<![CDATA[", i)) {
          const close = code.indexOf("]]>", i + 9)
          const end = close === -1 ? n : close + 3
          push(spans, i, end, "string")
          i = end
          continue
        }
        const close = code.indexOf(next === "?" ? "?>" : ">", i + 2)
        const end = close === -1 ? n : close + (next === "?" ? 2 : 1)
        push(spans, i, end, "meta")
        i = end
        continue
      }
      if ((next === "/" || isAlpha(next)) && i < lastGt) {
        i = tag(i)
        if (raw !== null) {
          const re = RAW_END[raw]!
          re.lastIndex = i
          const m = re.exec(code)
          i = m ? m.index : n
        }
        continue
      }
      i++
      continue
    }
    if (c === "&") {
      ENTITY.lastIndex = i
      const m = ENTITY.exec(code)
      if (m) {
        push(spans, i, i + m[0].length, "literal")
        i += m[0].length
        continue
      }
    }
    i++
  }
  return spans
}

/**
 * Markdown, kept modest: headings (keyword); fence lines, list markers, `>` quotes, rules and
 * the `](` of links' urls (string) as markers; inline code (string); `<!-- -->` comments, which
 * may run over lines. The inside of a fenced block is left plain, so a `# comment` in it is not
 * a heading. Emphasis, tables and raw HTML are not touched.
 */
export function highlightMarkdown(code: string): Span[] {
  const spans: Span[] = []
  const n = code.length
  let fence = null as { ch: string; len: number } | null

  const indent = (from: number, end: number): number => {
    let p = from
    while (p < end && p - from < 3 && code[p] === " ") p++
    return p
  }

  // Backtick runs pair with the next run of exactly the same length: [start, end, start, end, ...].
  const codeRanges = (from: number, end: number): number[] => {
    const starts: number[] = []
    const lens: number[] = []
    for (let j = from; j < end; ) {
      if (code[j] !== "`") {
        j++
        continue
      }
      let k = j + 1
      while (k < end && code[k] === "`") k++
      starts.push(j)
      lens.push(k - j)
      j = k
    }
    const nextSame: number[] = new Array<number>(starts.length).fill(-1)
    const last = new Map<number, number>()
    for (let r = starts.length - 1; r >= 0; r--) {
      nextSame[r] = last.get(lens[r]!) ?? -1
      last.set(lens[r]!, r)
    }
    const out: number[] = []
    for (let r = 0; r < starts.length; ) {
      const m = nextSame[r]!
      if (m === -1) r++
      else {
        out.push(starts[r]!, starts[m]! + lens[m]!)
        r = m + 1
      }
    }
    return out
  }

  // Block-level markers of the line `[i, end)`. Returns where inline text starts, or -1 when the
  // whole line is done (heading, rule, fence).
  const block = (i: number, end: number): number => {
    let p = indent(i, end)
    const fc = code[p]
    if (fc === "`" || fc === "~") {
      let k = p
      while (k < end && code[k] === fc) k++
      let ticks = false
      if (fc === "`") for (let m = k; m < end && !ticks; m++) ticks = code[m] === "`"
      if (k - p >= 3 && !ticks) {
        push(spans, p, end, "meta")
        fence = { ch: fc, len: k - p }
        return -1
      }
    }
    let q = i
    for (;;) {
      const r = indent(q, end)
      if (code[r] !== ">") break
      push(spans, r, r + 1, "meta")
      q = r + 1
      if (code[q] === " ") q++
    }
    p = indent(q, end)
    const c = code[p]
    if (c === "#") {
      let k = p
      while (k < end && code[k] === "#") k++
      if (k - p <= 6 && (k === end || isBlank(code[k]))) {
        push(spans, p, end, "keyword")
        return -1
      }
    }
    if (c === "-" || c === "*" || c === "_") {
      let count = 0
      let k = p
      while (k < end && (code[k] === c || isBlank(code[k]))) {
        if (code[k] === c) count++
        k++
      }
      if (k === end && count >= 3) {
        push(spans, p, end, "meta")
        return -1
      }
    }
    let l = q
    while (l < end && isBlank(code[l])) l++
    const lc = code[l]
    if (lc === "-" || lc === "*" || lc === "+") {
      if (l + 1 === end || isBlank(code[l + 1])) {
        push(spans, l, l + 1, "meta")
        return l + 1
      }
    } else if (isDigit(lc)) {
      let k = l
      while (k < end && k - l < 9 && isDigit(code[k])) k++
      if ((code[k] === "." || code[k] === ")") && (k + 1 === end || isBlank(code[k + 1]))) {
        push(spans, l, k + 1, "meta")
        return k + 1
      }
    }
    return q
  }

  // Inline text of `[from, end)`. Returns `end`, or further when a comment ran over lines.
  const inline = (from: number, end: number): number => {
    const ranges = codeRanges(from, end)
    let rp = 0
    let bracket = false
    let j = from
    while (j < end) {
      while (rp < ranges.length && ranges[rp]! < j) rp += 2
      if (rp < ranges.length && ranges[rp] === j) {
        push(spans, j, ranges[rp + 1]!, "string")
        j = ranges[rp + 1]!
        rp += 2
        continue
      }
      const c = code[j]!
      if (c === "\\") {
        j += 2
        continue
      }
      if (c === "<" && code.startsWith("<!--", j)) {
        const close = code.indexOf("-->", j + 4)
        const stop = close === -1 ? n : close + 3
        push(spans, j, stop, "comment")
        if (stop > end) return stop
        j = stop
        continue
      }
      if (c === "[") bracket = true
      else if (c === "]" && bracket && code[j + 1] === "(") {
        let k = j + 2
        while (k < end && code[k] !== ")" && !isBlank(code[k])) k++
        push(spans, j + 2, k, "string")
        j = k
        continue
      }
      j++
    }
    return end
  }

  let i = 0
  let mid = false // `i` is inside a line: an HTML comment just ended there
  while (i < n) {
    const nl = lineEnd(code, i)
    const end = trimCr(code, i, nl)
    let from = i
    if (!mid) {
      if (fence !== null) {
        const p = indent(i, end)
        let k = p
        while (k < end && code[k] === fence.ch) k++
        let m = k
        while (m < end && isBlank(code[m])) m++
        if (k - p >= fence.len && m === end) {
          push(spans, p, end, "meta")
          fence = null
        }
        i = nl + 1
        continue
      }
      from = block(i, end)
      if (from === -1) {
        i = nl + 1
        continue
      }
    }
    const stop = inline(from, end)
    if (stop > nl) {
      i = stop
      mid = true
    } else {
      i = nl + 1
      mid = false
    }
  }
  return spans
}
