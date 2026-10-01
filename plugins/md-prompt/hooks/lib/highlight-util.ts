// Small shared helpers of the highlighters (`highlight.ts` and the `highlight-*.ts` scanners):
// character classes, an order-keeping span push and a single-line string scanner that never
// rescans a line it already failed on. Pure, no `$`, no UI, no I/O; nothing here throws.

import type { Span, TokenKind } from "./highlight"

export const set = (words: string): ReadonlySet<string> => new Set(words.split(/\s+/).filter(Boolean))

export const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9"
export const isAlpha = (c: string | undefined): boolean =>
  c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"))
export const isWord = (c: string | undefined): boolean => isAlpha(c) || isDigit(c) || c === "_"
export const isBlank = (c: string | undefined): boolean => c === " " || c === "\t"
/** A blank, a line break or the start of the text: what may sit before a `#` comment. */
export const isBoundary = (c: string | undefined): boolean => c === undefined || c === "\n" || c === "\r" || isBlank(c)

/** Append `[start, end)`; a span that would overlap the previous one is cut, an empty one dropped. */
export function push(spans: Span[], start: number, end: number, kind: TokenKind): void {
  const last = spans[spans.length - 1]
  const from = last && last.end > start ? last.end : start
  if (end > from) spans.push({ start: from, end, kind })
}

/** Index of the `\n` that ends the line holding `from`, or the text length. */
export function lineEnd(code: string, from: number): number {
  const nl = code.indexOf("\n", from)
  return nl === -1 ? code.length : nl
}

/** End of a line's visible text: a trailing `\r` is not painted. */
export function trimCr(code: string, from: number, end: number): number {
  return end > from && code[end - 1] === "\r" ? end - 1 : end
}

/** Index just past the closing quote, or -1 when the string does not close (on the line). */
export function scanString(code: string, open: number, quote: string, multiline: boolean, escapes = true): number {
  for (let i = open + 1; i < code.length; i++) {
    const c = code[i]!
    if (escapes && c === "\\") {
      i++
      continue
    }
    if (c === quote) return i + 1
    if (c === "\n" && !multiline) return -1
  }
  return -1
}

/**
 * `scanString` for one text, with a memo. Once a quote fails to close, every later quote of the
 * same kind up to the end of that line fails too (the escapes line up the same way), so the
 * line is not scanned again: a long line of unmatched quotes stays linear.
 */
export type QuoteScanner = (open: number, quote: string, escapes?: boolean) => number

export function quoteScanner(code: string): QuoteScanner {
  const failed = new Map<string, [from: number, until: number]>()
  return (open, quote, escapes = true) => {
    const key = escapes ? quote : quote + "!"
    const memo = failed.get(key)
    if (memo && open >= memo[0] && open < memo[1]) return -1
    const end = scanString(code, open, quote, false, escapes)
    if (end === -1) failed.set(key, [open, lineEnd(code, open)])
    return end
  }
}
