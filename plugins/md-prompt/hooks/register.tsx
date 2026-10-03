// Hooks module. Wires the prompt box to the pure logic in ./lib — everything that decides *what*
// to paint lives there (lib/mdprompt.ts, lib/highlight.ts) and everything that decides *whether*
// (lib/mode.ts); this file only says *when*, and owns the two `$` uses: the `/md-prompt` command
// and writing the mode setting.
//
// The prompt box cannot be redrawn by a hook, but the engine lets one paint style runs over the
// draft (`decorations`, offsets into the text). Two events carry them:
//   prompt.edit — every edit or paste the person makes; we decorate the box the edit produced.
//   prompt.fill — a plugin (or the engine) writing the draft; only `replace` is the whole draft,
//                 so only then are offsets into `e.text` offsets into the box.
// The draft's characters, the cursor and other plugins' decorations pass through as they came.
//
// The mode is the plugin's `enabled` setting (userConfig), a toggle in /config. `/md-prompt <mode>`
// writes that row, as a change in /config would; the engine then reloads this module with the
// new value, which `register` reads from `options`. Where there is no /config row for plugin
// fields the write is refused: the mode then holds for the rest of this activation only.

import type { Register } from "claude-code"
import {
  describeMode,
  formatStatus,
  formatUsage,
  paintFor,
  parseModeCommand,
  readMode,
  type Mode,
} from "./lib/mode"

// A hook that throws is skipped with a notice on every keystroke; painting is decoration, so a
// bug in it must cost the colours, never the notice.
function paint(value: Mode, text: string) {
  try {
    return paintFor(value, text)
  } catch {
    return []
  }
}

export const register: Register = (on, options) => {
  let mode: Mode = readMode(options.enabled)

  on("session.start", async ($, e, next) => {
    const r = await next(e)
    await $.command
      .register({
        name: "md-prompt",
        description: "Turn Markdown painting in the prompt box on or off",
        argumentHint: "[on | off | toggle]",
        immediate: true,
      })
      .catch((err: unknown) => $.ui.log(`md-prompt: command.register failed: ${err}`))
    return r
  })

  on("command.run", { command: "md-prompt" }, async ($, e) => {
    const cmd = parseModeCommand(e.args, mode)
    if (cmd.kind === "status") return { text: formatStatus(mode) }
    if (cmd.kind === "usage") return { text: formatUsage(cmd.input) }
    // Applies at once; a written setting reloads the module, which starts in the same mode.
    mode = cmd.mode
    // A refusal must never escape the hook: it only means the mode is not kept for next time
    let failure: string | null
    try {
      const result = await $.config.set({ key: "md-prompt.enabled", value: mode === "on" })
      failure = result.deny ?? null
    } catch (err) {
      failure = String(err)
    }
    return { text: failure ? `${describeMode(mode)} (not saved for next time: ${failure})` : describeMode(mode) }
  })

  on("prompt.edit", async ($, e, next) => {
    const box = await next(e)
    if (mode === "off") return box
    return { ...box, decorations: [...(box.decorations ?? []), ...paint(mode, box.text)] }
  })

  on("prompt.fill", ($, e, next) => {
    if (mode === "off" || e.mode !== "replace") return next(e)
    return next({ ...e, decorations: [...(e.decorations ?? []), ...paint(mode, e.text)] })
  })
}
