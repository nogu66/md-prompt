// Hook-level tests, run by `claude plugin test plugins/md-prompt`: the real module, loaded by the
// engine's own host, driven through the events the kit can raise. What decides *what* is painted
// is covered at the unit level in /tests; this file covers the wiring: the command, the mode
// setting, and that the right events carry the decorations.
//
// `prompt.edit` is raised by the composer alone, so the kit has no call for it. `prompt.fill` is
// wired the same way (the same `paint`, the same mode), so it stands in for it here; `prompt.edit`
// itself is checked in a live session.

import { expect, test } from 'claude-code/testing'

const FENCE = '```ts\nconst a = 1\n```'
const CARD = '#1f2430' // PALETTE.codeBg

/**
 * Record what a fill hands down the chain. Hooks beneath the plugins must be registered before
 * the test's first `$` call, so this goes first; the returned function fills as often as needed.
 */
function recordFills(on: any) {
  let seen: any
  on('prompt.fill', ($: any, e: any) => {
    seen = e
    return { isFilled: true }
  })
  return async ($: any, args: { text: string; mode?: string; decorations?: unknown[] }) => {
    seen = undefined
    await $.prompt.fill(args)
    return seen
  }
}

/** Run `/md-prompt <args>` as typed; the engine stamps the origin and presentation itself. */
const run = ($: any, args: string) => $.command.run({ command: 'md-prompt', args })

/** Record every write of a `/config` row, and accept it. */
function acceptSettings(on: any) {
  const written: { key: string; value: unknown }[] = []
  on('config.set', ($: any, e: any) => {
    written.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  return written
}

test('session.start registers the /md-prompt command', async ($, on) => {
  const registered: any[] = []
  on('command.register', ($: any, e: any) => {
    registered.push(e)
    return { value: { command: e.name } }
  })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  expect(registered.map((c) => c.name)).toEqual(['md-prompt'])
})

test('a replace fill carries the decorations of its text, its own kept', async ($, on) => {
  const fill = recordFills(on)
  const mine = { start: 0, end: 1, bold: true }
  const e = await fill($, { text: FENCE, mode: 'replace', decorations: [mine] })
  expect(e.text).toBe(FENCE)
  expect(e.decorations[0]).toEqual(mine)
  expect(e.decorations.some((d: any) => d.backgroundColor === CARD)).toBe(true)
  for (const d of e.decorations) {
    expect(d.start).toBeGreaterThanOrEqual(0)
    expect(d.end).toBeLessThanOrEqual(FENCE.length)
  }
})

test('an append or insert fill is left alone: its text is not the whole draft', async ($, on) => {
  const fill = recordFills(on)
  for (const mode of ['append', 'insert']) {
    const e = await fill($, { text: FENCE, mode })
    expect(e.decorations).toBeUndefined()
  }
})

test('the text of a fill is never changed', async ($, on) => {
  const fill = recordFills(on)
  const text = '**bold** `code`\n```py\nprint(1)\n```\n日本語 😀'
  const e = await fill($, { text, mode: 'replace' })
  expect(e.text).toBe(text)
})

test('the setting off paints nothing', { options: { enabled: false } }, async ($, on) => {
  const fill = recordFills(on)
  const e = await fill($, { text: FENCE, mode: 'replace' })
  expect(e.decorations).toBeUndefined()
})

test('a mode left in settings by 0.1.x is ignored, and painting is on', { options: { mode: 'off' } }, async ($, on) => {
  const fill = recordFills(on)
  const e = await fill($, { text: FENCE, mode: 'replace' })
  expect(e.decorations.length).toBeGreaterThan(0)
})

test('/md-prompt off writes the setting and stops painting at once', async ($, on) => {
  const fill = recordFills(on)
  const written = acceptSettings(on)
  const result = await run($, 'off')
  expect(written).toEqual([{ key: 'md-prompt.enabled', value: false }])
  expect(result.text).toContain('off')
  expect(result.text).not.toContain('not saved')
  const e = await fill($, { text: FENCE, mode: 'replace' })
  expect(e.decorations).toBeUndefined()
})

test('/md-prompt off, then on, switch painting back and forth', async ($, on) => {
  const fill = recordFills(on)
  const written = acceptSettings(on)
  await run($, 'off')
  let e = await fill($, { text: '**bold**', mode: 'replace' })
  expect(e.decorations).toBeUndefined()
  await run($, 'on')
  e = await fill($, { text: '**bold**', mode: 'replace' })
  expect(e.decorations.some((d: any) => d.bold)).toBe(true)
  expect(written.map((w) => w.value)).toEqual([false, true])
})

test('/md-prompt toggle flips between off and on', { options: { enabled: false } }, async ($, on) => {
  const written = acceptSettings(on)
  await run($, 'toggle')
  await run($, 'toggle')
  expect(written.map((w) => w.value)).toEqual([true, false])
})

test('a refused setting still applies for the session, and says it was not saved', async ($, on) => {
  const fill = recordFills(on)
  on('config.set', () => ({ deny: 'no row for plugin fields here' }))
  const result = await run($, 'off')
  expect(result.text).toContain('not saved')
  expect(result.text).toContain('no row for plugin fields here')
  const e = await fill($, { text: FENCE, mode: 'replace' })
  expect(e.decorations).toBeUndefined()
})

test('status and a bad argument write nothing', async ($, on) => {
  const written = acceptSettings(on)
  const status = await run($, '')
  expect(status.text).toContain('/md-prompt on | off | toggle')
  const bad = await run($, 'maybe')
  expect(bad.text).toContain('"maybe"')
  const code = await run($, 'code')
  expect(code.text).toContain('"code"')
  expect(written).toEqual([])
})
