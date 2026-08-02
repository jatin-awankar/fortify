# Contributing to Fortify AI CLI

First off, thank you for considering contributing to **Fortify AI CLI**! 🎉

Whether you are fixing a bug, adding support for a new AI provider, refining terminal renderers, or improving documentation, your contributions are welcome and greatly appreciated.

---

## 📜 Table of Contents

- [Code of Conduct](#-code-of-conduct)
- [How Can I Contribute?](#-how-can-i-contribute)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Submitting Pull Requests](#submitting-pull-requests)
- [Local Development Setup](#-local-development-setup)
- [Project Architecture & Design Rules](#-project-architecture--design-rules)
- [Coding Standards & Testing](#-coding-standards--testing)
- [Commit Message Guidelines](#-commit-message-guidelines)

---

## 🤝 Code of Conduct

By participating in this project, you agree to maintain a respectful, inclusive, and welcoming environment for everyone. Please be kind, constructive, and respectful in issues, discussions, and pull requests.

---

## 💡 How Can I Contribute?

### Reporting Bugs

Before creating a bug report, please check existing GitHub issues to make sure the problem hasn't already been reported.

When reporting a bug, please include:
- **CLI Version**: Run `fortify --version` or check `package.json`.
- **Node.js Version**: Run `node -v` (Node.js `>=20.0.0` required).
- **OS Platform**: Windows, macOS, or Linux.
- **Active Provider**: OpenAI, Anthropic, or Ollama.
- **Steps to Reproduce**: Detailed commands or prompts that trigger the issue.
- **Error Tracebacks**: Full error output or debug log.

---

### Suggesting Features

We welcome feature requests! Please open an issue with:
- A clear, descriptive title.
- The motivation behind the requested feature.
- Proposed CLI syntax or workflow example (e.g. `fortify plugin add <name>`).

---

### Submitting Pull Requests

1. **Fork the Repository**: Create a fork under your GitHub account.
2. **Create a Feature Branch**:
   ```bash
   git checkout -b feat/your-feature-name
   # or for bug fixes:
   git checkout -b fix/issue-description
   ```
3. **Make Your Changes**: Keep edits focused and self-contained.
4. **Run Tests & Verification**: Ensure all unit tests and publish checks pass.
   ```bash
   npm test
   npm run verify
   ```
5. **Commit Your Changes**: Follow Conventional Commits format (`feat: ...`, `fix: ...`).
6. **Push & Open PR**: Push to your fork and submit a PR against `main`.

---

## 🛠️ Local Development Setup

### Prerequisites

- **Node.js**: `>=20.0.0` (uses native `node:test` runner and `node:util` style text).
- **Git**: For source control.

### Setup Instructions

1. Clone your fork locally:
   ```bash
   git clone https://github.com/your-username/fortify.git
   cd fortify
   ```

2. Install development dependencies:
   ```bash
   npm install
   ```

3. Test running the CLI binary directly:
   ```bash
   node ./bin/fortify.js --help
   # or test commands:
   node ./bin/fortify.js chat
   ```

4. Link globally for local testing (optional):
   ```bash
   npm link
   # Now run 'fortify' anywhere in your terminal
   fortify --help
   ```

---

## 🏗️ Project Architecture & Design Rules

To maintain high speed, zero supply-chain risk, and lightweight installation, Fortify adheres to strict architectural guidelines:

1. **Zero Runtime Third-Party Dependencies**:
   - Fortify uses **100% native Node.js standard modules** (`node:http`, `node:https`, `node:fs`, `node:readline`, `node:child_process`, `node:util`).
   - Do **NOT** introduce third-party runtime dependencies in `package.json`.
2. **ES Modules (`"type": "module"`)**:
   - Use standard `import` and `export` statements with explicit file extensions (e.g., `import { createTerminalUI } from "./terminal-ui.js";`).
3. **Directory Layout**:
   - `bin/fortify.js`: Executable entry point.
   - `src/commands/`: Command handlers (`chat`, `commit`, `explain`, `summarize`, `plugin`, `config`, `history`, `init`, `auth`).
   - `src/services/`: Core logic engines (Context engine, provider factory, chat engine, git diff analyzer).
   - `src/renderers/`: Terminal UI formatting, spinner, box borders, and diff highlighter.
   - `src/config/`: Configuration store and app metadata.
   - `test/`: Native unit test suite (`node --test`).

---

## 🧪 Coding Standards & Testing

### Running Tests

Run the full unit test suite:

```bash
npm test
```

Run the publish verification pipeline:

```bash
npm run verify
```

### Code Style Guidelines

- **Asynchronous Code**: Prefer `async`/`await` over raw promises.
- **Error Handling**: Use clean try/catch blocks and wrap user-facing errors using `terminalUI.error()`.
- **Documentation**: Add JSDoc annotations to public methods and exported classes.

---

## 📝 Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```text
<type>(<scope>): <short description>
```

### Types:
- `feat`: A new CLI feature or command extension.
- `fix`: A bug fix in command logic, provider, or terminal UI.
- `docs`: Documentation updates (README, CONTRIBUTING, docstrings).
- `refactor`: Code refactoring without changing public behavior.
- `test`: Adding or updating test suites.
- `chore`: Maintenance tasks or script updates.

### Examples:
- `feat(chat): add support for @shortcut expansion`
- `fix(commit): resolve interactive editor exit code handling`
- `docs: update quickstart guide in README.md`

---

Thank you for helping build **Fortify AI CLI**! 🚀
