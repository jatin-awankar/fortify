<div align="center">

# Fortify AI CLI

**The Repo-Aware, Multi-Provider Terminal AI Assistant for Modern Engineering**

[![npm version](https://img.shields.io/npm/v/fortify-ai-cli.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/fortify-ai-cli)
[![CI Status](https://img.shields.io/github/actions/workflow/status/jatin-awankar/fortify/ci.yml?branch=main&style=flat-square&label=build)](https://github.com/jatin-awankar/fortify/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg?style=flat-square)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)

[Quickstart](#-quickstart) • [Features](#-key-features) • [Comparison](#-feature-comparison) • [Commands](#-command-reference) • [Providers & Config](#-provider--configuration-guide) • [Architecture](#-architecture)

</div>

---

### 💻 Next-Level Claude Code-like Terminal UX

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Fortify v0.8.0 | Model: gpt-4o (openai) | Session: sess-8f92a             │
└──────────────────────────────────────────────────────────────────────────┘
Commands: /help, /clear, /diff, /commit, /exit │ Files: @filename
----------------------------------------------------------------------------
You > Refactor @src/services/chat-service.js to optimize token usage

[1/3] Discovering workspace structure & context...
  ✓ Read src/services/chat-service.js (32 lines)

[2/3] Generating diff preview...
╭─ src/services/chat-service.js +2 -1 ─╮
│ @@ -15,4 +15,5 @@                   │
│ -const TIMEOUT_MS = 1000;             │
│ +const TIMEOUT_MS = 5000;             │
│ +const RETRY = true;                  │
╰───────────────────────────────────────╯

[3/3] Awaiting approval...
  ? Allow updating src/services/chat-service.js? [Y/n]
```

---

## ⚡ Key Features

Fortify is built to stand among the **Top 1% developer CLI tools**. Unlike simple LLM wrappers, Fortify brings **Claude Code-like interactive TUI action cards**, **git diff preview frames**, **slash-command & @file tab completions**, **deep repository context**, **native `$EDITOR` integration**, **pluggable cloud & local AI engines**, and **zero runtime dependencies** directly to your terminal.

- 🖥️ **Claude Code-like TUI & Live Action Cards**: Real-time tool execution cards (`📄`, `📝`, `⚡`, `🧠`, `🔍`) with animated in-place line state transitions (`⠋` -> `✓`) and step progress counters (`[1/3]`).
- 🎨 **Git-Style Unified Diff Preview Cards**: Rounded box frames (`╭─`, `╰─`) displaying colorized additions (`+`), deletions (`-`), and line change stats (`+2 -1`).
- ⌨️ **Interactive REPL & Tab Completion**: Tab autocompletion for slash commands (`/commit`, `/explain`, `/summary`, `/clear`, `/help`, `/exit`) and recursive workspace file paths when typing `@filename`.
- 🛡️ **Interactive Permission Confirmations**: Single-keypress permission prompts (`? Allow action? [Y/n]`) before performing file edits or executing shell commands.
- ⚡ **100% Zero Runtime Dependencies**: Pure Node.js ESM architecture with `<10ms` startup times and zero supply-chain risk.
- 🧠 **Repo-Aware Context Engine**: Automatically detects workspace signatures (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`), active Git branch, diff status, and project architecture.
- ✏️ **Interactive `$EDITOR` Commit Workflow**: Draft high-quality git commit messages and review/edit them live in `$EDITOR`, `$VISUAL`, `code --wait`, `notepad`, or `nano` before committing (`fortify commit -i`).
- 🔌 **Pluggable AI Backends**: Switch seamlessly between **OpenAI (GPT-4o/o1)**, **Anthropic (Claude 3.5 Sonnet)**, **Google Gemini**, and **Local Models via Ollama** (`llama3`, `deepseek-r1`, `qwen2.5`) with zero code changes.

---

## 📊 Feature Comparison

| Feature | 🛡️ Fortify CLI | GitHub Copilot CLI | Aider | Cursor CLI |
| :--- | :---: | :---: | :---: | :---: |
| **Repo Signature & Stack Auto-Detection** | ✓ **Native (`fortify init`)** | ✘ | ✘ | ⚠️ Basic |
| **Interactive Terminal `$EDITOR` Integration** | ✓ **Native (`-i / --interactive`)** | ✘ | ✘ | ✘ |
| **Pluggable Backends (OpenAI, Claude 3.5, Ollama)** | ✓ **Native** | ✘ (OpenAI only) | ✓ | ✘ (Proprietary) |
| **Workspace Prompt Shortcuts (`.fortify/plugins`)** | ✓ **Native** | ✘ | ✘ | ✘ |
| **Tab Autocomplete `@file` References** | ✓ **Native** | ✘ | ✓ | ✘ |
| **Conventional Commits Validator** | ✓ **Native (`--validate`)** | ✘ | ✘ | ✘ |
| **Persistent Session Resume** | ✓ **Native (`--resume`)** | ✘ | ⚠️ Limited | ✘ |
| **Local / Privacy-First LLMs (Ollama)** | ✓ **Native** | ✘ | ✓ | ✘ |

---

## 🚀 Quickstart

### Installation

Install globally using your favorite package manager:

```bash
# via npm
npm install -g fortify-ai-cli

# via pnpm
pnpm add -g fortify-ai-cli

# via yarn
yarn global add fortify-ai-cli

# via bun
bun add -g fortify-ai-cli
```

Or run directly without global installation:

```bash
npx fortify-ai-cli --help
```

---

### Step-by-Step Setup

#### 1. Authenticate / Configure Provider

Set up your OpenAI or Anthropic API key with the interactive wizard:

```bash
fortify auth
```

Alternatively, set your key directly or use environment variables:

```bash
# Configure Anthropic Claude
fortify config set provider anthropic
fortify config set apiKeys.anthropic "sk-ant-api..."

# Or via environment variables
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

#### 2. Initialize Your Workspace

Run `fortify init` in your project root to auto-detect your stack and create repository context guidelines (`.fortify/rules.md`):

```bash
fortify init
```

#### 3. Launch Interactive Terminal REPL

Start an interactive AI chat session with `@file` path auto-completion:

```bash
fortify chat
```

Inside the chat prompt:
```text
You > Explain the authentication logic in @src/services/auth-service.js and apply @refactor
```

#### 4. Generate & Review AI Commits

Draft git commit messages based on staged/unstaged changes and edit them in your terminal `$EDITOR`:

```bash
fortify commit --interactive --validate
```

---

## 📖 Command Reference

| Command | Description | Key Flags & Options | Example Usage |
| :--- | :--- | :--- | :--- |
| **`fortify init`** | Initialize workspace context (`.fortify/project.json`, `.fortify/rules.md`) | `-y, --yes` (skip prompts) | `fortify init` |
| **`fortify auth`** | Interactive authentication & provider wizard | `--provider <name>` | `fortify auth` |
| **`fortify chat`** | Start interactive AI assistant REPL | `-r, --resume`, `--session <id>` | `fortify chat --resume` |
| **`fortify commit`** | Draft AI commit messages from git diffs | `-i, --interactive`, `--validate`, `--dry-run` | `fortify commit -i --validate` |
| **`fortify explain`** | Explain errors, stack traces, or code files | Inline error string or file path | `fortify explain "TypeError: undefined"` |
| **`fortify summarize`** | Summarize workspace structure & codebase recursively | Directory path (default: `.`) | `fortify summarize src/` |
| **`fortify plugin`** | Manage prompt shortcuts & custom rules | `list`, `init` | `fortify plugin list` |
| **`fortify config`** | Inspect, set, and validate CLI configuration | `list`, `get <key>`, `set <key> <val>`, `validate` | `fortify config set model gpt-4o` |
| **`fortify history`** | Manage saved interactive chat sessions | `list`, `--show <id>`, `--clear` | `fortify history list` |

---

## 🔌 Provider & Configuration Guide

Fortify supports multiple cloud AI providers as well as local zero-telemetry LLMs.

### 1. OpenAI Config
```bash
fortify config set provider openai
fortify config set model gpt-4o
fortify config set apiKeys.openai "sk-..."
```

### 2. Anthropic Config
```bash
fortify config set provider anthropic
fortify config set model claude-3-5-sonnet-20241022
fortify config set apiKeys.anthropic "sk-ant-..."
```

### 3. Local Ollama Config (Privacy First)
Ensure [Ollama](https://ollama.ai/) is running locally, then configure Fortify:

```bash
fortify config set provider ollama
fortify config set baseUrl "http://localhost:11434"
fortify config set model llama3
```

---

## 🛠️ Custom Plugins & Team Project Rules

Fortify allows teams to standardize prompts and enforce codebase rules across environments.

### Workspace Rules (`.fortify/rules.md`)
Created during `fortify init`. Fortify injects these instructions into every prompt:

```markdown
# Repository Coding Rules
- Use ES Modules (`import/export`).
- Always write JSDoc comments for public methods.
- Enforce strict error handling with custom Error subclasses.
```

### Prompt Shortcuts (`.fortify/plugins/`)
Create custom `.md` or `.json` prompt shortcuts. For example, `.fortify/plugins/security-check.md`:

```markdown
Review the referenced code specifically for OWASP top 10 security vulnerabilities, unhandled promises, and sensitive key leaks.
```

Then invoke it instantly in chat:
```text
You > Check @src/index.js with @security-check
```

---

## 🏗️ Architecture

```mermaid
flowchart TD
    subgraph CLI ["Fortify Core CLI Layer"]
        Entry["bin/fortify.js"] --> Parser["Native CLI Parser"]
        Parser --> Loader["Command Loader"]
        Loader --> Commands["Command Services (chat, commit, explain, etc.)"]
    end

    subgraph Context Engine ["Repository Context Engine"]
        Commands --> ContextService["ProjectContextService"]
        ContextService --> Signature["Stack Auto-Detection (Package/Cargo/PyProject/Go)"]
        ContextService --> Git["Git Metadata & Diff Analyzer"]
        Commands --> PluginService["Plugin & Rules Engine"]
        PluginService --> LocalRules[".fortify/plugins & rules.md"]
    end

    subgraph Provider Factory ["Pluggable AI Provider Factory"]
        Commands --> Factory["ProviderFactory"]
        Factory --> OpenAI["OpenAIService (GPT-4o/o1)"]
        Factory --> Anthropic["AnthropicService (Claude 3.5)"]
        Factory --> Ollama["OllamaService (Local LLMs)"]
    end

    subgraph Renderer ["Terminal UI & Storage"]
        Commands --> RendererUI["TerminalUI & Color Renderer"]
        Commands --> SessionStorage["Session History & Config Storage"]
    end
```

---

## 🧪 Development & Verification

To contribute to Fortify CLI or test local changes:

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/jatin-awankar/fortify.git
   cd fortify
   npm install
   ```

2. Run unit tests:
   ```bash
   npm test
   ```

3. Run package verification pipeline:
   ```bash
   npm run verify
   ```

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.

Developed with ❤️ by [Jatin Awankar](https://github.com/jatin-awankar)
