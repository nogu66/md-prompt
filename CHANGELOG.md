# Changelog

## 0.1.1

- Added task boxes without a bullet: a `[ ]` or `[x]` opening a line is painted like `- [ ]` and `- [x]`, so a checklist typed as `[ ] todo` gets its boxes too

## 0.1.0

- Added painting of fenced code blocks in the prompt box: a card with a fixed background and syntax colours, painted from the opening fence on, so a block still being typed is already coloured; `~~~` fences, indented code, and fences inside lists and quotes work too
- Added syntax highlighting for TypeScript/JavaScript, Python, shell, JSON, YAML, TOML/INI, Go, Rust, Swift, the C and Java families, SQL, Ruby, Lua, HCL, PowerShell, GraphQL, Elixir, Haskell, Zig, R, Perl, nginx, Protobuf, HTML/XML, CSS/SCSS/Less, Markdown, Dockerfile, Makefile and `diff`; other languages get strings and numbers only
- Added the rest of everyday Markdown: inline code, bold, italic, bold italic and strikethrough by CommonMark's rules (nested, across the lines of a paragraph), bullet, numbered and task lists, quotes, headings of every level, rules, tables, links of every kind (inline, reference, autolink, bare URL), images, footnotes, inline HTML and entities; the Markdown markers are dimmed rather than hidden, and the text you type is never changed
- Added guards so prose that only looks like Markdown stays plain (`2*3*4`, `src/*.ts`, `__init__`, `Array<string>`, `arr[i][j]`, `$5`, `~/path`), and a linear-time scan that stays fast on hostile input
- Added `/md-prompt on | code | off | toggle`: everything, code only, or nothing; the mode is the plugin's "Markdown painting" setting, a row in /config, so it is kept across sessions
- Added tests: the pure logic including differential checks against commonmark.js and a fuzz run, the hooks through `claude plugin test`, and a colour-contrast floor so the colours that sit on the terminal background stay readable on light and dark themes
- Added CI that runs those tests, validates the marketplace and the plugin, and type-checks the plugin on every push and pull request, and weekly against the latest Claude Code
