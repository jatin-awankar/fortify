# Changelog

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
