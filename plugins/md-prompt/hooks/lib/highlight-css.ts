// CSS, SCSS and Less. The text is cut into statements (up to the next `;`, `{` or `}`, skipping
// strings, comments and parentheses) and each statement is classified once: an at-rule, a
// selector (it ends in `{`) or a declaration (`property: value`). Every character is looked at a
// constant number of times, so any input scans in linear time.

import type { Span, TokenKind } from "./highlight"
import { isAlpha, isBlank, isDigit, isWord, lineEnd, push, quoteScanner, set, trimCr } from "./highlight-util"

export type CssDialect = "css" | "scss" | "less"

const NUM = /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?(?:%|[A-Za-z]+)?/y
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/y
const BANG = /![ \t]*(?:important|default|global|optional)(?![\w-])/iy
// In Less an `@name` that is not one of these is a variable.
const LESS_AT = set(
  `import media charset font-face keyframes -webkit-keyframes -moz-keyframes supports namespace page
   plugin viewport document counter-style font-feature-values layer container property`,
)
// Words that read as keywords inside an at-rule's prelude (`@media a and b`, `@each $i in $l`).
const PRELUDE = set("and or not only in from through to if else")
const LITERALS = set("true false null")

const isIdent = (c: string): boolean => isWord(c) || c === "-" || c > "\x7f"
const isIdentStart = (c: string | undefined): boolean =>
  c !== undefined && (isAlpha(c) || c === "_" || c === "-" || c > "\x7f")

export function highlightCss(code: string, dialect: CssDialect): Span[] {
  const spans: Span[] = []
  const n = code.length
  const lineComments = dialect !== "css"
  const less = dialect === "less"
  const quote = quoteScanner(code)
  let kind: TokenKind = "comment"

  /** End of the comment or string starting at `i` (its kind lands in `kind`), or `i` when none does. */
  const opaque = (i: number): number => {
    const c = code[i]!
    if (c === "/") {
      const d = code[i + 1]
      if (d === "*") {
        kind = "comment"
        const close = code.indexOf("*/", i + 2)
        return close === -1 ? n : close + 2 // an unclosed comment runs to the end
      }
      if (d === "/" && lineComments && code[i - 1] !== ":") {
        kind = "comment"
        return trimCr(code, i, lineEnd(code, i))
      }
    } else if (c === '"' || c === "'") {
      const end = quote(i, c)
      if (end !== -1) {
        kind = "string"
        return end
      }
    }
    return i
  }

  const ident = (i: number): number => {
    let j = i
    while (j < n && isIdent(code[j]!)) j++
    return j
  }

  // Index of the `;`, `{` or `}` that ends the statement starting at `from`, or the text length.
  const statementEnd = (from: number): number => {
    let depth = 0
    let i = from
    while (i < n) {
      const j = opaque(i)
      if (j > i) {
        i = j
        continue
      }
      const c = code[i]!
      if (c === "{" || c === "}") {
        const before = code[i - 1]
        if (c === "{" && i > from && (before === "#" || (less && before === "@"))) {
          const close = code.indexOf("}", i + 1) // `#{$a}` / `@{a}` interpolation
          if (close === -1) return n
          i = close + 1
          continue
        }
        return i
      }
      if (c === ";" && depth === 0) return i
      if (c === "(") depth++
      else if (c === ")" && depth > 0) depth--
      i++
    }
    return n
  }

  // A value, or an at-rule's prelude: strings, numbers with units, colours, variables.
  const value = (start: number, end: number, prelude = false): void => {
    let i = start
    while (i < end) {
      const j = opaque(i)
      if (j > i) {
        push(spans, i, Math.min(j, end), kind)
        i = j
        continue
      }
      const c = code[i]!
      if (c === "#") {
        HEX.lastIndex = i
        const m = HEX.exec(code)
        if (m && i + m[0].length <= end) {
          push(spans, i, i + m[0].length, "number")
          i += m[0].length
        } else i++
        continue
      }
      if (c === "$" || (less && c === "@")) {
        const e = ident(i + 1)
        if (e > i + 1) push(spans, i, e, "literal")
        i = Math.max(e, i + 1)
        continue
      }
      if (c === "!") {
        BANG.lastIndex = i
        const m = BANG.exec(code)
        if (m) {
          push(spans, i, i + m[0].length, "keyword")
          i += m[0].length
        } else i++
        continue
      }
      if (c === "-" && code[i + 1] === "-" && !isWord(code[i - 1])) {
        const e = ident(i + 2)
        if (e > i + 2) push(spans, i, e, "literal") // var(--name)
        i = Math.max(e, i + 2)
        continue
      }
      const next = code[i + 1]
      const signed =
        (c === "-" || c === "+") &&
        (isDigit(next) || (next === "." && isDigit(code[i + 2]))) &&
        !isWord(code[i - 1]) &&
        code[i - 1] !== "."
      if (isDigit(c) || (c === "." && isDigit(next)) || signed) {
        const s = signed ? i + 1 : i
        NUM.lastIndex = s
        const m = NUM.exec(code)
        if (m) {
          const e = Math.min(s + m[0].length, end)
          push(spans, i, e, "number")
          i = e
        } else i++
        continue
      }
      if (isIdentStart(c)) {
        const e = ident(i)
        const word = code.slice(i, e)
        if (e < end && code[e] === "(" && word.toLowerCase() === "url") {
          // url(unquoted) is one string; a quoted url is left to the string rule
          let k = e + 1
          while (k < end && isBlank(code[k])) k++
          if (code[k] !== '"' && code[k] !== "'") {
            let m = k
            while (m < end && code[m] !== ")" && code[m] !== "\n" && !isBlank(code[m])) m++
            push(spans, k, m, "string")
            i = m
            continue
          }
        } else if (prelude && PRELUDE.has(word)) push(spans, i, e, "keyword")
        else if (LITERALS.has(word)) push(spans, i, e, "literal")
        i = Math.max(e, i + 1)
        continue
      }
      i++
    }
  }

  // `.class` / `#id` / `%placeholder` (type), `:pseudo` (literal), element names (keyword).
  const selector = (start: number, end: number): void => {
    let i = start
    let paren = 0
    let attr = false
    while (i < end) {
      const j = opaque(i)
      if (j > i) {
        push(spans, i, Math.min(j, end), kind)
        i = j
        continue
      }
      const c = code[i]!
      if (attr) {
        if (c === "]") attr = false
        i++
      } else if (c === "[") {
        attr = true
        i++
      } else if (c === "(") {
        paren++
        i++
      } else if (c === ")") {
        if (paren > 0) paren--
        i++
      } else if ((c === "." || c === "#" || c === "%") && isIdentStart(code[i + 1])) {
        const e = ident(i + 1)
        push(spans, i, e, "type")
        i = e
      } else if (c === ":") {
        const k = code[i + 1] === ":" ? i + 2 : i + 1
        if (isIdentStart(code[k])) {
          const e = ident(k)
          push(spans, i, e, "literal")
          i = e
        } else i++
      } else if (c === "&") {
        i = ident(i + 1) // `&-suffix` is one piece of the selector
      } else if (c === "$" || (less && c === "@")) {
        const e = ident(i + 1)
        if (e > i + 1) push(spans, i, e, "literal")
        i = Math.max(e, i + 1)
      } else if (isDigit(c)) {
        NUM.lastIndex = i
        const m = NUM.exec(code)
        const e = m ? Math.min(i + m[0].length, end) : i + 1
        push(spans, i, e, "number") // keyframe `50%`, `:nth-child(2n+1)`
        i = e
      } else if (isIdentStart(c)) {
        const e = ident(i)
        if (paren === 0) push(spans, i, e, "keyword")
        i = e
      } else i++
    }
  }

  const statement = (start: number, end: number, block: boolean): void => {
    if (code[start] === "@" && code[start + 1] !== "{") {
      const e = ident(start + 1)
      if (e > start + 1) {
        let m = e
        while (m < end && isBlank(code[m])) m++
        const name = code.slice(start + 1, e).toLowerCase()
        if (less && (code[m] === ":" || !LESS_AT.has(name))) {
          push(spans, start, e, "literal") // `@var: 1px`, `@arguments`
          value(code[m] === ":" ? m + 1 : e, end)
        } else {
          push(spans, start, e, "keyword")
          value(e, end, true)
        }
        return
      }
    }
    if (block) {
      selector(start, end)
      return
    }
    let j = start
    while (j < end && (isWord(code[j]) || code[j] === "-" || code[j] === "$" || code[j] === "@" || code[j] === "*")) j++
    if (j > start) {
      let k = j
      while (k < end && isBlank(code[k])) k++
      if (k < end && code[k] === ":" && code[k + 1] !== ":") {
        const first = code[start]
        const variable = first === "$" || first === "@" || (first === "-" && code[start + 1] === "-")
        push(spans, start, j, variable ? "literal" : "type")
        value(k + 1, end)
        return
      }
    }
    value(start, end)
  }

  let i = 0
  while (i < n) {
    const c = code[i]!
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === ";" || c === "{" || c === "}") {
      i++
      continue
    }
    const j = opaque(i)
    if (j > i) {
      push(spans, i, j, kind)
      i = j
      continue
    }
    const end = statementEnd(i)
    statement(i, end, code[end] === "{")
    i = end > i ? end : i + 1
  }
  return spans
}
