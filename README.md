# Fortify

[![CI](https://github.com/jatin-awankar/fortify/actions/workflows/ci.yml/badge.svg)](https://github.com/jatin-awankar/fortify/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Fortify (`fortify-ai-cli`) is a terminal-first AI assistant for developers who want help explaining errors, drafting safe commit messages, summarizing code, and keeping local chat history without leaving the shell.

## Demo

![Fortify Demo](./assets/demo.gif)

## Install

Requirements:

- Node.js 20+
- An OpenAI API key

```bash
npm install -g fortify-ai-cli
fortify --help
```

Run without installing:

```bash
npx fortify-ai-cli --help
```

## 60-second quickstart

Use an environment variable:

```bash
export OPENAI_API_KEY="sk-..."
fortify explain "TypeError: x is not a function"
```

Or store the key locally:

```bash
fortify auth
fortify explain ./logs/error.log
fortify commit --dry-run
```

Fortify stores local config at:

```text
~/.fortify/config.json
```

`OPENAI_API_KEY` takes precedence over the saved config for runtime requests and does not rewrite your local config file.

## Commands

```bash
fortify explain ./logs/error.log
fortify explain "TypeError: x is not a function" --context "Node.js app"

fortify summarize ./src
fortify summarize ./src --format bullet

fortify commit --dry-run
fortify commit --style conventional --scope cli
fortify commit --yes

fortify chat
fortify chat --session local-dev

fortify history --list
fortify history --show default
fortify history --clear

fortify config list
fortify config get modelPreferences.defaultModel
fortify config set modelPreferences.defaultModel gpt-5.1
fortify config validate
```

## Global options

```bash
fortify --json config validate
fortify --quiet config validate
fortify --verbose config validate
```

- `--json` emits machine-readable JSON where supported.
- `--quiet` suppresses nonessential terminal output.
- `--verbose` is reserved for additional diagnostics as commands grow.

## Safer commits

`fortify commit` reads staged changes only. If nothing is staged, it exits without generating a message.

Recommended flow:

```bash
git add src/index.js
fortify commit --dry-run
fortify commit
```

The command shows repository context and a staged diff summary before asking for confirmation. It only creates a commit when you confirm interactively or pass `--yes`.

## Configuration

Default config shape:

```json
{
  "apiKeys": {
    "openai": ""
  },
  "modelPreferences": {
    "defaultModel": "gpt-5.4",
    "fallbackModels": ["gpt-5.3", "gpt-5.4-mini"]
  },
  "theme": {
    "name": "default",
    "useColor": true
  }
}
```

Useful config commands:

```bash
fortify config list
fortify config get apiKeys.openai
fortify config set theme.useColor false
fortify config set modelPreferences.fallbackModels '["gpt-5.1-mini"]'
fortify config validate
```

Secret values are redacted when displayed.

## History

Chat history is stored locally in:

```text
~/.fortify/history
```

Use named sessions to keep threads separate:

```bash
fortify chat --session release-work
fortify history --show release-work
```

## Troubleshooting

- Missing API key: set `OPENAI_API_KEY` or run `fortify auth`.
- Quota or billing errors: check https://platform.openai.com/account/billing.
- No commit message generated: stage files first with `git add`.
- Not a git repository: run commit commands from inside a git work tree.
- Invalid config: run `fortify config validate`, then fix the reported key with `fortify config set`.

## Development

```bash
npm ci
npm test
npm run verify
```

`npm test` runs the Node test suite. `npm run verify` runs tests and the publish smoke check.

## Package name vs CLI name

The npm package is:

```text
fortify-ai-cli
```

The installed command is:

```text
fortify
```

## License

MIT - see [LICENSE](./LICENSE).
