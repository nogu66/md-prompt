// Inline Markdown: the text of one run (a paragraph, a heading, a table cell) in, style runs out.
// Pure and linear. No `$`, no UI, no regular expression that backtracks over the whole run.
//
// It follows CommonMark's inline rules closely enough that the colours agree with what a renderer
// would draw, with a few deliberate deviations for prompts (see the notes below):
//   - code spans, escapes, autolinks and inline HTML bind tighter than emphasis and links;
//   - emphasis is the delimiter-stack algorithm with the left/right-flanking rules, run once at
//     the end and once inside every link text (`openersBottom` keeps it linear);
//   - links are the bracket-stack algorithm: `[t](u "title")`, `[t][ref]`, `[t][]`, `[t]` (a
//     reference only counts when the draft defines it: `matrix[i][j]` stays plain), images, and
//     footnote references `[^1]`;
//   - GFM: `~~strike~~`, and bare `https://…` / `www.…` URLs.
// Deviations: a CJK letter next to punctuation still opens/closes `*` emphasis (`日本語**「太字」**です`);
// a `*` / `~~` between two ASCII word characters or right after `/` cannot open (`2*3*4`, `x**2`,
// `src/*.ts`); Python's `__init__` / `__name__` are not bold; tag names may hold `_` and `:` (`<user_input>`); an unknown tag glued to a word
// (`Array<string>`) is not a tag.
//
// Everything is reported through `emit(start, end, style)` in offsets of the text it was given;
// a run may cover a `\n` there (a multi-line paragraph), the caller cuts it at the line breaks.
// Every scanner that can walk far ahead draws on one budget, so no input turns this quadratic.

import { PALETTE, type Style } from "./palette"

export type Refs = { links: ReadonlySet<string>; footnotes: ReadonlySet<string> }
export type Emit = (start: number, end: number, style: Style) => void

/** The key a link label is looked up under: trimmed, whitespace collapsed, case-folded. */
export function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase()
}

const DIM: Style = { dimColor: true }
const LINK_TEXT: Style = { underline: true, color: PALETTE.link }
const IMAGE_ALT: Style = { italic: true, color: PALETTE.link }
const FOOTNOTE: Style = { color: PALETTE.link }
const TAG: Style = { color: PALETTE.tag }
const COMMENT: Style = { dimColor: true, italic: true }
const ENTITY: Style = { color: PALETTE.entity }
const STRONG: Style = { bold: true }
const EM: Style = { italic: true }
const STRIKE: Style = { strikethrough: true }
const CODE_CHIP: Style = { backgroundColor: PALETTE.inlineBg, color: PALETTE.inlineFg }
const CODE_TICKS: Style = { color: PALETTE.fence }

const BACKSLASH = 92
const BACKTICK = 96
const STAR = 42
const UNDERSCORE = 95
const TILDE = 126
const LBRACKET = 91
const RBRACKET = 93
const BANG = 33
const LT = 60
const GT = 62
const AMP = 38
const LPAREN = 40
const RPAREN = 41
const QUOTE = 34
const APOS = 39
const SEMI = 59

// ---- character classes --------------------------------------------------------------------------

function isWs(cp: number): boolean {
  return (
    cp === 32 || (cp >= 9 && cp <= 13) || cp === 0xa0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) ||
    cp === 0x2028 || cp === 0x2029 || cp === 0x202f || cp === 0x205f || cp === 0x3000
  )
}

const PUNCT_RE = /[\p{P}\p{S}]/u
function isPunct(cp: number): boolean {
  if (cp < 128) return (cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)
  return PUNCT_RE.test(String.fromCodePoint(cp))
}

/** Han, kana, hangul: scripts that do not put spaces between words. */
function isCjk(cp: number): boolean {
  return (
    (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xff66 && cp <= 0xff9f) ||
    (cp >= 0x20000 && cp <= 0x2fa1f)
  )
}

const isAsciiPunct = (c: number) => (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)
const isAlpha = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
const isAlnum = (c: number) => isAlpha(c) || (c >= 48 && c <= 57)
const isWord = (c: number) => isAlnum(c) || c === 95
const isSpaceCode = (c: number) => c === 32 || c === 9 || c === 10
const isTagNameChar = (c: number) => isAlnum(c) || c === 45 || c === 95 || c === 58
const isAttrStart = (c: number) => isAlpha(c) || c === 95 || c === 58
const isAttrChar = (c: number) => isAlnum(c) || c === 95 || c === 46 || c === 58 || c === 45

// A tag name in this set is a tag wherever it stands (`line<br>two`); any other name only when it
// is not glued to a word before it, so `Array<string>` and `f<T>(x)` stay text.
const HTML_NAMES = new Set(
  `a abbr article aside b bdi bdo blockquote br caption center cite code col colgroup dd del details dfn div dl dt em
   figcaption figure font footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q rp rt ruby s samp
   section small span strike strong sub summary sup table tbody td tfoot th thead time tr tt u ul var wbr`
    .split(/\s+/)
    .filter(Boolean),
)

const SPECIAL = /[\\`*_~[<&]|https?:|www\./i
const ENTITY_RE = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/y
const FOOTNOTE_RE = /\[\^([^\s[\]\\]{1,64})\]/y
const URL_START_RE = /(?:https?:\/\/|www\.)[^\s<]/iy
// `__init__.py` and `if __name__ == "__main__":` are Python, not bold; only these well-known names are exempt
const DUNDER_RE = /[a-z]{1,20}(?=__(?!\w))/y
const DUNDERS = new Set(
  `init main name file doc dict class module all slots repr str len call enter exit getitem setitem delitem iter next new
   del eq ne lt gt le ge hash bool add sub mul truediv floordiv mod pow contains getattr setattr version author package
   path builtins annotations post_init pycache tests mocks snapshots fixtures`
    .split(/\s+/)
    .filter(Boolean),
)

// ---- delimiters and brackets --------------------------------------------------------------------

type Delim = {
  ch: number
  /** first character of what is left of the run */
  start: number
  len: number
  origLen: number
  /** CommonMark's left-flanking verdict; it also feeds the rule of 3, so the exceptions below leave it alone */
  canOpen: boolean
  /** true when the run may not act as an opener after all (`2*3*4`, `src/*.ts`) */
  noOpen: boolean
  canClose: boolean
  prev: Delim | null
  next: Delim | null
}

type Bracket = {
  /** the `[`, or the `!` of `![` */
  start: number
  /** the first character of the link text */
  textStart: number
  image: boolean
  /** the last delimiter before this bracket: emphasis inside the link text only looks above it */
  delimBefore: Delim | null
}

export function paintInline(s: string, refs: Refs, codeOnly: boolean, emit: Emit): void {
  const n = s.length
  if (n === 0 || !SPECIAL.test(s)) return

  const out: Emit = codeOnly ? () => {} : emit
  const dim = (a: number, b: number) => out(a, b, DIM)
  const cpAt = (i: number) => s.codePointAt(i) ?? 32
  const cpBefore = (i: number) => {
    const c = s.charCodeAt(i - 1)
    if (c >= 0xdc00 && c <= 0xdfff && i >= 2) {
      const h = s.charCodeAt(i - 2)
      if (h >= 0xd800 && h <= 0xdbff) return ((h - 0xd800) << 10) + (c - 0xdc00) + 0x10000
    }
    return c
  }

  // one budget for every scanner that can look far ahead (tags, destinations, labels, URLs)
  let budget = 12 * n + 4096

  const codes: number[] = [] // start, end, tick count — painted last so the chip is the final word

  let head: Delim | null = null
  let tail: Delim | null = null
  const brackets: Bracket[] = []
  /** brackets below this index are no longer allowed to become links (a link never holds a link) */
  let deactivateBelow = 0
  let lastBracket = -1

  // ---- code spans: closer lookup is a per-length cursor over the backtick runs, so linear ----
  let tickRuns: Map<number, number[]> | null = null
  const tickCursor = new Map<number, number>()
  const findTickCloser = (len: number, from: number): number => {
    if (tickRuns === null) {
      tickRuns = new Map()
      for (let i = s.indexOf("`"); i !== -1 && i < n; ) {
        let j = i
        while (s.charCodeAt(j) === BACKTICK) j++
        const list = tickRuns.get(j - i)
        if (list) list.push(i)
        else tickRuns.set(j - i, [i])
        i = s.indexOf("`", j)
      }
    }
    const list = tickRuns.get(len)
    if (!list) return -1
    let k = tickCursor.get(len) ?? 0
    while (k < list.length && list[k]! < from) k++
    tickCursor.set(len, k)
    return k < list.length ? list[k]! : -1
  }

  // ---- "no closer after here" memory for `-->`, `?>`, `]]>`, `>` searches ----
  const noCloser = new Map<string, number>()
  const findAfter = (needle: string, from: number): number => {
    const dead = noCloser.get(needle)
    if (dead !== undefined && from >= dead) return -1
    const k = s.indexOf(needle, from)
    if (k === -1) noCloser.set(needle, dead === undefined ? from : Math.min(dead, from))
    return k
  }

  // ---- emphasis: CommonMark's delimiter stack ----
  const removeDelim = (d: Delim) => {
    if (d.prev) d.prev.next = d.next
    else head = d.next
    if (d.next) d.next.prev = d.prev
    else tail = d.prev
  }

  const processEmphasis = (bottom: Delim | null) => {
    let closer: Delim | null = bottom ? bottom.next : head
    if (!closer) return
    const openersBottom: (Delim | null)[] = new Array(18).fill(bottom)
    while (closer) {
      if (!closer.canClose) {
        closer = closer.next
        continue
      }
      const key = (closer.ch === STAR ? 0 : closer.ch === UNDERSCORE ? 1 : 2) * 6 + (closer.canOpen ? 3 : 0) + (closer.origLen % 3)
      const floor = openersBottom[key] ?? null
      let opener: Delim | null = closer.prev
      let found = false
      while (opener && opener !== bottom && opener !== floor) {
        // the rule of 3: `**foo*` cannot pair a 2-run with a 1-run that could also have closed/opened
        const oddMatch =
          (closer.canOpen || opener.canClose) && closer.origLen % 3 !== 0 && (opener.origLen + closer.origLen) % 3 === 0
        if (opener.ch === closer.ch && opener.canOpen && !opener.noOpen && !oddMatch) {
          found = true
          break
        }
        opener = opener.prev
      }
      if (found && opener) {
        const use = closer.len >= 2 && opener.len >= 2 ? 2 : 1
        const openEnd = opener.start + opener.len
        out(openEnd, closer.start, closer.ch === TILDE ? STRIKE : use === 2 ? STRONG : EM)
        dim(openEnd - use, openEnd)
        dim(closer.start, closer.start + use)
        opener.len -= use
        closer.len -= use
        closer.start += use
        for (let d = closer.prev; d && d !== opener; ) {
          const before: Delim | null = d.prev
          removeDelim(d)
          d = before
        }
        if (opener.len === 0) removeDelim(opener)
        if (closer.len === 0) {
          const after: Delim | null = closer.next
          removeDelim(closer)
          closer = after
        }
      } else {
        const after: Delim | null = closer.next
        openersBottom[key] = closer.prev
        if (!closer.canOpen || closer.noOpen) removeDelim(closer)
        closer = after
      }
    }
    while (tail && tail !== bottom) removeDelim(tail)
  }

  const pushDelim = (ch: number, i: number, j: number) => {
    const len = j - i
    const prev = i === 0 ? 32 : cpBefore(i)
    const next = j >= n ? 32 : cpAt(j)
    const prevWs = isWs(prev)
    const nextWs = isWs(next)
    const prevP = isPunct(prev)
    const nextP = isPunct(next)
    let left = !nextWs && (!nextP || prevWs || prevP)
    let right = !prevWs && (!prevP || nextWs || nextP)
    if (ch !== UNDERSCORE) {
      // a CJK letter outside lets the punctuation inside count as a boundary: 日本語**「太字」**です
      if (!left && !nextWs && isCjk(prev)) left = true
      if (!right && !prevWs && isCjk(next)) right = true
    }
    const canOpen = ch === UNDERSCORE ? left && (!right || prevP) : left
    // `__tests__/` and `__generated__/` are path segments: an `_` run right before a `/` does not close
    const canClose = ch === UNDERSCORE ? right && (!left || nextP) && next !== 47 : right
    // `2*3*4`, `x**2 + y**2` and `src/*.ts and lib/*.ts` are arithmetic and globs far more often than
    // emphasis, so a `*` / `~~` run between two ASCII word characters, or any run right after a `/`, only closes
    const noOpen = canOpen && ((ch !== UNDERSCORE && isAlnum(prev) && isAlnum(next)) || prev === 47)
    if (!canClose && (!canOpen || noOpen)) return
    const d: Delim = { ch, start: i, len, origLen: len, canOpen, noOpen, canClose, prev: tail, next: null }
    if (tail) tail.next = d
    else head = d
    tail = d
  }

  // ---- links ----
  /** `(dest "title")` starting at the `(` at `p`; the index just past `)`, or -1. */
  const scanInlineLink = (p: number): number => {
    if (budget <= 0) return -1
    const from = p
    let q = p + 1
    const skipWs = () => {
      while (q < n && isSpaceCode(s.charCodeAt(q))) q++
    }
    const result = (() => {
      skipWs()
      if (s.charCodeAt(q) === RPAREN) return q + 1
      if (s.charCodeAt(q) === LT) {
        q++
        while (q < n) {
          const c = s.charCodeAt(q)
          if (c === 10 || c === LT) return -1
          if (c === GT) break
          q += c === BACKSLASH ? 2 : 1
        }
        if (s.charCodeAt(q) !== GT) return -1
        q++
      } else {
        let depth = 0
        const st = q
        while (q < n) {
          const c = s.charCodeAt(q)
          if (c === BACKSLASH && q + 1 < n) {
            q += 2
            continue
          }
          if (c <= 32) break
          if (c === LPAREN) {
            if (++depth > 32) return -1
          } else if (c === RPAREN) {
            if (depth === 0) break
            depth--
          }
          q++
        }
        if (q === st || depth !== 0) return -1
      }
      const afterDest = q
      skipWs()
      if (s.charCodeAt(q) === RPAREN) return q + 1
      const open = s.charCodeAt(q)
      if (q === afterDest || (open !== QUOTE && open !== APOS && open !== LPAREN)) return -1
      const close = open === LPAREN ? RPAREN : open
      q++
      while (q < n) {
        const c = s.charCodeAt(q)
        if (c === BACKSLASH) {
          q += 2
          continue
        }
        if (c === close) break
        if (c === LPAREN) return -1 // a (title) cannot hold a bare `(`
        q++
      }
      if (s.charCodeAt(q) !== close) return -1
      q++
      skipWs()
      return s.charCodeAt(q) === RPAREN ? q + 1 : -1
    })()
    budget -= Math.min(q, n) - from + 1
    return result
  }

  /** `[label]` at `p`; [labelStart, labelEnd) of the label and the index past `]`, or null. */
  const scanLabel = (p: number): [number, number, number] | null => {
    let q = p + 1
    const limit = Math.min(n, p + 1000)
    while (q < limit) {
      const c = s.charCodeAt(q)
      if (c === BACKSLASH) {
        q += 2
        continue
      }
      if (c === RBRACKET) return [p + 1, q, q + 1]
      if (c === LBRACKET) return null
      q++
    }
    return null
  }

  const isDefined = (from: number, to: number): boolean =>
    refs.links.size > 0 && to - from <= 999 && to > from && refs.links.has(normalizeLabel(s.slice(from, to)))

  const popBracket = () => {
    brackets.pop()
    if (deactivateBelow > brackets.length) deactivateBelow = brackets.length
  }

  const closeBracket = (i: number): number => {
    const previousBracket = lastBracket
    lastBracket = i
    const top = brackets[brackets.length - 1]
    if (!top) return i + 1
    if (!top.image && brackets.length - 1 < deactivateBelow) {
      popBracket()
      return i + 1
    }
    // a label taken from the link text itself (`[t][]`, `[t]`) may not hold brackets
    const clean = previousBracket === top.textStart - 1
    let end = -1
    const next = s.charCodeAt(i + 1)
    if (next === LPAREN) end = scanInlineLink(i + 1)
    if (end === -1 && next === LBRACKET) {
      const label = scanLabel(i + 1)
      if (label) {
        if (label[0] === label[1]) {
          if (clean && isDefined(top.textStart, i)) end = label[2]
        } else if (isDefined(label[0], label[1])) end = label[2]
      }
    }
    if (end === -1 && clean && isDefined(top.textStart, i)) end = i + 1
    if (end === -1) {
      popBracket()
      return i + 1
    }
    dim(top.start, top.textStart)
    out(top.textStart, i, top.image ? IMAGE_ALT : LINK_TEXT)
    dim(i, end)
    processEmphasis(top.delimBefore)
    popBracket()
    if (!top.image) deactivateBelow = brackets.length
    return end
  }

  // ---- `<`: autolinks and inline HTML ----
  const scanAutolink = (i: number): number => {
    const p = i + 1
    if (isAlpha(s.charCodeAt(p))) {
      let q = p + 1
      while (q < n && q - p < 32 && (isAlnum(s.charCodeAt(q)) || s.charCodeAt(q) === 43 || s.charCodeAt(q) === 46 || s.charCodeAt(q) === 45)) q++
      if (q - p >= 2 && s.charCodeAt(q) === 58) {
        q++
        while (q < n) {
          const c = s.charCodeAt(q)
          if (c <= 32 || c === LT || c === GT) break
          q++
        }
        budget -= q - i
        if (s.charCodeAt(q) === GT) return q + 1
      }
    }
    // <name@example.com>
    let q = p
    while (q < n && (isAlnum(s.charCodeAt(q)) || ".!#$%&'*+/=?^_`{|}~-".includes(s[q]!))) q++
    if (q > p && s.charCodeAt(q) === 64) {
      const d0 = q + 1
      let r = d0
      while (r < n && (isAlnum(s.charCodeAt(r)) || s.charCodeAt(r) === 46 || s.charCodeAt(r) === 45)) r++
      budget -= r - i
      const domain = s.slice(d0, r)
      if (r > d0 && s.charCodeAt(r) === GT && /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(domain) && !domain.includes("..")) return r + 1
    }
    return -1
  }

  /** end of the tag / comment / declaration at `i`, or -1; `comment` says which style it gets. */
  const scanHtml = (i: number): { end: number; comment: boolean } | null => {
    if (budget <= 0) return null
    const c1 = s.charCodeAt(i + 1)
    if (c1 === BANG) {
      if (s.startsWith("!--", i + 1)) {
        const k = findAfter("-->", i + 4)
        return k === -1 ? null : { end: k + 3, comment: true }
      }
      if (s.startsWith("![CDATA[", i + 1)) {
        const k = findAfter("]]>", i + 9)
        return k === -1 ? null : { end: k + 3, comment: true }
      }
      if (isAlpha(s.charCodeAt(i + 2))) {
        const k = findAfter(">", i + 2)
        return k === -1 ? null : { end: k + 1, comment: false }
      }
      return null
    }
    if (c1 === 63) {
      const k = findAfter("?>", i + 2)
      return k === -1 ? null : { end: k + 2, comment: true }
    }
    const closing = c1 === 47
    let p = i + (closing ? 2 : 1)
    const nameStart = p
    if (!isAlpha(s.charCodeAt(p))) return null
    while (p < n && isTagNameChar(s.charCodeAt(p))) p++
    if (!closing && i > 0 && isWord(s.charCodeAt(i - 1)) && !HTML_NAMES.has(s.slice(nameStart, p).toLowerCase())) return null
    const result = (() => {
      for (;;) {
        const before = p
        while (isSpaceCode(s.charCodeAt(p))) p++
        const spaced = p > before
        const c = s.charCodeAt(p)
        if (c === GT) return p + 1
        if (c === 47 && s.charCodeAt(p + 1) === GT && !closing) return p + 2
        if (closing || !spaced || !isAttrStart(c)) return -1
        p++
        while (isAttrChar(s.charCodeAt(p))) p++
        let q = p
        while (isSpaceCode(s.charCodeAt(q))) q++
        if (s.charCodeAt(q) !== 61) continue
        q++
        while (isSpaceCode(s.charCodeAt(q))) q++
        const v = s.charCodeAt(q)
        if (v === QUOTE || v === APOS) {
          const limit = Math.min(n, q + 2000)
          let r = q + 1
          while (r < limit && s.charCodeAt(r) !== v) r++
          if (s.charCodeAt(r) !== v) return -1
          p = r + 1
        } else {
          const st = q
          while (q < n) {
            const c2 = s.charCodeAt(q)
            if (isSpaceCode(c2) || c2 === QUOTE || c2 === APOS || c2 === 61 || c2 === LT || c2 === GT || c2 === BACKTICK) break
            q++
          }
          if (q === st) return -1
          p = q
        }
      }
    })()
    budget -= Math.min(p, n) - i + 1
    return result === -1 ? null : { end: result, comment: false }
  }

  // ---- bare URLs (GFM extended autolink) ----
  const scanBareUrl = (i: number): number => {
    if (budget <= 0) return -1
    URL_START_RE.lastIndex = i
    const m = URL_START_RE.exec(s)
    if (!m) return -1
    const minEnd = i + m[0].length
    let j = minEnd
    const stopAtBracket = brackets.length > 0
    let opens = 0
    let closes = 0
    while (j < n) {
      const c = s.charCodeAt(j)
      if (c <= 32 || isWs(c) || c === LT || (stopAtBracket && c === RBRACKET)) break
      if (c === LPAREN) opens++
      else if (c === RPAREN) closes++
      j++
    }
    budget -= j - i
    for (;;) {
      const last = s.charCodeAt(j - 1)
      if (j > minEnd && (last === 63 || last === 33 || last === 46 || last === 44 || last === 58 || last === STAR || last === UNDERSCORE || last === TILDE || last === APOS || last === QUOTE)) {
        j--
      } else if (j > minEnd && last === RPAREN && closes > opens) {
        closes--
        j--
      } else if (j > minEnd && last === SEMI) {
        let k = j - 2
        while (k > i && isAlnum(s.charCodeAt(k))) k--
        if (s.charCodeAt(k) === AMP && k < j - 2) j = k
        else break
      } else break
    }
    return j >= minEnd ? j : -1
  }

  // ---- the scan ----
  let i = 0
  while (i < n) {
    const c = s.charCodeAt(i)
    switch (c) {
      case BACKSLASH:
        i += i + 1 < n && isAsciiPunct(s.charCodeAt(i + 1)) ? 2 : 1
        break

      case BACKTICK: {
        let j = i
        while (s.charCodeAt(j) === BACKTICK) j++
        const close = findTickCloser(j - i, j)
        if (close === -1) {
          i = j
        } else {
          codes.push(i, close + (j - i), j - i)
          i = close + (j - i)
        }
        break
      }

      case STAR:
      case UNDERSCORE:
      case TILDE: {
        let j = i
        while (s.charCodeAt(j) === c) j++
        if (c === UNDERSCORE && j - i === 2 && (i === 0 || !isWord(s.charCodeAt(i - 1)))) {
          DUNDER_RE.lastIndex = j
          const m = DUNDER_RE.exec(s)
          if (m && DUNDERS.has(m[0])) {
            i = j + m[0].length + 2
            break
          }
        }
        if (c !== TILDE || j - i === 2) pushDelim(c, i, j)
        i = j
        break
      }

      case BANG:
        if (s.charCodeAt(i + 1) === LBRACKET) {
          brackets.push({ start: i, textStart: i + 2, image: true, delimBefore: tail })
          lastBracket = i + 1
          i += 2
        } else i++
        break

      case LBRACKET: {
        if (s.charCodeAt(i + 1) === 94) {
          FOOTNOTE_RE.lastIndex = i
          const m = FOOTNOTE_RE.exec(s)
          if (m && (refs.footnotes.has(normalizeLabel(m[1]!)) || /^\d{1,3}$/.test(m[1]!))) {
            const end = i + m[0].length
            dim(i, i + 2)
            out(i + 2, end - 1, FOOTNOTE)
            dim(end - 1, end)
            i = end
            break
          }
        }
        brackets.push({ start: i, textStart: i + 1, image: false, delimBefore: tail })
        lastBracket = i
        i++
        break
      }

      case RBRACKET:
        i = closeBracket(i)
        break

      case LT: {
        const auto = scanAutolink(i)
        if (auto !== -1) {
          dim(i, i + 1)
          out(i + 1, auto - 1, LINK_TEXT)
          dim(auto - 1, auto)
          i = auto
          break
        }
        const html = scanHtml(i)
        if (html) {
          out(i, html.end, html.comment ? COMMENT : TAG)
          i = html.end
        } else i++
        break
      }

      case AMP: {
        ENTITY_RE.lastIndex = i
        const m = ENTITY_RE.exec(s)
        if (m) {
          out(i, i + m[0].length, ENTITY)
          i += m[0].length
        } else i++
        break
      }

      default: {
        const low = c | 32
        if ((low === 104 || low === 119) && (i === 0 || isWs(s.charCodeAt(i - 1)) || s.charCodeAt(i - 1) === STAR || s.charCodeAt(i - 1) === UNDERSCORE || s.charCodeAt(i - 1) === TILDE || s.charCodeAt(i - 1) === LPAREN)) {
          const end = scanBareUrl(i)
          if (end !== -1) {
            out(i, end, LINK_TEXT)
            i = end
            break
          }
        }
        i++
      }
    }
  }

  processEmphasis(null)

  // code spans last, so their background is the final word on those characters
  for (let k = 0; k < codes.length; k += 3) {
    const a = codes[k]!
    const b = codes[k + 1]!
    const t = codes[k + 2]!
    emit(a, b, CODE_CHIP)
    emit(a, a + t, CODE_TICKS)
    emit(b - t, b, CODE_TICKS)
  }
}
