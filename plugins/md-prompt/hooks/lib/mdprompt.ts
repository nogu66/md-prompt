// Pure logic: the text of the prompt draft in, `PromptDecoration`-shaped runs out. No `$`, no UI.
//
// The prompt box can only be *painted* over (the engine never lets a hook change the drawn
// characters), so every Markdown marker stays visible; the job here is to make the markup read
// as formatted: fences and `**` dimmed, code blocks a coloured card, emphasis bold/italic, list
// bullets and task boxes coloured, tables with faint pipes, quotes italic.
//
// Offsets are UTF-16 code units — exactly what JS string indices already are. Later entries win
// per style key on the engine's side, so a run only names what it changes: a token colour sits
// on top of the block background laid down first. No run is empty, leaves the text, or holds a
// line break.
//
// The work is split by what it reads:
//   blocks.ts   — line structure: quotes, lists, fences, headings, tables, rules, definitions
//   inline.ts   — inside a paragraph: code spans, emphasis, links, images, HTML, entities, URLs
//   highlight.ts — the inside of a fenced code block, per language
//   palette.ts  — the colours and the `Decoration` shape
// Everything is linear in the length of the draft, and a draft over `MAX_CHARS` is left alone.
//
// Supported: fenced (``` and ~~~, closed or still being typed) and indented code, inline code,
// bold, italic, bold+italic, strikethrough, links (inline, reference, autolink, bare URL),
// images, footnotes, ATX and setext headings, quotes, bullet / ordered / task lists (nested),
// GFM tables, thematic breaks, HTML tags and comments, entities, backslash escapes.

import { decorateBlocks } from "./blocks"
import { MAX_CHARS, type Decoration } from "./palette"

export { MAX_CHARS, PALETTE } from "./palette"
export type { Decoration } from "./palette"

export type Options = {
  /** Paint fenced / indented code blocks and inline code only: no emphasis, links, headings, lists, tables or quote marks. */
  codeOnly?: boolean
}

export function decorateMarkdown(text: string, { codeOnly = false }: Options = {}): Decoration[] {
  if (text === "" || text.length > MAX_CHARS) return []
  const runs = decorateBlocks(text, codeOnly)
  // a safety net, not a filter anyone should hit: the engine gets only ranges that fit the draft
  return runs.filter((d) => d.start >= 0 && d.end <= text.length && d.end > d.start)
}
