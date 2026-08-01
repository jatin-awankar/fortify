# Changelog

## 0.6.0

- **100% Zero Third-Party Runtime Dependencies** (`"dependencies": {}` in `package.json`).
- Replaced `openai` SDK with native 0-dependency Node.js 20+ `fetch` and SSE `TextDecoder` stream parser.
- Replaced `chalk` with native `node:util` `styleText` and zero-dependency ANSI color utility (`src/renderers/ansi-style.js`).
- Replaced `ora` with non-blocking braille frame `NativeSpinner` (`src/renderers/native-spinner.js`).
- Replaced `commander` with native `node:util` `parseArgs` CLI routing (`src/commands/native-cli-parser.js`).
- Sub-second installation footprint and 100% supply-chain security guarantee.

## 0.5.1

- Added first-class **Google Gemini** integration (`GeminiService`) supporting `gemini-2.0-flash`, `gemini-1.5-pro`, and `gemini-1.5-flash` with REST SSE streaming.
- Added interactive multi-provider authentication menu (`fortify auth`) for **OpenAI**, **Anthropic (Claude)**, **Google Gemini**, and **Ollama (Local LLM)**.
- Added direct provider credential setup shortcut (`fortify auth --provider <name>`).
- Added per-command provider and model override flags (`-p, --provider <name>` and `--model <name>`) across `chat`, `commit`, `explain`, and `summarize` commands.
- Added complete secret key masking for `openai`, `anthropic`, and `gemini` in `ConfigService`.

## 0.5.0

- Added workspace plugin discovery (`.fortify/plugins/`) and custom project rules (`.fortify/rules.md`).
- Added prompt shortcuts (`@security-check`, `@refactor`, `@explain-simple`) with dynamic expansion.
- Added `fortify plugin list` and `fortify plugin init` management commands.
- Added GitHub Actions tag-triggered automated release pipeline (`.github/workflows/release.yml`) and OS matrix testing (`.github/workflows/ci.yml`).
- Added cyan FORTIFY ASCII logo banner, `TerminalUI.box()` status frames, and `TerminalUI.table()` alignment formatting for history and config listings.
- Added comprehensive README documentation with Shields.io badges, Mermaid architecture diagrams, and competitive feature matrix.
- Added modern dark-mode glassmorphic showcase website (`docs/index.html`).

## 0.4.0

- Added `fortify init` command for workspace initialization and `.fortify/project.json` creation.
- Added stack signature scanning for Node.js, Python, Rust, Go, and Java workspace auto-detection.
- Added smart `@filepath` prompt attachments with size limits and tab-autocomplete in interactive chat.
- Added interactive commit message editing (`fortify commit -i`) via `$EDITOR`, `$VISUAL`, or visual IDE fallback (`code --wait`).
- Added Conventional Commits format validation (`fortify commit --validate`).
- Added persistent session resume (`fortify chat --resume`).
- Added pluggable multi-provider support for OpenAI, Anthropic (Claude), and local Ollama API endpoints.
- Added terminal diff color highlighting (`+` green, `-` red, `@@` cyan) and `ora` loading spinner in summarizer.

## 0.3.0

- Added a real Node `node:test` suite for config, OpenAI service behavior, git service behavior, command service behavior, and CLI smoke coverage.
- Added `OPENAI_API_KEY` runtime precedence over saved config.
- Added `fortify config list|get|set|validate`.
- Added global `--json`, `--verbose`, and `--quiet` flags.
- Added `fortify commit --dry-run` and staged diff summary output before commit confirmation.
- Added GitHub Actions CI for Node 20 and 22.
- Updated README with quickstart, config docs, troubleshooting, and development verification instructions.

## 0.2.2

- Early publishable CLI with auth, chat, explain, commit, summarize, and history commands.
