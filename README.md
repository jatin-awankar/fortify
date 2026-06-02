# Fortify &middot; [![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/jatin-awankar/fortify/blob/main/LICENSE)

Fortify (`fortify-ai-cli`) is a developer-focused terminal assistant that helps you explain errors, generate commit messages, summarize codebases, and streamline daily workflows directly from the CLI.

Built for developers who live in the terminal.

---

## Demo

![Fortify Demo](./assets/demo.gif)

---

## Features

- Streaming AI responses directly in terminal
- Git-aware commit message generation
- Error and stack trace explanation
- File and folder summarization
- Interactive chat mode
- Local CLI configuration and chat history persistence
- Clean terminal UX with colors, prompts, and spinners

---

Example workflow:

```bash
# Explain a stack trace
fortify explain ./logs/error.txt

# Generate a commit message from staged changes
fortify commit --style conventional

# Summarize a codebase
fortify summarize ./src

# Interactive AI chat
fortify chat

# Inspect saved chat sessions
fortify history --list
```

---

## Requirements

- Node.js **20+**
- An OpenAI API key with billing or credits enabled

Get your API key here:

https://platform.openai.com/api-keys

---

## Installation

Install globally:

```bash
npm install -g fortify-ai-cli
```

The installed command is:

```bash
fortify
```

Run directly without installing:

```bash
npx fortify-ai-cli --help
```

---

## Quick Start

Authenticate once:

```bash
fortify auth
```

This stores your API key locally in:

```text
~/.fortify/config.json
```

Then start using Fortify:

```bash
fortify chat
fortify explain ./crash.log
fortify commit
fortify summarize ./src
fortify history --list
```

Use help anytime:

```bash
fortify --help
fortify <command> --help
```

---

## History Storage

Fortify stores local chat history in:

```text
~/.fortify/history
```

Use:

```bash
fortify history --list
fortify history --show <session-id>
fortify history --clear
```

---

## Cancellation Behavior

All interactive and streaming flows handle `Ctrl+C` gracefully:

- In `fortify chat`, `Ctrl+C` exits the chat loop cleanly.
- During streaming commands (`explain`, `summarize`, `commit`), `Ctrl+C` cancels the active generation without noisy stack traces.
- Cancelled flows return exit code `130`.

---

## Configuration

Example configuration:

```json
{
  "modelPreferences": {
    "defaultModel": "gpt-5.4",
    "fallbackModels": ["gpt-5.3", "gpt-5.4-mini"]
  }
}
```

If your OpenAI account has no billing or credits enabled, requests will fail regardless of fallback models.

Manage billing here:

https://platform.openai.com/account/billing

---

## Package Name vs CLI Name

The npm package is published as:

```text
fortify-ai-cli
```

because the shorter package name was unavailable on npm.

The installed CLI command remains:

```bash
fortify
```

---

## Built With

- Node.js
- Commander.js
- OpenAI Responses API
- Streaming async iterators
- Chalk
- Ora
- Inquirer

---

## License

MIT - see [LICENSE](./LICENSE)
