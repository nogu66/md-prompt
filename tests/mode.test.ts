import { describe, expect, test } from "bun:test"
import {
  DEFAULT_MODE,
  describeMode,
  formatStatus,
  formatUsage,
  paintFor,
  parseModeCommand,
  readMode,
  type Mode,
} from "../plugins/md-prompt/hooks/lib/mode"
import { PALETTE, decorateMarkdown } from "../plugins/md-prompt/hooks/lib/mdprompt"

describe("parseModeCommand", () => {
  test("no arguments, or `status`, asks for the state", () => {
    expect(parseModeCommand("", "on")).toEqual({ kind: "status" })
    expect(parseModeCommand("   ", "off")).toEqual({ kind: "status" })
    expect(parseModeCommand("status", "code")).toEqual({ kind: "status" })
  })

  test("on / all, code, off set that mode", () => {
    expect(parseModeCommand("on", "off")).toEqual({ kind: "set", mode: "on" })
    expect(parseModeCommand("all", "off")).toEqual({ kind: "set", mode: "on" })
    expect(parseModeCommand("code", "on")).toEqual({ kind: "set", mode: "code" })
    expect(parseModeCommand("off", "on")).toEqual({ kind: "set", mode: "off" })
  })

  test("case and surrounding space do not matter", () => {
    expect(parseModeCommand("  OFF ", "on")).toEqual({ kind: "set", mode: "off" })
    expect(parseModeCommand("Code", "on")).toEqual({ kind: "set", mode: "code" })
  })

  test("toggle flips off <-> on, and turns code off", () => {
    expect(parseModeCommand("toggle", "on")).toEqual({ kind: "set", mode: "off" })
    expect(parseModeCommand("toggle", "code")).toEqual({ kind: "set", mode: "off" })
    expect(parseModeCommand("toggle", "off")).toEqual({ kind: "set", mode: "on" })
  })

  test("anything else is a usage error carrying what was typed", () => {
    expect(parseModeCommand("maybe", "on")).toEqual({ kind: "usage", input: "maybe" })
    expect(parseModeCommand("on off", "on")).toEqual({ kind: "usage", input: "on off" })
  })
})

describe("readMode", () => {
  test("a valid mode value comes back as it was", () => {
    for (const mode of ["on", "code", "off"] as const) expect(readMode(mode)).toBe(mode)
  })

  test("absent or garbled values fall back to the default", () => {
    expect(DEFAULT_MODE).toBe("on")
    for (const bad of [undefined, null, "", "ON", "true", 1, true, {}, ["off"]]) {
      expect(readMode(bad)).toBe(DEFAULT_MODE)
    }
  })
})

describe("messages", () => {
  test("each mode has its own description, and the status adds the usage", () => {
    const modes: Mode[] = ["on", "code", "off"]
    const texts = modes.map(describeMode)
    expect(new Set(texts).size).toBe(3)
    for (const mode of modes) expect(formatStatus(mode)).toContain("/md-prompt on | code | off | toggle")
  })

  test("the usage error names the bad input", () => {
    expect(formatUsage("maybe")).toContain('"maybe"')
    expect(formatUsage("maybe")).toContain("/md-prompt")
  })
})

describe("paintFor", () => {
  const draft = "**bold** and `code`\n```ts\nconst a = 1\n```\n# Head"

  test("off paints nothing", () => {
    expect(paintFor("off", draft)).toEqual([])
  })

  test("on paints exactly what decorateMarkdown does", () => {
    expect(paintFor("on", draft)).toEqual(decorateMarkdown(draft))
  })

  test("code paints fenced code and inline code, and none of the rest", () => {
    const runs = paintFor("code", draft)
    const styles = Array.from({ length: draft.length }, () => ({}) as Record<string, unknown>)
    for (const { start, end, ...style } of runs) for (let i = start; i < end; i++) Object.assign(styles[i]!, style)

    const at = (needle: string) => styles[draft.indexOf(needle)]!
    // code is painted
    expect(at("code`")).toMatchObject({ backgroundColor: PALETTE.inlineBg })
    expect(at("const")).toMatchObject({ backgroundColor: PALETTE.codeBg, color: PALETTE.token.keyword })
    // emphasis and headings are not
    expect(at("bold")).toEqual({})
    expect(at("**")).toEqual({})
    expect(at("Head")).toEqual({})
    expect(at("# Head")).toEqual({})
  })

  test("code-only leaves links and quote marks alone too", () => {
    const text = "> see [docs](https://a.com) and *it*"
    expect(paintFor("code", text)).toEqual([])
  })

  test("code-only still ignores markup inside a code span (escapes and spans behave as before)", () => {
    const text = "run `**x**` \\`not code\\`"
    const runs = paintFor("code", text)
    expect(runs.every((r) => r.bold === undefined && r.italic === undefined)).toBe(true)
    expect(runs.some((r) => r.backgroundColor === PALETTE.inlineBg)).toBe(true)
  })
})
