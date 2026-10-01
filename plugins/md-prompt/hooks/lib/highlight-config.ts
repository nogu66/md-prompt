// Line-oriented config formats whose meaning depends on where a word sits: TOML / INI,
// Dockerfile and Makefile. Same contract as `highlight.ts`: text in, ordered non-overlapping
// spans out, one linear pass, never throws.

import type { Span } from "./highlight"
import { isAlpha, isBlank, isBoundary, isDigit, isWord, lineEnd, push, quoteScanner, set, trimCr } from "./highlight-util"

const TOML_NUMBER = /[+-]?(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/y
const TOML_DATE =
  /\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?/y
const PLAIN_NUMBER = /0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?/y

/**
 * A number at `j`, or nothing when it is part of a longer word (`10px`, `1.2.3`, `abc1`): that
 * whole run is skipped unpainted. Returns where to resume.
 */
function number(code: string, spans: Span[], j: number, to: number, re: RegExp): number {
  re.lastIndex = j
  const m = re.exec(code)
  if (!m) return j + 1
  let e = Math.min(j + m[0].length, to)
  if (e < to && (isWord(code[e]) || (code[e] === "." && isWord(code[e + 1])))) {
    while (e < to && (isWord(code[e]) || code[e] === ".")) e++
    return e
  }
  push(spans, j, e, "number")
  return e
}

/**
 * TOML and INI. Section headers are meta, keys are types, plus strings (TOML's `"""` / `'''` run
 * over lines), numbers and dates, `true` / `false`, and `#` comments (`;` too in INI, where a
 * comment starts at the beginning of a line or after a blank).
 */
export function highlightToml(code: string, ini: boolean): Span[] {
  const spans: Span[] = []
  const n = code.length
  const quote = quoteScanner(code)
  const stack: string[] = [] // open `[` / `{` of a TOML value
  let lineBegin = 0
  let first = true // nothing seen yet on this line
  let expectKey = true // a `key =` may start here

  // `[section]` / `[[table]]`: the index past the header, or -1.
  const header = (i: number): number => {
    let j = i + 1
    const double = !ini && code[j] === "["
    if (double) j++
    const nameStart = j
    while (j < n && code[j] !== "]") {
      const c = code[j]!
      if (c === "\n" || (!ini && (c === "," || c === "[" || c === "="))) return -1
      if (!ini && (c === '"' || c === "'")) {
        const e = quote(j, c, c === '"')
        if (e === -1) return -1
        j = e
      } else j++
    }
    if (j >= n || j === nameStart) return -1
    j++
    if (double) {
      if (code[j] !== "]") return -1
      j++
    }
    if (!ini) {
      let k = j
      while (k < n && (isBlank(code[k]) || code[k] === "\r")) k++
      if (k < n && code[k] !== "\n" && code[k] !== "#") return -1 // `[1, 2]` is a value, not a header
    }
    return j
  }

  // `key =` (INI also `key:`): [end of the key text, index of the separator], or null.
  const key = (i: number): [number, number] | null => {
    let j = i
    for (; j < n; j++) {
      const c = code[j]!
      if (c === "=") break
      if (ini) {
        if (c === ":") {
          const d = code[j + 1]
          if (d === undefined || d === "\n" || d === "\r" || isBlank(d)) break
          return null // `http://...` is not a key
        }
        if (c === "\n" || c === "#" || c === ";") return null
      } else if (c === '"' || c === "'") {
        const e = quote(j, c, c === '"')
        if (e === -1) return null
        j = e - 1
      } else if (!(isWord(c) || c === "-" || c === "." || isBlank(c))) return null
    }
    if (j >= n) return null
    let e = j
    while (e > i && isBlank(code[e - 1])) e--
    return e > i ? [e, j] : null
  }

  const comment = (i: number): number => {
    const e = trimCr(code, i, lineEnd(code, i))
    push(spans, i, e, "comment")
    return e
  }

  let i = 0
  while (i < n) {
    const c = code[i]!
    if (c === "\n") {
      i++
      lineBegin = i
      first = true
      expectKey = stack.length === 0 || stack[stack.length - 1] === "{"
      continue
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++
      continue
    }
    const atFirst = first
    first = false

    if (ini ? (c === ";" || c === "#") && isBoundary(code[i - 1]) : c === "#") {
      i = comment(i)
      continue
    }
    if (c === "[" && atFirst && (expectKey || (!ini && i === lineBegin))) {
      const e = header(i)
      if (e !== -1) {
        push(spans, i, e, "meta")
        stack.length = 0 // a header at column 0 ends any array a truncated snippet left open
        expectKey = false
        i = e
        continue
      }
    }
    if (expectKey) {
      expectKey = false
      const k = key(i)
      if (k) {
        push(spans, i, k[0], "type")
        i = k[1] + 1
        continue
      }
    }

    if (c === '"' || c === "'") {
      const triple = c.repeat(3)
      if (!ini && code.startsWith(triple, i)) {
        const close = code.indexOf(triple, i + 3)
        const e = close === -1 ? n : close + 3
        push(spans, i, e, "string")
        i = e
        continue
      }
      const e = quote(i, c, c === '"')
      if (e !== -1) {
        push(spans, i, e, "string")
        i = e
      } else i++
      continue
    }
    if (!ini) {
      if (c === "[" || c === "{") {
        stack.push(c)
        if (c === "{") expectKey = true
        i++
        continue
      }
      if (c === "]" || c === "}") {
        stack.pop()
        i++
        continue
      }
      if (c === ",") {
        if (stack[stack.length - 1] === "{") expectKey = true
        i++
        continue
      }
    }
    if (isDigit(c) || ((c === "+" || c === "-") && isDigit(code[i + 1]))) {
      const prev = code[i - 1]
      if (!isWord(prev) && prev !== ".") {
        if (isDigit(c)) {
          TOML_DATE.lastIndex = i
          const d = TOML_DATE.exec(code)
          if (d) {
            push(spans, i, i + d[0].length, "number")
            i += d[0].length
            continue
          }
        }
        i = number(code, spans, i, n, TOML_NUMBER)
        continue
      }
    }
    if (isAlpha(c) || c === "_") {
      let e = i + 1
      while (e < n && (isWord(code[e]) || code[e] === "-")) e++
      const word = ini ? code.slice(i, e).toLowerCase() : code.slice(i, e)
      if (word === "true" || word === "false" || (!ini && (word === "inf" || word === "nan"))) {
        push(spans, i, e, "literal")
      }
      i = e
      continue
    }
    i++
  }
  return spans
}

const DOCKER_INSTRUCTIONS = set(
  `from run cmd label maintainer expose env add copy entrypoint volume user workdir arg onbuild
   stopsignal healthcheck shell`,
)

/** Dockerfile: instructions (any case, only where an instruction can start), `AS`, `#` comments, strings, `$VAR`, numbers. */
export function highlightDockerfile(code: string): Span[] {
  const spans: Span[] = []
  const n = code.length
  const quote = quoteScanner(code)
  let continued = false // the previous line ended in `\`
  let instruction = ""

  // `$NAME`, `${NAME}` at `j`: the index past it, or `j` when it is not one.
  const variable = (j: number, end: number): number => {
    const d = code[j + 1]
    if (d === "{") {
      let k = j + 2
      while (k < end && code[k] !== "}" && (isWord(code[k]) || ":-+?=%#/.,@*!^~".includes(code[k]!))) k++
      return k < end && k > j + 2 && code[k] === "}" ? k + 1 : j
    }
    if (isAlpha(d) || d === "_") {
      let k = j + 2
      while (k < end && isWord(code[k])) k++
      return k
    }
    return j
  }

  const rest = (from: number, end: number): void => {
    let j = from
    while (j < end) {
      const c = code[j]!
      if (c === '"' || c === "'") {
        const e = quote(j, c, c === '"')
        if (e !== -1 && e <= end) {
          push(spans, j, e, "string")
          j = e
        } else j++
      } else if (c === "#" && isBoundary(code[j - 1])) {
        push(spans, j, end, "comment")
        return
      } else if (c === "$") {
        const e = variable(j, end)
        if (e > j) push(spans, j, e, "literal")
        j = Math.max(e, j + 1)
      } else if (isDigit(c) && !isWord(code[j - 1])) {
        j = number(code, spans, j, end, PLAIN_NUMBER)
      } else if (isAlpha(c) || c === "_") {
        let e = j + 1
        while (e < end && (isWord(code[e]) || code[e] === "-")) e++
        if (instruction === "from" && e - j === 2 && code.slice(j, e).toLowerCase() === "as") {
          push(spans, j, e, "keyword")
        }
        j = e
      } else j++
    }
  }

  const wordEnd = (from: number, end: number): number => {
    let e = from
    while (e < end && isWord(code[e])) e++
    return e
  }

  let i = 0
  while (i < n) {
    const nl = lineEnd(code, i)
    const end = trimCr(code, i, nl)
    let p = i
    while (p < end && isBlank(code[p])) p++
    if (p < end) {
      if (code[p] === "#") push(spans, p, end, "comment") // a comment line does not end a continuation
      else {
        let q = p
        if (!continued) {
          instruction = ""
          let e = wordEnd(p, end)
          let name = code.slice(p, e).toLowerCase()
          if (DOCKER_INSTRUCTIONS.has(name)) {
            push(spans, p, e, "keyword")
            instruction = name
            q = e
            if (name === "onbuild") {
              let s = e
              while (s < end && isBlank(code[s])) s++
              e = wordEnd(s, end)
              name = code.slice(s, e).toLowerCase()
              if (DOCKER_INSTRUCTIONS.has(name)) {
                push(spans, s, e, "keyword")
                instruction = name
                q = e
              }
            }
          }
        }
        rest(q, end)
        let t = end
        while (t > p && isBlank(code[t - 1])) t--
        continued = code[t - 1] === "\\"
      }
    }
    i = nl + 1
  }
  return spans
}

const MAKE_DIRECTIVES = set(
  `ifeq ifneq ifdef ifndef else endif include -include sinclude define endef export unexport
   override vpath undefine private`,
)
// Directives followed by a variable name or an assignment: `export CC = gcc`, `define BODY`.
const MAKE_NAMING = set("define export unexport override undefine private")
const MAKE_FUNCTIONS = set(
  `subst patsubst strip findstring filter filter-out sort word wordlist words firstword lastword
   dir notdir suffix basename addsuffix addprefix join wildcard realpath abspath error warning info
   shell origin flavor foreach call eval file value if or and let`,
)
const MAKE_SPECIAL = set(
  `.PHONY .SUFFIXES .DEFAULT .PRECIOUS .INTERMEDIATE .NOTINTERMEDIATE .SECONDARY .SECONDEXPANSION
   .DELETE_ON_ERROR .IGNORE .LOW_RESOLUTION_TIME .SILENT .EXPORT_ALL_VARIABLES .NOTPARALLEL
   .ONESHELL .POSIX .DEFAULT_GOAL .RECIPEPREFIX .VARIABLES .FEATURES .INCLUDE_DIRS .SHELLFLAGS .WAIT`,
)

type MakeMode = "text" | "recipe" | "target"

/**
 * Makefile: `#` comments, directives (`ifeq`, `include`, ...), functions inside `$(...)`, variables
 * (`$(CC)`, `${CC}`, `$@`, and the name in `CC := gcc`) as literals, special targets (`.PHONY`)
 * as keywords, other target names as types, and strings and numbers.
 */
export function highlightMakefile(code: string): Span[] {
  const spans: Span[] = []
  const n = code.length
  const quote = quoteScanner(code)

  // A `$` reference at `j`: paints it and returns where to resume.
  const ref = (j: number, to: number): number => {
    const d = code[j + 1]
    if (d === "$") return j + 2 // `$$` is a literal `$` (a shell variable in a recipe)
    if (d === "(" || d === "{") {
      let k = j + 2
      while (k < to && (isWord(code[k]) || code[k] === "-" || code[k] === ".")) k++
      if (k === j + 2) return j + 2
      if (code[k] === (d === "(" ? ")" : "}")) {
        push(spans, j, k + 1, "literal")
        return k + 1
      }
      if (isBlank(code[k]) && MAKE_FUNCTIONS.has(code.slice(j + 2, k))) {
        push(spans, j + 2, k, "keyword")
        return k
      }
      push(spans, j, k, "literal") // `$(SRC:.c=.o)`
      return k
    }
    if (d !== undefined && "@<^?*+|%".includes(d)) {
      push(spans, j, j + 2, "literal")
      return j + 2
    }
    if (isWord(d)) {
      push(spans, j, j + 2, "literal") // `$X` is `$(X)`
      return j + 2
    }
    return j + 1
  }

  const text = (from: number, to: number, mode: MakeMode): void => {
    let j = from
    while (j < to) {
      const c = code[j]!
      if (c === "#" && code[j - 1] !== "\\" && (mode !== "recipe" || isBoundary(code[j - 1]))) {
        push(spans, j, to, "comment")
        return
      }
      if (c === "$") {
        j = ref(j, to)
      } else if (mode === "target") {
        if (isBlank(c)) j++
        else {
          let e = j
          while (e < to && !isBlank(code[e]) && code[e] !== "$" && code[e] !== "#") e++
          push(spans, j, e, MAKE_SPECIAL.has(code.slice(j, e)) ? "keyword" : "type")
          j = Math.max(e, j + 1)
        }
      } else if (c === '"' || c === "'") {
        const e = quote(j, c, c === '"')
        if (e !== -1 && e <= to) {
          push(spans, j, e, "string")
          j = e
        } else j++
      } else if (isDigit(c) && !isWord(code[j - 1])) {
        j = number(code, spans, j, to, PLAIN_NUMBER)
      } else if (isAlpha(c) || c === "_") {
        j++
        while (j < to && isWord(code[j])) j++
      } else j++
    }
  }

  const assignment = (nameStart: number, opStart: number, opEnd: number, end: number): void => {
    let e = opStart
    while (e > nameStart && isBlank(code[e - 1])) e--
    push(spans, nameStart, e, "literal")
    text(opEnd, end, "text")
  }

  // A line that is not a directive or a recipe: `NAME = value`, `target: prerequisites`, or plain text.
  const classify = (from: number, end: number, naming: boolean): void => {
    let s = from
    while (s < end && isBlank(code[s])) s++
    let depth = 0
    for (let j = s; j < end; j++) {
      const c = code[j]!
      if (c === "$" && (code[j + 1] === "(" || code[j + 1] === "{")) {
        depth++
        j++
      } else if (depth > 0) {
        if (c === "(" || c === "{") depth++
        else if (c === ")" || c === "}") depth--
      } else if (c === "#" && isBoundary(code[j - 1])) {
        break
      } else if (c === ":") {
        let k = j + 1
        while (code[k] === ":") k++
        if (code[k] === "=") assignment(s, j, k + 1, end)
        else {
          text(s, j, "target")
          text(k, end, "text")
        }
        return
      } else if (c === "=") {
        const op = j > s && "+?!".includes(code[j - 1]!) ? j - 1 : j
        assignment(s, op, j + 1, end)
        return
      }
    }
    if (naming) {
      let e = s
      while (e < end && !isBlank(code[e]) && code[e] !== "#") e++
      push(spans, s, e, "literal")
      s = e
    }
    text(s, end, "text")
  }

  // A directive word starting at `p`: the index past it, or -1.
  const directive = (p: number, end: number): number => {
    let e = p
    if (code[e] === "-") e++
    while (e < end && isAlpha(code[e])) e++
    if (!MAKE_DIRECTIVES.has(code.slice(p, e))) return -1
    return e === end || isBlank(code[e]) || code[e] === "(" ? e : -1
  }

  const line = (p: number, end: number): void => {
    let q = p
    for (let e = directive(q, end); e !== -1; e = directive(q, end)) {
      const word = code.slice(q, e)
      push(spans, q, e, "keyword")
      let s = e
      while (s < end && isBlank(code[s])) s++
      if (word === "else" && directive(s, end) !== -1) {
        q = s // `else ifeq (...)`
        continue
      }
      if (MAKE_NAMING.has(word)) classify(e, end, true)
      else text(e, end, "text")
      return
    }
    classify(q, end, false)
  }

  let continued = false
  let recipe = false
  let i = 0
  while (i < n) {
    const nl = lineEnd(code, i)
    const end = trimCr(code, i, nl)
    if (continued) text(i, end, recipe ? "recipe" : "text")
    else if (code[i] === "\t") {
      recipe = true
      text(i + 1, end, "recipe")
    } else {
      recipe = false
      let p = i
      while (p < end && isBlank(code[p])) p++
      if (p < end) {
        if (code[p] === "#") push(spans, p, end, "comment")
        else line(p, end)
      }
    }
    continued = end > i && code[end - 1] === "\\"
    i = nl + 1
  }
  return spans
}
