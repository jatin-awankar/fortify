import { execSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { loadRuntimeConfig } from "../config/local-config.js";
import { getRuntimeOptions } from "../utils/runtime-options.js";

/**
 * Check result status.
 * @typedef {"pass" | "fail" | "optional" | "skip"} CheckStatus
 */

/**
 * Individual diagnostic check result.
 * @typedef {{ name: string, status: CheckStatus, detail: string }} CheckResult
 */

/**
 * Symbols for rendering check status.
 */
const STATUS_SYMBOLS = {
  pass: "✓",
  fail: "✗",
  optional: "○",
  skip: "–",
};

/**
 * DoctorService — runs a suite of health checks to validate the Fortify setup.
 *
 * Usage:
 *   const doctor = new DoctorService();
 *   const result = await doctor.runDiagnostics();
 */
export class DoctorService {
  constructor({
    cwd = process.cwd(),
    env = process.env,
    stdout = process.stdout,
    configLoader = loadRuntimeConfig,
  } = {}) {
    this.cwd = cwd;
    this.env = env;
    this.stdout = stdout;
    this.configLoader = configLoader;
  }

  /**
   * Run all diagnostic checks.
   * @returns {Promise<{ ok: boolean, checks: CheckResult[], passed: number, failed: number, optional: number }>}
   */
  async runDiagnostics() {
    const checks = [];

    // 1. Node.js version
    checks.push(this.#checkNodeVersion());

    // 2. Config file
    checks.push(await this.#checkConfigFile());

    // 3. API keys
    const config = await this.#loadConfigSafe();
    checks.push(this.#checkApiKey("OpenAI", config?.apiKeys?.openai, "OPENAI_API_KEY"));
    checks.push(this.#checkApiKey("Anthropic", config?.apiKeys?.anthropic, "ANTHROPIC_API_KEY"));
    checks.push(this.#checkApiKey("Gemini", config?.apiKeys?.gemini, "GEMINI_API_KEY"));

    // 4. Ollama server
    checks.push(await this.#checkOllamaServer(config));

    // 5. Git
    checks.push(this.#checkGitAvailable());
    checks.push(await this.#checkGitRepo());

    // 6. Workspace
    checks.push(await this.#checkWorkspaceInit());
    checks.push(await this.#checkMemoryFile());

    // 7. Test command
    checks.push(await this.#checkTestCommand());

    // Compute summary
    const passed = checks.filter((c) => c.status === "pass").length;
    const failed = checks.filter((c) => c.status === "fail").length;
    const optional = checks.filter((c) => c.status === "optional").length;

    const result = {
      ok: failed === 0,
      checks,
      passed,
      failed,
      optional,
    };

    // Render output
    if (getRuntimeOptions().json) {
      this.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      this.#renderChecks(checks, { passed, failed, optional });
    }

    return result;
  }

  // ─── Individual checks ─────────────────────────────────────────

  #checkNodeVersion() {
    const version = process.version;
    const major = parseInt(version.slice(1).split(".")[0], 10);

    if (major >= 20) {
      return { name: "Node.js version", status: "pass", detail: `${version} (>= 20.0.0)` };
    }

    return { name: "Node.js version", status: "fail", detail: `${version} — requires >= 20.0.0` };
  }

  async #checkConfigFile() {
    const os = await import("node:os");
    const homeDir = this.env.FORTIFY_HOME || os.homedir();
    const configDir = path.join(homeDir, ".fortify");
    const configPath = path.join(configDir, "config.json");

    try {
      await access(configPath);
      // Validate it's parseable
      const raw = await readFile(configPath, "utf8");
      JSON.parse(raw);
      return { name: "Config file", status: "pass", detail: configPath };
    } catch (err) {
      if (err?.code === "ENOENT") {
        return { name: "Config file", status: "fail", detail: `Not found: ${configPath}` };
      }
      if (err instanceof SyntaxError) {
        return { name: "Config file", status: "fail", detail: `Invalid JSON: ${configPath}` };
      }
      return { name: "Config file", status: "fail", detail: err.message };
    }
  }

  #checkApiKey(providerName, configValue, envVar) {
    const envValue = this.env[envVar];
    if ((configValue && configValue.trim()) || (envValue && envValue.trim())) {
      return { name: `${providerName} API key`, status: "pass", detail: "configured" };
    }
    return { name: `${providerName} API key`, status: "fail", detail: `missing (set ${envVar} or config)` };
  }

  async #checkOllamaServer(config) {
    const endpoint = config?.endpoints?.ollama || "http://localhost:11434";

    try {
      const response = await fetch(`${endpoint}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const data = await response.json();
        const modelCount = data?.models?.length || 0;
        return { name: "Ollama server", status: "pass", detail: `${endpoint} (${modelCount} models)` };
      }
      return { name: "Ollama server", status: "optional", detail: `unreachable at ${endpoint}` };
    } catch {
      return { name: "Ollama server", status: "optional", detail: `unreachable at ${endpoint}` };
    }
  }

  #checkGitAvailable() {
    try {
      const version = execSync("git --version", { encoding: "utf8", timeout: 5000 }).trim();
      const match = version.match(/git version ([\d.]+)/);
      return { name: "Git", status: "pass", detail: match ? `v${match[1]}` : version };
    } catch {
      return { name: "Git", status: "fail", detail: "git not found in PATH" };
    }
  }

  async #checkGitRepo() {
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: this.cwd,
        encoding: "utf8",
        timeout: 5000,
      }).trim();
      return { name: "Git repository", status: "pass", detail: `branch: ${branch}` };
    } catch {
      return { name: "Git repository", status: "fail", detail: "not inside a git repository" };
    }
  }

  async #checkWorkspaceInit() {
    const fortifyDir = path.join(this.cwd, ".fortify");
    try {
      await access(fortifyDir);
      return { name: "Workspace initialized", status: "pass", detail: ".fortify/" };
    } catch {
      return { name: "Workspace initialized", status: "optional", detail: ".fortify/ not found (run 'fortify init')" };
    }
  }

  async #checkMemoryFile() {
    const memoryPath = path.join(this.cwd, ".fortify", "memory.md");
    try {
      await access(memoryPath);
      const content = await readFile(memoryPath, "utf8");
      const entryCount = (content.match(/^## /gm) || []).length;
      return { name: "Memory file", status: "pass", detail: `${entryCount} entries` };
    } catch {
      return { name: "Memory file", status: "optional", detail: "not found (optional)" };
    }
  }

  async #checkTestCommand() {
    try {
      const pkgPath = path.join(this.cwd, "package.json");
      const raw = await readFile(pkgPath, "utf8");
      const pkg = JSON.parse(raw);
      const testScript = pkg.scripts?.test;

      if (testScript && testScript !== 'echo "Error: no test specified" && exit 1') {
        return { name: "Test command", status: "pass", detail: testScript };
      }
      return { name: "Test command", status: "optional", detail: "no test script in package.json" };
    } catch {
      return { name: "Test command", status: "optional", detail: "no package.json found" };
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────

  async #loadConfigSafe() {
    try {
      return await this.configLoader({ env: this.env });
    } catch {
      return null;
    }
  }

  #renderChecks(checks, { passed, failed, optional }) {
    this.stdout.write("\n  fortify doctor\n\n");

    for (const check of checks) {
      const symbol = STATUS_SYMBOLS[check.status] || "?";
      const color = check.status === "pass" ? "  \x1b[32m" :
                    check.status === "fail" ? "  \x1b[31m" :
                    "  \x1b[33m";
      const reset = "\x1b[0m";

      this.stdout.write(`${color}${symbol}${reset} ${check.name}: ${check.detail}\n`);
    }

    this.stdout.write(`\n  ${passed} passed · ${failed} failed · ${optional} optional\n\n`);
  }
}
