<div align="center">

# 🛡️ Fortify AI CLI

**The Repo-Aware, Multi-Provider Terminal Assistant for Modern Developers**

[![npm version](https://img.shields.io/npm/v/fortify-ai-cli.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/fortify-ai-cli)
[![CI Status](https://img.shields.io/github/actions/workflow/status/jatin-awankar/fortify/ci.yml?branch=main&style=flat-square&label=build)](https://github.com/jatin-awankar/fortify/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg?style=flat-square)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)

[Quickstart](#-quickstart) • [Feature Matrix](#-feature-comparison) • [Architecture](#-architecture) • [Documentation](#-documentation)

</div>

---

## ⚡ Highlights

Fortify is built to stand among the **Top 1% developer CLI tools**. Unlike generic AI wrappers, Fortify provides **deep repository awareness**, **interactive terminal editing**, **smart `@file` prompt attachments**, **pluggable local/cloud providers**, and **workspace-level prompt shortcuts**.

- 🧠 **Repo-Aware Context**: Automatically scans workspace signature files (`package.json`, `Cargo.toml`, `requirements.txt`, `go.mod`, etc.) and active Git metadata.
- 📎 **Smart `@file` Attachments & Autocomplete**: Reference files directly in prompts with `@src/index.js` featuring size safety checks and readline tab-completion.
- ✏️ **Safe & Interactive Commits**: Edit generated commit messages in `$EDITOR`, `$VISUAL`, `code --wait`, `notepad`, or `nano` before committing (`fortify commit -i`), with Conventional Commits validation (`--validate`).
- 🔌 **Pluggable Backends**: Seamlessly switch between **OpenAI**, **Anthropic (Claude 3.5 Sonnet)**, and **Ollama (local models)**.
- 🧩 **Extensible Shortcuts & Rules**: Define local prompt shortcuts (e.g. `@security-check`, `@refactor`) in `.fortify/plugins/` and custom repo instructions in `.fortify/rules.md`.
- 🎨 **Rich Terminal UX**: Cyan ASCII branding, border boxes, diff syntax color highlighting (`+` green, `-` red, `@@` cyan), and `ora` loading spinners.

---

## 📊 Feature Comparison

| Feature | 🛡️ Fortify CLI | GitHub Copilot CLI | Aider | Cursor CLI |
| :--- | :---: | :---: | :---: | :---: |
| **Repo Signature & Stack Auto-Detection** | ✓ **Built-in (`fortify init`)** | ✘ | ✘ | ⚠️ Basic |
| **Interactive Terminal Editor Integration (`$EDITOR`)** | ✓ **Built-in (`-i`)** | ✘ | ✘ | ✘ |
| **Pluggable Providers (OpenAI, Anthropic, Local Ollama)** | ✓ **Native** | ✘ (OpenAI only) | ✓ | ✘ (Proprietary) |
| **Workspace Prompt Shortcuts (`.fortify/plugins`)** | ✓ **Native** | ✘ | ✘ | ✘ |
| **Tab-Autocomplete for Workspace Files (`@path`)** | ✓ **Native** | ✘ | ✓ | ✘ |
| **Conventional Commits Format Validator** | ✓ **Native (`--validate`)** | ✘ | ✘ | ✘ |
| **Persistent Session Resume (`--resume`)** | ✓ **Native** | ✘ | ⚠️ Limited | ✘ |

---

## 🏗️ Architecture

```mermaid
flowchart TD
    subgraph CLI ["Fortify Core CLI"]
        Entry[bin/fortify.js] --> Loader[Command Loader]
        Loader --> Services[Command Services]
    end

    subgraph Context ["Repository Context Engine"]
        Services --> ContextService[ProjectContextService]
        ContextService --> Detect[Stack Signatures & Git Summary]
        Services --> PluginService[PluginService]
        PluginService --> LocalPlugins[.fortify/plugins & rules.md]
    end

    subgraph Providers ["Pluggable AI Provider Factory"]
        Services --> Factory[ProviderFactory]
        Factory --> OpenAI[OpenAIService]
        Factory --> Anthropic[AnthropicService]
        Factory --> Ollama[OllamaService (Local LLM)]
    end

    subgraph Renderer ["Terminal UX & Renderers"]
        Services --> TUI[TerminalUI & Chalk]
        TUI --> Output[Stream & Table Formatting]
    end
```

---

## 🚀 Quickstart

### Installation

Install globally via npm:

```bash
npm install -g fortify-ai-cli
```

### 1. Initialize Workspace

Run `fortify init` in your project directory to detect the stack and set up local rules:

```bash
fortify init
```

### 2. Configure API Key / Provider

Save your OpenAI API key:

```bash
fortify auth
# or configure custom providers:
fortify config set provider anthropic
fortify config set apiKeys.anthropic "your-anthropic-key"
```

### 3. Interactive Chat with `@file` References & Tab Autocomplete

```bash
fortify chat
```

Inside chat:
```text
You > Please explain @src/services/chat-service.js and check @security-check
```

### 4. Interactive Commit Workflow

Draft a commit message and edit it in your default `$EDITOR`:

```bash
fortify commit --interactive --validate
```

---

## 📚 Command Reference

| Command | Description | Key Flags |
| :--- | :--- | :--- |
| `fortify init` | Initialize workspace `.fortify/project.json` & `.gitignore` | `-y, --yes` |
| `fortify chat` | Open interactive assistant terminal chat | `-r, --resume`, `--session <id>` |
| `fortify commit` | Draft and review git commit messages | `-i, --interactive`, `--validate`, `--dry-run` |
| `fortify explain` | Explain technical errors or code snippets | Inline text or file path |
| `fortify summarize` | Summarize codebase directory context recursively | Source directory path |
| `fortify plugin` | Manage workspace plugins, shortcuts, and rules | `list`, `init` |
| `fortify config` | Inspect, validate, and set configuration settings | `list`, `get`, `set`, `validate` |
| `fortify history` | View or clear interactive chat session history | `list`, `--show <id>`, `--clear` |

---

## 🧪 Development & Testing

Run unit test suite:

```bash
npm test
```

Run full package verification pipeline:

```bash
npm run verify
```

---

## 📄 License

[MIT](LICENSE) © [Jatin Awankar](https://github.com/jatin-awankar)
