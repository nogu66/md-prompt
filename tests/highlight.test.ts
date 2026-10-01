import { describe, expect, test } from "bun:test"
import { highlightCode, languageOf, type TokenKind } from "../plugins/md-prompt/hooks/lib/highlight"

/** `[kind, text]` pairs, in order — easier to read than offsets. */
function tokens(code: string, lang: string | null): [TokenKind, string][] {
  return highlightCode(code, lang).map((s) => [s.kind, code.slice(s.start, s.end)])
}

describe("languageOf", () => {
  test("reads the first word of an info string, lowercased", () => {
    expect(languageOf("ts")).toBe("ts")
    expect(languageOf("  TypeScript ")).toBe("typescript")
    expect(languageOf("python title=\"x.py\"")).toBe("python")
    expect(languageOf(".py")).toBe("py")
    expect(languageOf("js {1,3}")).toBe("js")
  })

  test("nothing usable is null", () => {
    expect(languageOf("")).toBeNull()
    expect(languageOf("   ")).toBeNull()
    expect(languageOf("{.ts}")).toBeNull()
  })
})

describe("highlightCode: TypeScript / JavaScript", () => {
  test("keywords, strings, numbers, literals, comments", () => {
    expect(tokens('const x = "a" + 42 // note', "ts")).toEqual([
      ["keyword", "const"],
      ["string", '"a"'],
      ["number", "42"],
      ["comment", "// note"],
    ])
  })

  test("literals and capitalised names as types", () => {
    expect(tokens("return new Map(null)", "js")).toEqual([
      ["keyword", "return"],
      ["keyword", "new"],
      ["type", "Map"],
      ["literal", "null"],
    ])
  })

  test("an escaped quote does not end the string", () => {
    expect(tokens('"a\\"b" x', "ts")).toEqual([["string", '"a\\"b"']])
  })

  test("template literals run over lines; unclosed ones run to the end", () => {
    expect(tokens("`a\nb` x", "ts")).toEqual([["string", "`a\nb`"]])
    expect(tokens("let s = `open\nmore", "ts")).toEqual([
      ["keyword", "let"],
      ["string", "`open\nmore"],
    ])
  })

  test("block comments span lines; unclosed ones run to the end", () => {
    expect(tokens("/* a\nb */ x", "ts")).toEqual([["comment", "/* a\nb */"]])
    expect(tokens("/* open", "ts")).toEqual([["comment", "/* open"]])
  })

  test("identifiers holding a digit or keyword are not split", () => {
    expect(tokens("x1 = constant", "ts")).toEqual([])
  })

  test("hex, decimals and exponents are one number", () => {
    expect(tokens("0xFF 3.14 1e-9 1_000", "ts").map(([, t]) => t)).toEqual(["0xFF", "3.14", "1e-9", "1_000"])
  })
})

describe("highlightCode: Python and shell", () => {
  test("python: # comment, triple-quoted docstring, keywords, self", () => {
    const code = 'def f(self):\n    """doc\n    more"""\n    return None  # done'
    expect(tokens(code, "py")).toEqual([
      ["keyword", "def"],
      ["literal", "self"],
      ["string", '"""doc\n    more"""'],
      ["keyword", "return"],
      ["literal", "None"],
      ["comment", "# done"],
    ])
  })

  test("shell: # starts a comment only at a word boundary", () => {
    expect(tokens("echo ${#arr[@]} $#", "sh")).toEqual([])
    expect(tokens("# top\necho a # tail", "bash")).toEqual([
      ["comment", "# top"],
      ["comment", "# tail"],
    ])
  })

  test("shell keywords", () => {
    expect(tokens("if true; then\nfi", "zsh")).toEqual([
      ["keyword", "if"],
      ["literal", "true"],
      ["keyword", "then"],
      ["keyword", "fi"],
    ])
  })
})

describe("highlightCode: other languages", () => {
  test("json: keys/values are strings, plus numbers and literals", () => {
    expect(tokens('{"a": [1, true, null]}', "json")).toEqual([
      ["string", '"a"'],
      ["number", "1"],
      ["literal", "true"],
      ["literal", "null"],
    ])
  })

  test("sql keywords match in any case", () => {
    expect(tokens("SELECT a FROM t -- c", "sql")).toEqual([
      ["keyword", "SELECT"],
      ["keyword", "FROM"],
      ["comment", "-- c"],
    ])
  })

  test("rust: a lifetime tick is not a string", () => {
    expect(tokens("fn f<'a>(x: &'a str) {}", "rust")).toEqual([["keyword", "fn"]])
  })

  test("swift and go have their keywords", () => {
    expect(tokens("func run() {}", "swift")).toEqual([["keyword", "func"]])
    expect(tokens("package main", "go")).toEqual([["keyword", "package"]])
  })

  test("an unknown or missing language gets strings and numbers only", () => {
    expect(tokens('a "b" 3 // not a comment', null)).toEqual([
      ["string", '"b"'],
      ["number", "3"],
    ])
    expect(tokens("x", "brainfuck")).toEqual([])
  })

  test("an apostrophe with no partner is not a string", () => {
    expect(tokens("it's fine", "ts")).toEqual([])
    expect(tokens("don't panic", null)).toEqual([])
  })
})

describe("highlightCode: diff", () => {
  test("added, removed and header lines", () => {
    const code = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n same"
    expect(tokens(code, "diff")).toEqual([
      ["meta", "--- a/x"],
      ["meta", "+++ b/x"],
      ["meta", "@@ -1 +1 @@"],
      ["del", "-old"],
      ["add", "+new"],
    ])
  })
})

describe("highlightCode: robustness", () => {
  test("empty input", () => {
    expect(highlightCode("", "ts")).toEqual([])
  })

  test("spans are ordered, non-overlapping and inside the text", () => {
    const code = 'const a = `x${"y"}` /* c */ // d\nlet 0x1 = "z"'
    const spans = highlightCode(code, "ts")
    let last = 0
    for (const s of spans) {
      expect(s.start).toBeGreaterThanOrEqual(last)
      expect(s.end).toBeGreaterThan(s.start)
      expect(s.end).toBeLessThanOrEqual(code.length)
      last = s.end
    }
  })

  test("a big block scans in linear time", () => {
    const code = 'const a = "b" // c\n'.repeat(3000)
    const t = performance.now()
    highlightCode(code, "ts")
    expect(performance.now() - t).toBeLessThan(500)
  })
})

describe("highlightCode: HTML / XML", () => {
  test("tag names, attribute names and values, entities", () => {
    expect(tokens('<a href="x" hidden>t &amp; u</a>', "html")).toEqual([
      ["keyword", "a"],
      ["type", "href"],
      ["string", '"x"'],
      ["type", "hidden"],
      ["literal", "&amp;"],
      ["keyword", "a"],
    ])
    expect(tokens("<input value=x data-n='1'/>", "htm")).toEqual([
      ["keyword", "input"],
      ["type", "value"],
      ["string", "x"],
      ["type", "data-n"],
      ["string", "'1'"],
    ])
  })

  test("comments span lines; an unclosed one runs to the end; doctype is meta", () => {
    expect(tokens("<!-- a\nb --><br/>", "html")).toEqual([
      ["comment", "<!-- a\nb -->"],
      ["keyword", "br"],
    ])
    expect(tokens("<!-- open <b>", "html")).toEqual([["comment", "<!-- open <b>"]])
    expect(tokens("<!DOCTYPE html>", "html")).toEqual([["meta", "<!DOCTYPE html>"]])
  })

  test("a `<` that is a comparison is not a tag", () => {
    expect(tokens("if a < b && c > d, x<1, y <= 2", "html")).toEqual([])
    expect(tokens("a <b and no closing bracket", "html")).toEqual([])
    expect(tokens("&amp and 1 < 2 & 3", "html")).toEqual([])
  })

  test("the body of <script> and <style> is not scanned for tags", () => {
    expect(tokens("<script>if (a<b) { x = '<i>' }</script>", "html")).toEqual([
      ["keyword", "script"],
      ["keyword", "script"],
    ])
    expect(tokens("<style>a<b{}</STYLE><p>", "html")).toEqual([
      ["keyword", "style"],
      ["keyword", "STYLE"],
      ["keyword", "p"],
    ])
  })

  test("xml: declaration, namespaces, CDATA; svg, plist, vue and svelte share the scanner", () => {
    expect(tokens('<?xml version="1.0"?><svg xlink:href="#a"><![CDATA[ x<y ]]></svg>', "xml")).toEqual([
      ["meta", '<?xml version="1.0"?>'],
      ["keyword", "svg"],
      ["type", "xlink:href"],
      ["string", '"#a"'],
      ["string", "<![CDATA[ x<y ]]>"],
      ["keyword", "svg"],
    ])
    for (const lang of ["svg", "xhtml", "plist", "xsd", "vue", "svelte"]) {
      expect(tokens('<a :b="1" @c="2"/>', lang)).toEqual([
        ["keyword", "a"],
        ["type", ":b"],
        ["string", '"1"'],
        ["type", "@c"],
        ["string", '"2"'],
      ])
    }
  })
})

describe("highlightCode: CSS / SCSS / Less", () => {
  test("selectors, properties, colours and numbers with units", () => {
    expect(tokens(".a:hover, #b { color: #ff00aa; margin: -1.5em 10px 0 .5rem }", "css")).toEqual([
      ["type", ".a"],
      ["literal", ":hover"],
      ["type", "#b"],
      ["type", "color"],
      ["number", "#ff00aa"],
      ["type", "margin"],
      ["number", "-1.5em"],
      ["number", "10px"],
      ["number", "0"],
      ["number", ".5rem"],
    ])
  })

  test("comments, strings, url() and !important", () => {
    expect(tokens('/* c */ a { content: "x;y"; background: url(a.png) !important }', "css")).toEqual([
      ["comment", "/* c */"],
      ["keyword", "a"],
      ["type", "content"],
      ["string", '"x;y"'],
      ["type", "background"],
      ["string", "a.png"],
      ["keyword", "!important"],
    ])
    expect(tokens("a { b: c /* open", "css")).toEqual([
      ["keyword", "a"],
      ["type", "b"],
      ["comment", "/* open"],
    ])
  })

  test("at-rules are keywords, and their prelude is read as a value", () => {
    expect(tokens("@media (min-width: 600px) and (max-width: 900px) { }", "css")).toEqual([
      ["keyword", "@media"],
      ["number", "600px"],
      ["keyword", "and"],
      ["number", "900px"],
    ])
    expect(tokens('@import url(//x.com/a.css); @charset "utf-8";', "css")).toEqual([
      ["keyword", "@import"],
      ["string", "//x.com/a.css"],
      ["keyword", "@charset"],
      ["string", '"utf-8"'],
    ])
  })

  test("`//` is a comment in scss and less only", () => {
    expect(tokens("// x", "css")).toEqual([])
    expect(tokens("// x\na { b: c } // y", "scss")).toEqual([
      ["comment", "// x"],
      ["keyword", "a"],
      ["type", "b"],
      ["comment", "// y"],
    ])
    expect(tokens("a { b: url(http://x.com/y) }", "scss")).toEqual([
      ["keyword", "a"],
      ["type", "b"],
      ["string", "http://x.com/y"],
    ])
  })

  test("scss: $variables, nesting, interpolation, @include", () => {
    expect(tokens("$v: 10px;\n.a { &:hover { color: $v } &-b { @include m($x: 1px); w: #{$v} } }", "scss")).toEqual([
      ["literal", "$v"],
      ["number", "10px"],
      ["type", ".a"],
      ["literal", ":hover"],
      ["type", "color"],
      ["literal", "$v"],
      ["keyword", "@include"],
      ["literal", "$x"],
      ["number", "1px"],
      ["type", "w"],
      ["literal", "$v"],
    ])
  })

  test("less: @variables are literals, real at-rules are keywords", () => {
    expect(tokens("@c: #fff;\n.b { color: @c; @media (min-width: @w) { x: 1 } }", "less")).toEqual([
      ["literal", "@c"],
      ["number", "#fff"],
      ["type", ".b"],
      ["type", "color"],
      ["literal", "@c"],
      ["keyword", "@media"],
      ["literal", "@w"],
      ["type", "x"],
      ["number", "1"],
    ])
  })

  test("ordinary text is not painted", () => {
    expect(tokens("hello world, this isn't a stylesheet.", "css")).toEqual([])
    expect(tokens("plain words: nothing here", "scss")).toEqual([]) // a property name is one word
    expect(tokens("width: 3", "scss")).toEqual([
      ["type", "width"],
      ["number", "3"],
    ])
  })
})

describe("highlightCode: Markdown", () => {
  test("headings, list markers, quotes, fences", () => {
    const code = "# Title\n- one\n  * two\n1. three\n> q\n```js\n# not a heading\nconst a = 1\n```\n---"
    expect(tokens(code, "markdown")).toEqual([
      ["keyword", "# Title"],
      ["meta", "-"],
      ["meta", "*"],
      ["meta", "1."],
      ["meta", ">"],
      ["meta", "```js"],
      ["meta", "```"],
      ["meta", "---"],
    ])
  })

  test("inline code and link urls; `#` without a space is not a heading", () => {
    expect(tokens('see `a b` and [t](http://x.com "n") #tag ####### x', "md")).toEqual([
      ["string", "`a b`"],
      ["string", "http://x.com"],
    ])
  })

  test("HTML comments run over lines; inline code protects its content", () => {
    expect(tokens("a <!-- x\ny --> `b` <!-- open", "md")).toEqual([
      ["comment", "<!-- x\ny -->"],
      ["string", "`b`"],
      ["comment", "<!-- open"],
    ])
    expect(tokens("`<!-- not a comment -->`", "md")).toEqual([["string", "`<!-- not a comment -->`"]])
  })

  test("a longer fence is closed only by an equal or longer one", () => {
    expect(tokens("````md\n```\n# in\n```\n````\n# out", "markdown")).toEqual([
      ["meta", "````md"],
      ["meta", "````"],
      ["keyword", "# out"],
    ])
  })
})

describe("highlightCode: Dockerfile", () => {
  test("instructions in any case, AS, numbers, strings, variables, comments", () => {
    expect(tokens('FROM node:20 AS b\nrun echo hi # c\nENV A="x" B=$HOME C=${D:-e}', "dockerfile")).toEqual([
      ["keyword", "FROM"],
      ["number", "20"],
      ["keyword", "AS"],
      ["keyword", "run"],
      ["comment", "# c"],
      ["keyword", "ENV"],
      ["string", '"x"'],
      ["literal", "$HOME"],
      ["literal", "${D:-e}"],
    ])
  })

  test("instruction words are keywords only where an instruction can start", () => {
    expect(tokens("RUN add copy user from", "docker")).toEqual([["keyword", "RUN"]])
    expect(tokens("RUN a \\\n  && COPY b\n# FROM x\nUSER app", "dockerfile")).toEqual([
      ["keyword", "RUN"],
      ["comment", "# FROM x"],
      ["keyword", "USER"],
    ])
    expect(tokens("ONBUILD RUN echo a#b", "containerfile")).toEqual([
      ["keyword", "ONBUILD"],
      ["keyword", "RUN"],
    ])
  })
})

describe("highlightCode: Makefile", () => {
  test("variables, special and ordinary targets, recipes, comments", () => {
    expect(tokens("CC := gcc\n.PHONY: all\nall: $(OBJ)\n\t@echo $@ # c\n\t$(CC) -o x -j4", "makefile")).toEqual([
      ["literal", "CC"],
      ["keyword", ".PHONY"],
      ["type", "all"],
      ["literal", "$(OBJ)"],
      ["literal", "$@"],
      ["comment", "# c"],
      ["literal", "$(CC)"],
    ])
  })

  test("directives, functions and assignments", () => {
    expect(tokens("ifeq ($(A),b)\nX += 1\nelse ifdef Y\nendif\ninclude a.mk\nB = $(shell ls)", "make")).toEqual([
      ["keyword", "ifeq"],
      ["literal", "$(A)"],
      ["literal", "X"],
      ["number", "1"],
      ["keyword", "else"],
      ["keyword", "ifdef"],
      ["keyword", "endif"],
      ["keyword", "include"],
      ["literal", "B"],
      ["keyword", "shell"],
    ])
  })

  test("`$$` is not a make variable, and a recipe `#` needs a blank before it", () => {
    expect(tokens("\techo $$HOME a#b", "mk")).toEqual([])
    expect(tokens("a:\n\tls # x\n\tcat \"a b\"", "mk")).toEqual([
      ["type", "a"],
      ["comment", "# x"],
      ["string", '"a b"'],
    ])
  })
})

describe("highlightCode: Lua", () => {
  test("keywords, literals, strings, comments", () => {
    expect(tokens("if x then return nil end -- c", "lua")).toEqual([
      ["keyword", "if"],
      ["keyword", "then"],
      ["keyword", "return"],
      ["literal", "nil"],
      ["keyword", "end"],
      ["comment", "-- c"],
    ])
    expect(tokens("local s = 'a' .. \"b\" .. 0x1F", "lua")).toEqual([
      ["keyword", "local"],
      ["string", "'a'"],
      ["string", '"b"'],
      ["number", "0x1F"],
    ])
  })

  test("long brackets: comments and strings over lines, at any level", () => {
    expect(tokens("a --[[ b\nc ]] + 1", "lua")).toEqual([
      ["comment", "--[[ b\nc ]]"],
      ["number", "1"],
    ])
    expect(tokens("s = [==[ a ]] b ]==] x", "lua")).toEqual([["string", "[==[ a ]] b ]==]"]])
    expect(tokens("--[=[ open\nmore", "lua")).toEqual([["comment", "--[=[ open\nmore"]])
  })

  test("`--[ x` is a line comment, and indexing is not a bracket string", () => {
    expect(tokens("--[ x\ny", "lua")).toEqual([["comment", "--[ x"]])
    expect(tokens("a[b[1]] = t[=x]", "lua")).toEqual([["number", "1"]])
  })
})

describe("highlightCode: TOML / INI", () => {
  test("toml: headers, keys, strings, numbers, dates, literals, comments", () => {
    expect(tokens('[owner]\nname = "Tom" # c\nn = 1_000\nd = 1979-05-27\nok = true\nf = -3.5e2', "toml")).toEqual([
      ["meta", "[owner]"],
      ["type", "name"],
      ["string", '"Tom"'],
      ["comment", "# c"],
      ["type", "n"],
      ["number", "1_000"],
      ["type", "d"],
      ["number", "1979-05-27"],
      ["type", "ok"],
      ["literal", "true"],
      ["type", "f"],
      ["number", "-3.5e2"],
    ])
    expect(tokens("[[products]]\nname = 'x'\nt = 07:32:00", "toml")).toEqual([
      ["meta", "[[products]]"],
      ["type", "name"],
      ["string", "'x'"],
      ["type", "t"],
      ["number", "07:32:00"],
    ])
  })

  test("toml: multi-line strings and arrays, inline tables, arrays of arrays", () => {
    expect(tokens('ml = """a # b\nc"""\nps = [\n  1,\n  2 ]\nt = { a = 1, "b c" = true }', "toml")).toEqual([
      ["type", "ml"],
      ["string", '"""a # b\nc"""'],
      ["type", "ps"],
      ["number", "1"],
      ["number", "2"],
      ["type", "t"],
      ["type", "a"],
      ["number", "1"],
      ["type", '"b c"'],
      ["literal", "true"],
    ])
    expect(tokens("a = [\n[1, 2],\n]\n[s]", "toml")).toEqual([
      ["type", "a"],
      ["number", "1"],
      ["number", "2"],
      ["meta", "[s]"],
    ])
  })

  test("ini: `;` and `#` comments start at a blank, `key: value`, urls are not keys", () => {
    expect(tokens("; c\n[a b]\nk = v ; t\nu = http://x/#f\nn: 4\nb = True", "ini")).toEqual([
      ["comment", "; c"],
      ["meta", "[a b]"],
      ["type", "k"],
      ["comment", "; t"],
      ["type", "u"],
      ["type", "n"],
      ["number", "4"],
      ["type", "b"],
      ["literal", "True"],
    ])
    expect(tokens("http://x.com/a", "ini")).toEqual([])
  })

  test("yaml and yml keep their own rules", () => {
    for (const lang of ["yaml", "yml"]) {
      expect(tokens("a: yes # c\nb: 'x'", lang)).toEqual([
        ["literal", "yes"],
        ["comment", "# c"],
        ["string", "'x'"],
      ])
    }
  })
})

describe("highlightCode: more languages", () => {
  test("hcl / terraform", () => {
    expect(tokens('# c\nresource "a" "b" { count = 3 // t\n on = true }', "terraform")).toEqual([
      ["comment", "# c"],
      ["keyword", "resource"],
      ["string", '"a"'],
      ["string", '"b"'],
      ["number", "3"],
      ["comment", "// t"],
      ["literal", "true"],
    ])
  })

  test("powershell: case-insensitive keywords, $true, <# #> comments", () => {
    expect(tokens("<# b #> Function F { if ($x -eq $TRUE) { 'a' } } # c", "ps1")).toEqual([
      ["comment", "<# b #>"],
      ["keyword", "Function"],
      ["keyword", "if"],
      ["literal", "$TRUE"],
      ["string", "'a'"],
      ["comment", "# c"],
    ])
  })

  test("graphql: keywords, capitalised types, block strings", () => {
    expect(tokens('# c\ntype User implements Node { id: ID! name: String @d(a: "x") }\nquery Q { a }', "gql")).toEqual([
      ["comment", "# c"],
      ["keyword", "type"],
      ["type", "User"],
      ["keyword", "implements"],
      ["type", "Node"],
      ["type", "String"],
      ["string", '"x"'],
      ["keyword", "query"],
    ])
  })

  test("elixir, haskell, zig, r, perl", () => {
    expect(tokens('def f(x) when x > 1, do: nil # c', "ex")).toEqual([
      ["keyword", "def"],
      ["keyword", "when"],
      ["number", "1"],
      ["keyword", "do"],
      ["literal", "nil"],
      ["comment", "# c"],
    ])
    expect(tokens("{- b -} module Main where -- c\nx = True", "hs")).toEqual([
      ["comment", "{- b -}"],
      ["keyword", "module"],
      ["type", "Main"],
      ["keyword", "where"],
      ["comment", "-- c"],
      ["literal", "True"],
    ])
    expect(tokens('pub fn main() void { const s = "a"; // c\n}', "zig")).toEqual([
      ["keyword", "pub"],
      ["keyword", "fn"],
      ["keyword", "const"],
      ["string", '"a"'],
      ["comment", "// c"],
    ])
    expect(tokens("f <- function(x) if (x) TRUE else NULL # c", "r")).toEqual([
      ["keyword", "function"],
      ["keyword", "if"],
      ["literal", "TRUE"],
      ["keyword", "else"],
      ["literal", "NULL"],
      ["comment", "# c"],
    ])
    expect(tokens('my $n = $#a; # c\nprint "x";', "perl")).toEqual([
      ["keyword", "my"],
      ["comment", "# c"],
      ["keyword", "print"],
      ["string", '"x"'],
    ])
  })

  test("nginx and protobuf", () => {
    expect(tokens("server { listen 8080; proxy_pass http://x; gzip on; # c\n}", "nginx")).toEqual([
      ["keyword", "server"],
      ["keyword", "listen"],
      ["number", "8080"],
      ["keyword", "proxy_pass"],
      ["keyword", "gzip"],
      ["literal", "on"],
      ["comment", "# c"],
    ])
    expect(tokens('syntax = "proto3"; // c\nmessage Foo { repeated string a = 1; }', "protobuf")).toEqual([
      ["keyword", "syntax"],
      ["string", '"proto3"'],
      ["comment", "// c"],
      ["keyword", "message"],
      ["type", "Foo"],
      ["keyword", "repeated"],
      ["keyword", "string"],
      ["number", "1"],
    ])
  })

  test("aliases of existing scanners", () => {
    expect(tokens("class Foo {}", "groovy")).toEqual([
      ["keyword", "class"],
      ["type", "Foo"],
    ])
    expect(tokens("void f() {} // c", "objective-c")).toEqual([
      ["keyword", "void"],
      ["comment", "// c"],
    ])
    expect(tokens("const a: number = 1", "mts")).toEqual([
      ["keyword", "const"],
      ["number", "1"],
    ])
  })

  test("text, plain and csv are stated as plain: strings and numbers only", () => {
    for (const lang of ["text", "txt", "plain", "plaintext", "csv"]) {
      expect(tokens('a // b # c "d" 1', lang)).toEqual([
        ["string", '"d"'],
        ["number", "1"],
      ])
    }
  })

  test("a name that is a property of Object.prototype is not a language", () => {
    for (const lang of ["constructor", "__proto__", "hasownproperty", "tostring", "valueof"]) {
      expect(tokens('a "b" 3', lang)).toEqual([
        ["string", '"b"'],
        ["number", "3"],
      ])
    }
  })
})

/** Every name `highlightCode` gives a dedicated scanner or table row, plus a few it does not know. */
const NEW_LANGUAGES = [
  "html", "vue", "svg", "xml", "css", "scss", "less", "markdown", "md", "dockerfile", "makefile",
  "lua", "toml", "ini", "powershell", "graphql", "hcl", "elixir", "haskell", "zig", "r", "perl",
  "nginx", "proto", "text", "csv", "unknown",
]
const EXISTING_LANGUAGES = ["ts", "py", "sh", "sql", "json", "yaml", "go", "rust", "ruby", "diff"]

/**
 * Milliseconds of CPU time for the fastest of up to three runs. CPU time, not the wall clock:
 * a busy machine that starves this process for a second is not a quadratic scan.
 */
function bestMs(code: string, lang: string): number {
  let best = Infinity
  for (let run = 0; run < 3 && best >= 100; run++) {
    const wall = performance.now()
    const cpu = process.cpuUsage()
    highlightCode(code, lang)
    const used = process.cpuUsage(cpu)
    best = Math.min(best, (used.user + used.system) / 1000, performance.now() - wall)
  }
  return best
}

/** Small structural samples for the random-text tests: each is a token some scanner reacts to. */
const PIECES = [
  "<", "<!--", "-->", "<a ", "</a>", "/>", ">", '"', "'", "`", "=", "&amp;", "&", "#", "# ", "//", "/*",
  "*/", "--", "--[[", "]]", "[[", "[=[", "]=]", "[", "]", "{", "}", "(", ")", "@", "$", "$(", "${", "#{",
  ":", ";", ",", ".", "\\", "\n", "\r\n", "\t", " ", "- ", "1. ", "> ", "```", "~~~", "---", "key",
  "Key", "FROM ", "RUN ", "ifeq", "endif", "define", "url(", "!important", "#fff", "10px", "1.5e3",
  "0xff", "2020-01-01", "true", "null", "\u00e9", "\ud835\udcb3", "\u0000",
]

describe("highlightCode: new languages, robustness", () => {
  test("spans are ordered, non-overlapping and inside the text (random mixtures of syntax)", () => {
    let seed = 20260701
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
    for (const lang of [...NEW_LANGUAGES, ...EXISTING_LANGUAGES, "htm", "gql", "tf", "ps1", "ex", "hs", "mk"]) {
      for (let k = 0; k < 60; k++) {
        let code = ""
        for (let q = Math.floor(next() * 40); q > 0; q--) code += PIECES[Math.floor(next() * PIECES.length)]
        let last = 0
        for (const s of highlightCode(code, lang)) {
          expect(s.start).toBeGreaterThanOrEqual(last)
          expect(s.end).toBeGreaterThan(s.start)
          expect(s.end).toBeLessThanOrEqual(code.length)
          last = s.end
        }
      }
    }
  })

  test("spans keep their properties on a realistic sample of each language", () => {
    const samples: Record<string, string> = {
      html: '<!DOCTYPE html>\n<!-- c -->\n<div class="a" hidden>x &amp; y</div>\n<script>a<b</script>',
      css: '/* c */\n@media (min-width: 1px) { a:hover { color: #fff; margin: -1px 2em; content: "x" } }',
      scss: "$v: 1px;\n// c\n.a { &:hover { w: #{$v}; @include m($x: 1) } }",
      less: "@c: #fff;\n.m(@a; @b: 2) when (iscolor(@a)) { color: @a }",
      markdown: "# T\n- a `b` [c](d)\n> q\n```js\n# x\n```\n<!-- c\nd -->",
      dockerfile: "FROM a AS b\nRUN x \\\n  && y # c\nENV A=\"$B\"",
      makefile: "CC := gcc\nall: $(OBJ)\n\t@echo $@ # c\nifeq ($(A),b)\nendif",
      lua: "local s = [==[ a ]==] --[[ b ]] return nil -- c",
      toml: '[a.b]\nk = "v" # c\nl = [1, 2,\n 3]\nt = { x = 1 }\nm = """\n a\n"""',
      ini: "; c\n[s]\nk = v ; t\nn: 4",
    }
    for (const [lang, code] of Object.entries(samples)) {
      const spans = highlightCode(code, lang)
      expect(spans.length).toBeGreaterThan(3)
      let last = 0
      for (const s of spans) {
        expect(s.start).toBeGreaterThanOrEqual(last)
        expect(s.end).toBeGreaterThan(s.start)
        expect(s.end).toBeLessThanOrEqual(code.length)
        last = s.end
      }
    }
  })

  // Openers that never close, over and over, and one very long line: the shapes that make a
  // careless `indexOf`-per-opener or lazy-regex implementation quadratic. One language per
  // scanner (or per option of the generic one); the names that share a scanner behave alike.
  const HOSTILE = [
    "<!--", '<a "', "/*", "[[", "--[=[", '"""', '"\\', "'", "`", "${", "#{", "url(", "[a](", "key = [\n",
    "{ a = \n", "a",
  ]
  const TIMED = [
    "html", "xml", "css", "scss", "less", "markdown", "dockerfile", "makefile", "toml", "ini", "lua",
    "hcl", "powershell", "graphql", "elixir", "haskell", "ts", "py", "sh",
  ]
  for (const lang of TIMED) {
    test(`${lang}: 60000 characters of hostile input scan in under 100 ms`, () => {
      for (const unit of HOSTILE) {
        const code = unit.repeat(Math.ceil(60000 / unit.length)).slice(0, 60000)
        expect(bestMs(code, lang), `${lang} on ${JSON.stringify(unit)}`).toBeLessThan(100)
      }
    })
  }

  test("a line of quotes that never close is scanned once, not once per quote", () => {
    // the escape pairs `\"` swallow every quote, so each `"` looks like an opener that fails
    expect(bestMs('"\\'.repeat(30000), "ts")).toBeLessThan(100)
    expect(bestMs("'a ".repeat(20000), "py")).toBeLessThan(100)
  })
})
