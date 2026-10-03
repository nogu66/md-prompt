# Changelog

## 0.2.0

- Changed the setting to an on/off toggle, **Markdown painting** (`enabled`), in place of the `mode` picker, which the plugin directory does not accept; a `mode` left in settings by 0.1.x is ignored, so painting starts on
- Removed the code-only mode: `/md-prompt` takes `on`, `off` and `toggle`
- Added a plugin icon, `.claude-plugin/icon.png` (source: `docs/icon.svg`)
- Added a README in the plugin folder that says what each hook does and that `md-prompt.enabled` is the only setting the plugin writes

## 0.1.2

- Fixed paths with `__tests__`, `__pycache__`, `__mocks__`, `__snapshots__` and other `_` segments being painted bold: an `_` run right after a `/` no longer opens and one right before a `/` no longer closes, like the `*` in `src/*.ts`, and the Jest and Python directory names join the `__init__` exemption (#4)

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
