// Pure logic for the on/off switch: what the modes are, how `/md-prompt <args>` is read, what the
// command answers with, and which decorations a mode paints. No `$`, no state — the hooks module
// owns the current mode and its persistence; everything decidable without them is here.

import { decorateMarkdown, type Decoration } from "./mdprompt"

/** `on` paints everything, `off` nothing. */
export type Mode = "on" | "off"

export const DEFAULT_MODE: Mode = "on"

export type ModeCommand =
  | { kind: "set"; mode: Mode }
  | { kind: "status" }
  | { kind: "usage"; input: string }

/** Read the arguments of `/md-prompt`. Nothing (or `status`) asks for the state; `toggle` flips it. */
export function parseModeCommand(args: string, current: Mode): ModeCommand {
  const word = args.trim().toLowerCase()
  switch (word) {
    case "":
    case "status":
      return { kind: "status" }
    case "on":
    case "all":
      return { kind: "set", mode: "on" }
    case "off":
      return { kind: "set", mode: "off" }
    case "toggle":
      return { kind: "set", mode: current === "off" ? "on" : "off" }
    default:
      return { kind: "usage", input: word }
  }
}

/** The mode the `enabled` setting names; anything but a boolean (or absent) is the default. */
export function readMode(value: unknown): Mode {
  return value === true ? "on" : value === false ? "off" : DEFAULT_MODE
}

const USAGE = "/md-prompt on | off | toggle"

export function describeMode(mode: Mode): string {
  switch (mode) {
    case "on":
      return "on — code, emphasis, links, headings, lists, tables and quotes are painted"
    case "off":
      return "off — the prompt box is left as plain text"
  }
}

export function formatStatus(mode: Mode): string {
  return `${describeMode(mode)}\n${USAGE}`
}

export function formatUsage(input: string): string {
  return `unknown option "${input}"\n${USAGE}`
}

/** The decorations `mode` paints over `text`; none when off. */
export function paintFor(mode: Mode, text: string): Decoration[] {
  if (mode === "off") return []
  return decorateMarkdown(text)
}
