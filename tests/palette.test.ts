import { describe, expect, test } from "bun:test"
import { PALETTE } from "../plugins/md-prompt/hooks/lib/palette"

// WCAG relative luminance and contrast ratio.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!)
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const WHITE = "#ffffff"
const LIGHT_GREY = "#f5f5f5"
const DARK_GREY = "#1e1e1e"
const BLACK = "#000000"

// Colours that sit straight on the terminal background, with no card behind them.
const BARE = {
  heading: PALETTE.heading,
  link: PALETTE.link,
  bullet: PALETTE.bullet,
  taskTodo: PALETTE.taskTodo,
  taskDone: PALETTE.taskDone,
  tag: PALETTE.tag,
  entity: PALETTE.entity,
}

describe("the palette reads on light and dark terminals", () => {
  for (const [name, color] of Object.entries(BARE)) {
    test(`${name} ${color} keeps its contrast on a light and a dark terminal`, () => {
      expect(contrast(color, WHITE)).toBeGreaterThanOrEqual(3.3)
      expect(contrast(color, LIGHT_GREY)).toBeGreaterThanOrEqual(3.0)
      expect(contrast(color, DARK_GREY)).toBeGreaterThanOrEqual(4.3)
      expect(contrast(color, BLACK)).toBeGreaterThanOrEqual(4.3)
    })
  }

  test("everything drawn on the code card is readable against the card", () => {
    const onCard: Record<string, string> = { codeFg: PALETTE.codeFg, fence: PALETTE.fence, lang: PALETTE.lang, ...PALETTE.token }
    for (const [name, color] of Object.entries(onCard)) {
      expect(contrast(color, PALETTE.codeBg), `${name} ${color} on the card`).toBeGreaterThanOrEqual(3.5)
    }
    expect(contrast(PALETTE.inlineFg, PALETTE.inlineBg)).toBeGreaterThanOrEqual(4.5)
  })

  test("the code text itself reads with a strong margin", () => {
    expect(contrast(PALETTE.codeFg, PALETTE.codeBg)).toBeGreaterThanOrEqual(7)
  })
})
