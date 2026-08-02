# Security Policy for 🛡️ Fortify AI CLI

The Fortify team takes the security of our application, user credentials, and API tokens very seriously.

---

## 🔒 Supported Versions

Only the latest published version of `fortify-ai-cli` is actively supported with security patches.

| Version | Supported          |
| ------- | ------------------ |
| `0.6.x` | :white_check_mark: |
| `< 0.6` | :x:                |

---

## 🛡️ Security Architecture Highlights

Fortify is built with privacy and token security as core principles:

1. **Zero Runtime Third-Party Dependencies**:
   - Fortify has 0 runtime npm dependencies (`"dependencies": {}`), eliminating node_module supply-chain vulnerabilities.
2. **Local Credential Storage**:
   - API keys and tokens are stored locally on your machine in `.fortify/config.json` (or standard user app data directories) and are **never** transmitted to telemetry or tracking servers.
3. **API Key Masking**:
   - Secret keys are automatically masked in log outputs, command summaries, and `fortify config list` output.

---

## 🐛 Reporting a Vulnerability

If you discover a potential security vulnerability in Fortify AI CLI, please do **NOT** open a public GitHub issue.

Instead, please report the vulnerability privately:

1. **Email / Contact**: Reach out directly to [Jatin Awankar](https://github.com/jatin-awankar) or open a private GitHub security advisory under the repository's **Security > Advisories** tab.
2. **Provide Details**:
   - Summary of the vulnerability.
   - Proof-of-concept steps to reproduce.
   - Impact assessment (e.g. credential exposure, command injection).

### Response Timeline
- **Acknowledgement**: Within 24-48 hours.
- **Triage & Patch**: High-priority patches aim to be released within 3-5 business days.

Thank you for keeping Fortify AI CLI and the developer community safe! 🚀
