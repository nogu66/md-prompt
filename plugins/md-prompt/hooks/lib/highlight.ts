// Pure syntax highlighter for the body of a fenced code block: source text in, token spans out.
// No `$`, no UI — it only knows how to cut a string into comments / strings / numbers /
// keywords. Deliberately shallow: one linear scan per block, a small table of languages, and a
// safe fallback (strings + numbers only) for anything it does not know, so a wrong guess never
// paints a whole paragraph as a comment.
//
// Most languages are a row of the `LANGS` table read by one generic scanner. The few whose shape
// that cannot express have their own scanner in `highlight-markup.ts` (HTML/XML, Markdown),
// `highlight-css.ts` and `highlight-config.ts` (TOML/INI, Dockerfile, Makefile); `SCANNERS`
// maps names to them. All of them keep the same contract: spans come back ordered, non-empty,
// non-overlapping and inside the text, in linear time, and nothing throws.

import { highlightDockerfile, highlightMakefile, highlightToml } from "./highlight-config"
import { highlightCss } from "./highlight-css"
import { highlightMarkdown, highlightMarkup } from "./highlight-markup"
import { quoteScanner, scanString, set } from "./highlight-util"

export type TokenKind =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "type"
  | "literal"
  | "add"
  | "del"
  | "meta"

/** `[start, end)` in UTF-16 code units of the text that was highlighted. */
export type Span = { start: number; end: number; kind: TokenKind }

type Lang = {
  lineComments: readonly string[]
  blockComment?: readonly [string, string]
  /** quote characters that open a single-line string */
  quotes: string
  /** a backtick opens a string that may run over lines (JS/TS template literals) */
  backtickStrings?: boolean
  /** `"""` / `'''` open a string that may run over lines (Python) */
  tripleQuotes?: boolean
  keywords: ReadonlySet<string>
  literals: ReadonlySet<string>
  caseInsensitive?: boolean
  /** Capitalised identifiers are drawn as types (classes, structs, enums) */
  capitalizedTypes?: boolean
  /** `#` only starts a comment at the start of a line or after whitespace (`$#`, `${#a}`) */
  hashNeedsBoundary?: boolean
  /** Lua: `--[==[ ... ]==]` comments and `[==[ ... ]==]` strings over lines */
  longBrackets?: boolean
}

const JS: Lang = {
  lineComments: ["//"],
  blockComment: ["/*", "*/"],
  quotes: `"'`,
  backtickStrings: true,
  keywords: set(
    `const let var function return if else for while do switch case break continue new class extends
     import export from default async await try catch finally throw typeof instanceof in of void delete
     yield static get set interface type enum implements public private protected readonly as satisfies
     abstract declare namespace module keyof`,
  ),
  literals: set("true false null undefined this super NaN Infinity"),
  capitalizedTypes: true,
}

const PY: Lang = {
  lineComments: ["#"],
  quotes: `"'`,
  tripleQuotes: true,
  keywords: set(
    `def class return if elif else for while in not and or is import from as with try except finally
     raise pass break continue lambda yield global nonlocal assert del async await match case`,
  ),
  literals: set("True False None self cls"),
  capitalizedTypes: true,
}

const SH: Lang = {
  lineComments: ["#"],
  quotes: `"'`,
  hashNeedsBoundary: true,
  keywords: set(
    `if then else elif fi for while do done case esac in function return export local readonly unset
     select until`,
  ),
  literals: set("true false"),
}

const JSON_LANG: Lang = {
  lineComments: ["//"],
  blockComment: ["/*", "*/"],
  quotes: `"`,
  keywords: set(""),
  literals: set("true false null"),
}

const YAML: Lang = {
  lineComments: ["#"],
  quotes: `"'`,
  hashNeedsBoundary: true,
  keywords: set(""),
  literals: set("true false null yes no on off"),
}

const GO: Lang = {
  lineComments: ["//"],
  blockComment: ["/*", "*/"],
  quotes: `"`,
  backtickStrings: true,
  keywords: set(
    `package import func return if else for range switch case default break continue go defer select
     chan map struct interface type var const fallthrough goto`,
  ),
  literals: set("true false nil iota"),
  capitalizedTypes: true,
}

// Rust's `'a` lifetimes collide with char quotes, so single quotes are left alone here.
const RUST: Lang = {
  lineComments: ["//"],
  blockComment: ["/*", "*/"],
  quotes: `"`,
  keywords: set(
    `fn let mut const static struct enum impl trait pub use mod crate match if else for while loop
     return break continue as in where move async await dyn ref unsafe type`,
  ),
  literals: set("true false self Self None Some Ok Err"),
  capitalizedTypes: true,
}

const SWIFT: Lang = {
  lineComments: ["//"],
  blockComment: ["/*", "*/"],
  quotes: `"`,
  keywords: set(
    `func let var class struct enum protocol extension import return if else guard for while in
     switch case default break continue init throws throw try catch defer as is async await actor
     some any where static private public internal fileprivate open override final lazy weak inout
     typealias`,
  ),
  literals: set("true false nil self super"),
  capitalizedTypes: true,
}

const CLIKE: Lang = {
  lineComments: ["//"],
  blockComment: ["/*", "*/"],
  quotes: `"'`,
  keywords: set(
    `if else for while do switch case break continue return class struct enum interface public
     private protected static final void int long float double char bool boolean string new import
     package using namespace const let var fun val typedef template typename virtual override
     extends implements try catch finally throw throws abstract`,
  ),
  literals: set("true false null this nullptr NULL"),
  capitalizedTypes: true,
}

const SQL: Lang = {
  lineComments: ["--"],
  blockComment: ["/*", "*/"],
  quotes: `"'`,
  caseInsensitive: true,
  keywords: set(
    `select from where insert into values update set delete create table alter drop join left right
     inner outer on group by order having limit offset as and or not is in like distinct union all
     primary key foreign references index unique default with case when then else end`,
  ),
  literals: set("null true false"),
}

const RUBY: Lang = {
  lineComments: ["#"],
  quotes: `"'`,
  hashNeedsBoundary: true,
  keywords: set(
    `def end class module if elsif else unless while until do return yield begin rescue ensure
     require include extend attr_accessor case when then for in`,
  ),
  literals: set("true false nil self"),
  capitalizedTypes: true,
}

const LUA: Lang = {
  lineComments: ["--"],
  quotes: `"'`,
  longBrackets: true,
  keywords: set(
    `and break do else elseif end for function goto if in local not or repeat return then until
     while`,
  ),
  literals: set("nil true false"),
}

const HCL: Lang = {
  lineComments: ["#", "//"],
  blockComment: ["/*", "*/"],
  quotes: `"`,
  keywords: set(
    `resource variable output module provider data locals terraform backend required_providers
     dynamic for in if else`,
  ),
  literals: set("true false null"),
}

const POWERSHELL: Lang = {
  lineComments: ["#"],
  blockComment: ["<#", "#>"],
  quotes: `"'`,
  hashNeedsBoundary: true,
  caseInsensitive: true,
  keywords: set(
    `function filter param begin process end if elseif else switch foreach for while do until break
     continue return throw try catch finally trap exit in class enum using`,
  ),
  literals: set("$true $false $null"),
}

const GRAPHQL: Lang = {
  lineComments: ["#"],
  quotes: `"`,
  tripleQuotes: true,
  keywords: set(
    `query mutation subscription fragment on type interface union enum input scalar schema extend
     directive implements repeatable`,
  ),
  literals: set("true false null"),
  capitalizedTypes: true,
}

const ELIXIR: Lang = {
  lineComments: ["#"],
  quotes: `"'`,
  tripleQuotes: true,
  hashNeedsBoundary: true,
  keywords: set(
    `def defp defmodule defmacro defmacrop defstruct defprotocol defimpl defguard do end fn if else
     unless cond case when with for in and or not import alias use require quote unquote raise try
     rescue catch after receive send`,
  ),
  literals: set("true false nil"),
  capitalizedTypes: true,
}

const HASKELL: Lang = {
  lineComments: ["--"],
  blockComment: ["{-", "-}"],
  quotes: `"`,
  keywords: set(
    `module import where let in if then else case of do data type newtype class instance deriving
     infix infixl infixr forall qualified as hiding`,
  ),
  literals: set("True False Nothing"),
  capitalizedTypes: true,
}

const ZIG: Lang = {
  lineComments: ["//"],
  quotes: `"'`,
  keywords: set(
    `const var fn pub return if else while for switch break continue defer errdefer try catch struct
     enum union error test comptime inline extern export usingnamespace orelse and or unreachable
     async await suspend resume packed volatile align anytype opaque noreturn threadlocal`,
  ),
  literals: set("true false null undefined"),
  capitalizedTypes: true,
}

const R: Lang = {
  lineComments: ["#"],
  quotes: `"'`,
  keywords: set("function if else for while repeat break next return in"),
  literals: set("TRUE FALSE NULL NA NA_integer_ NA_real_ NA_character_ Inf NaN"),
}

const PERL: Lang = {
  lineComments: ["#"],
  quotes: `"'`,
  hashNeedsBoundary: true,
  keywords: set(
    `my our local sub if elsif else unless while until for foreach do return last next redo use no
     package require and or not eq ne lt gt le ge cmp print say die warn defined undef`,
  ),
  literals: set(""),
}

const NGINX: Lang = {
  lineComments: ["#"],
  quotes: `"'`,
  hashNeedsBoundary: true,
  keywords: set(
    `server location upstream events stream map types include listen server_name root try_files
     proxy_pass return rewrite set if error_page access_log error_log ssl_certificate
     ssl_certificate_key fastcgi_pass add_header gzip worker_processes worker_connections user pid
     default_type`,
  ),
  literals: set("on off"),
}

const PROTO: Lang = {
  lineComments: ["//"],
  blockComment: ["/*", "*/"],
  quotes: `"'`,
  keywords: set(
    `syntax package import option message enum service rpc returns stream oneof map repeated
     optional required reserved extensions extend group public weak to max string int32 int64
     uint32 uint64 sint32 sint64 fixed32 fixed64 sfixed32 sfixed64 float double bool bytes`,
  ),
  literals: set("true false"),
  capitalizedTypes: true,
}

// Anything unlabelled or unknown: quoted strings and numbers only.
const PLAIN: Lang = {
  lineComments: [],
  quotes: `"`,
  keywords: set(""),
  literals: set(""),
}

const LANGS: Record<string, Lang> = {
  js: JS, jsx: JS, javascript: JS, mjs: JS, cjs: JS, ts: JS, tsx: JS, typescript: JS, mts: JS, cts: JS,
  py: PY, python: PY,
  sh: SH, bash: SH, zsh: SH, shell: SH, console: SH,
  json: JSON_LANG, jsonc: JSON_LANG, json5: JSON_LANG,
  yaml: YAML, yml: YAML,
  go: GO, golang: GO,
  rust: RUST, rs: RUST,
  swift: SWIFT,
  java: CLIKE, kotlin: CLIKE, kt: CLIKE, kts: CLIKE, c: CLIKE, h: CLIKE, cpp: CLIKE, "c++": CLIKE,
  cc: CLIKE, cxx: CLIKE, hpp: CLIKE, hh: CLIKE,
  cs: CLIKE, csharp: CLIKE, php: CLIKE, dart: CLIKE, scala: CLIKE,
  "objective-c": CLIKE, objc: CLIKE, m: CLIKE, groovy: CLIKE, gradle: CLIKE,
  sql: SQL,
  ruby: RUBY, rb: RUBY,
  lua: LUA,
  hcl: HCL, terraform: HCL, tf: HCL,
  powershell: POWERSHELL, ps1: POWERSHELL, pwsh: POWERSHELL,
  graphql: GRAPHQL, gql: GRAPHQL,
  elixir: ELIXIR, ex: ELIXIR, exs: ELIXIR,
  haskell: HASKELL, hs: HASKELL,
  zig: ZIG,
  r: R,
  perl: PERL,
  nginx: NGINX,
  proto: PROTO, protobuf: PROTO,
  // stated as plain on purpose: text stays text, and `csv` gets no comment or keyword rules
  text: PLAIN, txt: PLAIN, plain: PLAIN, plaintext: PLAIN, csv: PLAIN,
}

// Languages with a scanner of their own (see the header comment).
const SCANNERS: Record<string, (code: string) => Span[]> = {
  html: highlightMarkup, htm: highlightMarkup, vue: highlightMarkup, svelte: highlightMarkup,
  xml: highlightMarkup, svg: highlightMarkup, xhtml: highlightMarkup, plist: highlightMarkup,
  xsd: highlightMarkup, xsl: highlightMarkup, xslt: highlightMarkup, rss: highlightMarkup,
  atom: highlightMarkup, wsdl: highlightMarkup, xaml: highlightMarkup,
  css: (code) => highlightCss(code, "css"),
  scss: (code) => highlightCss(code, "scss"),
  less: (code) => highlightCss(code, "less"),
  markdown: highlightMarkdown, md: highlightMarkdown, mkd: highlightMarkdown,
  dockerfile: highlightDockerfile, docker: highlightDockerfile, containerfile: highlightDockerfile,
  makefile: highlightMakefile, make: highlightMakefile, mk: highlightMakefile,
  toml: (code) => highlightToml(code, false),
  ini: (code) => highlightToml(code, true), cfg: (code) => highlightToml(code, true),
  properties: (code) => highlightToml(code, true), dotenv: (code) => highlightToml(code, true),
}

/** An own entry of a language table: `constructor` and `__proto__` are not languages. */
function own<T>(table: Record<string, T>, name: string | null): T | undefined {
  return name !== null && Object.prototype.hasOwnProperty.call(table, name) ? table[name] : undefined
}

/** The highlighter language an info string names (`ts`, `python title="x"`), or null. */
export function languageOf(info: string): string | null {
  const first = info.trim().split(/[\s{]/)[0]?.toLowerCase().replace(/^\./, "") ?? ""
  return first === "" ? null : first
}

const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c)
const isDigit = (c: string) => c >= "0" && c <= "9"

const NUMBER = /0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/y

/** Cut `code` into highlighted spans; everything not returned is plain text. */
export function highlightCode(code: string, language: string | null): Span[] {
  if (language === "diff" || language === "patch") return highlightDiff(code)
  const scanner = own(SCANNERS, language)
  if (scanner) return scanner(code)
  const lang = own(LANGS, language) ?? PLAIN
  const spans: Span[] = []
  const n = code.length
  const quote = quoteScanner(code) // remembers a quote that never closed, so a line of them is scanned once
  let i = 0

  while (i < n) {
    const c = code[i]!

    // Lua long brackets: `--[==[ ... ]==]` is a comment, `[==[ ... ]==]` a string; unclosed ones run to the end
    if (lang.longBrackets && (c === "[" || (c === "-" && code[i + 1] === "-"))) {
      const isComment = c === "-"
      const open = isComment ? i + 2 : i
      const level = code[open] === "[" ? longBracketLevel(code, open) : -1
      if (level !== -1) {
        const closer = "]" + "=".repeat(level) + "]"
        const close = code.indexOf(closer, open + level + 2)
        const end = close === -1 ? n : close + closer.length
        spans.push({ start: i, end, kind: isComment ? "comment" : "string" })
        i = end
        continue
      }
    }

    // comments
    if (lang.blockComment && code.startsWith(lang.blockComment[0], i)) {
      const close = code.indexOf(lang.blockComment[1], i + lang.blockComment[0].length)
      const end = close === -1 ? n : close + lang.blockComment[1].length
      spans.push({ start: i, end, kind: "comment" })
      i = end
      continue
    }
    let lineComment = false
    for (const m of lang.lineComments) {
      if (code.startsWith(m, i) && (!lang.hashNeedsBoundary || m !== "#" || i === 0 || /\s/.test(code[i - 1]!))) {
        lineComment = true
        break
      }
    }
    if (lineComment) {
      const nl = code.indexOf("\n", i)
      const end = nl === -1 ? n : nl
      spans.push({ start: i, end, kind: "comment" })
      i = end
      continue
    }

    // strings
    if (lang.tripleQuotes && (code.startsWith('"""', i) || code.startsWith("'''", i))) {
      const q = code.slice(i, i + 3)
      const close = code.indexOf(q, i + 3)
      const end = close === -1 ? n : close + 3
      spans.push({ start: i, end, kind: "string" })
      i = end
      continue
    }
    if (c === "`" && lang.backtickStrings) {
      const end = scanString(code, i, "`", true)
      spans.push({ start: i, end: end === -1 ? n : end, kind: "string" })
      i = end === -1 ? n : end
      continue
    }
    if (lang.quotes.includes(c)) {
      const end = quote(i, c)
      if (end !== -1) {
        spans.push({ start: i, end, kind: "string" })
        i = end
        continue
      }
      i++ // an unmatched quote (an apostrophe) is just a character
      continue
    }

    // numbers
    if (isDigit(c) && (i === 0 || !isIdentPart(code[i - 1]!))) {
      NUMBER.lastIndex = i
      const m = NUMBER.exec(code)
      if (m) {
        spans.push({ start: i, end: i + m[0].length, kind: "number" })
        i += m[0].length
        continue
      }
    }

    // words
    if (isIdentStart(c)) {
      let j = i + 1
      while (j < n && isIdentPart(code[j]!)) j++
      const word = code.slice(i, j)
      const key = lang.caseInsensitive ? word.toLowerCase() : word
      if (lang.keywords.has(key)) spans.push({ start: i, end: j, kind: "keyword" })
      else if (lang.literals.has(key)) spans.push({ start: i, end: j, kind: "literal" })
      else if (lang.capitalizedTypes && c >= "A" && c <= "Z" && word.length > 1 && /[a-z]/.test(word)) {
        spans.push({ start: i, end: j, kind: "type" })
      }
      i = j
      continue
    }

    i++
  }
  return spans
}

/** The number of `=` in a Lua long bracket opening at `open` (`[==[` is 2), or -1 when there is none. */
function longBracketLevel(code: string, open: number): number {
  let j = open + 1
  while (code[j] === "=") j++
  return code[j] === "[" ? j - open - 1 : -1
}

function highlightDiff(code: string): Span[] {
  const spans: Span[] = []
  let offset = 0
  for (const line of code.split("\n")) {
    const end = offset + line.length
    if (end > offset) {
      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@") || line.startsWith("diff ")) {
        spans.push({ start: offset, end, kind: "meta" })
      } else if (line.startsWith("+")) spans.push({ start: offset, end, kind: "add" })
      else if (line.startsWith("-")) spans.push({ start: offset, end, kind: "del" })
    }
    offset = end + 1
  }
  return spans
}
