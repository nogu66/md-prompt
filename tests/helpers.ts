// Shared by the *.test.ts files: read the painter's output the way the engine would.
import { expect } from "bun:test"
import { decorateMarkdown, type Decoration, type Options } from "../plugins/md-prompt/hooks/lib/mdprompt"

export type Style = Omit<Decoration, "start" | "end">

/** Per character, the style the engine ends up with: later runs win per style key. */
export function paint(text: string, options: Options = {}): Style[] {
  const styles: Style[] = Array.from({ length: text.length }, () => ({}))
  for (const { start, end, ...style } of decorateMarkdown(text, options)) {
    for (let i = start; i < end; i++) Object.assign(styles[i]!, style)
  }
  return styles
}

/** Style of the first occurrence of `needle` at or after `from` (all its characters must agree). */
export function at(text: string, needle: string, from = 0, options: Options = {}): Style {
  const i = text.indexOf(needle, from)
  if (i === -1) throw new Error(`no ${JSON.stringify(needle)} in ${JSON.stringify(text)}`)
  const styles = paint(text, options)
  const first = styles[i]!
  for (let k = i; k < i + needle.length; k++) expect(styles[k]).toEqual(first)
  return first
}

/** True when no character of `text` carries a value for any of `keys`. */
export function unstyled(text: string, ...keys: (keyof Style)[]): boolean {
  return paint(text).every((s) => keys.every((k) => s[k] === undefined))
}

/** Every run is a valid range of `text`: inside it, non-empty, and free of line breaks. */
export function expectValidRuns(text: string, options: Options = {}): void {
  for (const d of decorateMarkdown(text, options)) {
    expect(d.start).toBeGreaterThanOrEqual(0)
    expect(d.end).toBeLessThanOrEqual(text.length)
    expect(d.end).toBeGreaterThan(d.start)
    expect(/[\n\r]/.test(text.slice(d.start, d.end))).toBe(false)
  }
}
