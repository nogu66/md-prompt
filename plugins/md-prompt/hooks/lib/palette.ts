// Shared vocabulary of the painter: the `Decoration` shape the engine takes and the colours we use.
// Pure data, no logic. `mdprompt.ts` re-exports everything here, so callers keep importing from there.

import type { TokenKind } from "./highlight"

export type Decoration = {
  start: number
  end: number
  color?: string
  backgroundColor?: string
  dimColor?: boolean
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}

/** What a run says about its characters; `start`/`end` are added when it is emitted. */
export type Style = Omit<Decoration, "start" | "end">

// Explicit foreground + background on code so the block reads on a light or a dark terminal
// alike, whatever the user's theme paints the rest of the prompt with.
//
// The colours that sit straight on the terminal background (no card behind them) are mid-tones,
// luminance about 0.2: at least 3.3:1 on white and 4.5:1 on a dark grey (#1e1e1e) terminal.
// tests/palette.test.ts holds that floor, so a new colour cannot make a light theme unreadable. Everything that is
// only a marker (`#`, `|`, `**`, `---`) is `dimColor` instead, which follows the theme by itself.
export const PALETTE = {
  codeBg: "#1f2430",
  codeFg: "#d4d4d4",
  fence: "#808080",
  lang: "#79c0ff",
  inlineBg: "#2b2f3a",
  inlineFg: "#e6c07b",
  heading: "#3a86e0",
  link: "#3a86e0",
  /** list bullets and ordered-list numbers */
  bullet: "#289488",
  /** `[ ]`: still to do */
  taskTodo: "#ac7d0a",
  /** `[x]`: done */
  taskDone: "#399657",
  /** inline HTML / XML tags, `<thinking>` and friends */
  tag: "#a06bd0",
  /** `&amp;` `&#39;` */
  entity: "#b87727",
  token: {
    keyword: "#c586c0",
    string: "#ce9178",
    comment: "#6a9955",
    number: "#b5cea8",
    type: "#4ec9b0",
    literal: "#569cd6",
    add: "#7ee787",
    del: "#ff7b72",
    meta: "#79c0ff",
  } satisfies Record<TokenKind, string>,
} as const

/** A draft this long is left unpainted: the box stays responsive and nobody writes this in a prompt box. */
export const MAX_CHARS = 60_000
