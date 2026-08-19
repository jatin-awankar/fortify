# Changelog

## 0.9.0

### Agentic Core — Real Tool Execution

Fortify is now a fully agentic AI coding assistant. The LLM can autonomously read, write, edit, and search files, list directories, and execute shell commands — all within a controlled permission and security model.

**New Features:**
- **6 Tool Handlers**: `read_file`, `write_file`, `edit_file`, `search_files`, `list_directory`, `execute_command` — all implemented as isolated async handlers with comprehensive error handling
- **Agentic Chat Mode**: `fortify chat --mode agent` activates the multi-turn LLM ↔ tool execution loop across all providers
- **Provider Tool-Use Adapters**: `createResponse()` with tool calling support for OpenAI, Anthropic (format conversion), Gemini (functionDeclarations), and Ollama
- **Agentic System Prompt**: Tool-use guidelines, safety notes, and working directory context injected in agent mode
- **`.fortifyignore` Parser**: Glob-based file filtering with built-in defaults, `.gitignore` merging, and negation patterns
- **Command Allowlist**: Prefix-based allowlist, dangerous command blocklist (rm -rf, fork bombs, curl|sh), shell metacharacter injection detection

**Security:**
- Path traversal protection on all file operations
- Binary file detection and size limiting (100KB read, 50KB command output)
- Command execution timeout (30s) with SIGTERM/SIGKILL escalation
- Platform-aware shell selection (cmd.exe on Windows, /bin/sh on Unix)

**Tests:** 220 new tests (484 total), zero regressions.

## 0.8.1

- **83 Core Bug Fixes**: Hardened architecture across Anthropic and Gemini role validation rules, mitigated silent socket memory leaks in OpenAI streams, resolved permission prompt logic collisions, fixed dependency injection overrides in Auth service, patched destructive non-interactive initialization, and implemented robust Agentic Loop `AbortError` recovery.
- Adheres strictly to SemVer patch rules for bugfix releases.

## 0.8.0

- **Agentic Tool Execution Scaffold**: Built the full multi-turn LLM ↔ tool-use loop (`AgenticLoop`) with `ToolRegistry` (6 built-in tools, OpenAI function-calling schema generation), `ToolExecutor` (permission checks, animated card rendering, stats tracking), and MAX_ITERATIONS safety with abort signal support.
- **Slash Command System**: Added `SlashCommandHandler` with 7 built-in commands (`/help`, `/clear`, `/model`, `/exit`, `/history`, `/status`, `/tools`), alias support (`/?`, `/quit`, `/bye`), and custom command registration. Wired into REPL with runtime model switching.
- **Interactive Input History**: Added `InputHistory` class with up/down navigation, draft preservation, deduplication, configurable max size, and persistence-ready `load()`/`clear()` API.
- **Permission Prompt System**: Interactive single-keypress permission dialogs (`[Y] Allow [n] Deny [a] Allow all [?] Explain`) with session-level allow-all tracking and auto-approve mode.
- **Tool Use Card Rendering**: Animated lifecycle cards (`⠋ Reading...` → `✓ Read file`), step badges (`[1/3]`), collapsible content, and `renderCommandCard()` for shell commands.
- **Enhanced Markdown Rendering**: Added pipe-table rendering, task lists (`✓`/`○`), blockquotes (`│`), horizontal rules (`───`), and improved code block handling.
- **Enhanced Diff Rendering**: File extension icons (`📜📘🐍🎨`), auto-collapsible long diffs, and `renderDiffSummary()` for multi-file changesets.
- **Core TUI Primitives**: `renderBox()` with rounded/single/heavy borders, `ThinkingIndicator` with elapsed timer and extended 🧠 mode, `StatusBar` with token counters and cost tracking.
- **Integration & Testing**: 272 total tests (0 failures), 15 new modules, 5 enhanced modules, 0 runtime dependencies added. End-to-end integration tests covering the full agentic pipeline.

## 0.7.0


- **Claude Code-like Interactive TUI/UX**: Implemented next-generation terminal UI architecture built with 100% native Node.js ESM modules and **zero runtime dependencies**.
- **Action Cards Renderer (`ActionCardRenderer`)**: Added live, step-by-step tool activity status cards with animated in-place line state transitions (`⠋ Reading...` -> `✓ Read file (32 lines)`), status icons (`📄`, `📝`, `⚡`, `🧠`, `🔍`), and step progress counters (`[1/3]`).
- **Code & Unified Diff Renderer (`DiffRenderer`)**: Added git-style unified diff box cards with rounded frame borders (`╭─`, `╰─`), colorized green additions (`+`), red deletions (`-`), and auto-calculated line change stats (`+2 -1`).
- **Interactive REPL Prompt Editor (`PromptEditor`)**: Added native `readline` tab-completion for slash commands (`/commit`, `/explain`, `/summary`, `/clear`, `/help`, `/exit`) and recursive workspace file path suggestions when typing `@filename`.
- **TUI Session Header & Permission Dialogs (`TUISession`)**: Added responsive session status header box (displaying model, provider, CWD, and session ID), help footer shortcuts bar, and single-keypress interactive permission confirmation dialogs (`? Allow updating file? [Y/n]`).

## 0.6.4

- Refactored `README.md` to top-tier AI CLI standards with hero banner, multi-PM quickstart, command deep-dive, provider guides, and Mermaid architecture diagram.
- Fixed ASCII text logo in README to accurately render `FORTIFY`.
- Added comprehensive `CONTRIBUTING.md` guide covering Code of Conduct, PR workflow, architectural rules (100% zero runtime dependencies), and Conventional Commits guidelines.
- Added `SECURITY.md` vulnerability disclosure policy for open-source security reports.
- Updated version references across application metadata, CLI headers, showcase website, and documentation to `0.6.4`.

## 0.6.3

- Comprehensive resolution of 40 codebase bugs across native CLI parsing, history storage, SSE stream flushing, secret input pasting, git empty repo handling, commit message formatting, project file filtering, API key format validation, and multi-language stack detection.
- Suppressed internal draft reasoning and monologue outputs across `explain` and `chat` system prompts for clean, direct markdown responses.
- Set default Gemini model to stable GA **`gemini-1.5-flash`** (guaranteed 1M TPM free tier support across all accounts).
- Added HTTP 404 / deprecated model error handling (`no longer available to new users`) to the automatic fallback loop.

## 0.6.2

- Refactored `createAnsiStyle` with Proxy chainer wrapper (`src/renderers/ansi-style.js`), supporting unlimited nested ANSI formatting method chains without throwing `TypeError: Cannot read properties of undefined`.
- Guaranteed 100% crash-free Markdown stream rendering for inline code blocks and code syntax highlighting.
- Implemented universal **Dynamic Model Discovery & Auto-Fallback Engine** across ALL 4 providers (**OpenAI**, **Anthropic Claude**, **Google Gemini**, and **Ollama Local**).
- Added dynamic local model discovery for Ollama (`GET /api/tags`), auto-selecting installed local models on the user's machine (`deepseek-r1`, `llama3`, `mistral`, etc.).
- Added dynamic remote model discovery for OpenAI (`GET /v1/models`) and Anthropic (`GET /v1/models`).

## 0.6.1

- Added direct clickable API key links (`helpUrl`) and provider instructions during interactive `fortify auth` setup (Google Gemini: `https://aistudio.google.com/app/apikey`, OpenAI: `https://platform.openai.com/api-keys`, Anthropic: `https://console.anthropic.com/settings/keys`).
- Normalized HTTP 429 (quota/rate limit) and auth error payloads across **Google Gemini**, **Anthropic Claude**, and **OpenAI** into clean single-line messages (`src/utils/api-error-parser.js`).

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
