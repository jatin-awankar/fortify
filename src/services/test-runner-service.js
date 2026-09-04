/**
 * Test Runner Service — auto-detect and run project test commands.
 *
 * Provides:
 * - Auto-detection of test commands from project configuration files
 *   (package.json, Makefile, pytest.ini, Cargo.toml, etc.)
 * - Explicit override via `.fortify/config.json` → `testCommand`
 * - Test execution with timeout and output capture
 * - Test output parsing for common test runner formats
 *
 * Zero external dependencies — uses Node.js built-in modules.
 */

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Default test execution timeout (120 seconds).
 * Tests can be slow — double the normal command timeout.
 */
const DEFAULT_TEST_TIMEOUT_MS = 120_000;

/**
 * Maximum combined stdout + stderr (100KB).
 * Test output is verbose — double the normal command limit.
 */
const MAX_TEST_OUTPUT_BYTES = 102_400;

/**
 * npm test default stub — indicates no real test command is configured.
 */
const NPM_TEST_DEFAULT_STUB = 'echo "Error: no test specified" && exit 1';

export class TestRunnerService {
  /**
   * @param {object} [options]
   * @param {object} [options.fsPromises] - Filesystem module (for testing)
   * @param {Function} [options.spawnFn] - Spawn function (for testing)
   */
  constructor({
    fsPromises = { readFile },
    spawnFn = spawn,
  } = {}) {
    this.fs = fsPromises;
    this.spawnFn = spawnFn;
  }

  /**
   * Auto-detect the test command for a project.
   *
   * Detection chain (first match wins):
   * 1. `.fortify/config.json` → `testCommand`
   * 2. `package.json` → `scripts.test` (if not the default stub)
   * 3. `Makefile` or `Justfile` → `test` target
   * 4. `pytest.ini` or `pyproject.toml` → `pytest`
   * 5. `Cargo.toml` → `cargo test`
   * 6. `go.mod` → `go test ./...`
   *
   * @param {object} [options]
   * @param {string} [options.cwd] - Project root directory
   * @returns {Promise<string|null>} Test command string or null
   */
  async detectTestCommand({ cwd = process.cwd() } = {}) {
    // 1. Explicit config override
    const configCommand = await this.#detectFromFortifyConfig(cwd);
    if (configCommand) return configCommand;

    // 2. package.json
    const npmCommand = await this.#detectFromPackageJson(cwd);
    if (npmCommand) return npmCommand;

    // 3. Makefile / Justfile
    const makeCommand = await this.#detectFromMakefile(cwd);
    if (makeCommand) return makeCommand;

    // 4. Python (pytest)
    const pythonCommand = await this.#detectFromPython(cwd);
    if (pythonCommand) return pythonCommand;

    // 5. Rust (Cargo)
    const cargoCommand = await this.#detectFromCargo(cwd);
    if (cargoCommand) return cargoCommand;

    // 6. Go
    const goCommand = await this.#detectFromGo(cwd);
    if (goCommand) return goCommand;

    return null;
  }

  /**
   * Run the test command and capture results.
   *
   * @param {object} options
   * @param {string} options.cwd - Working directory
   * @param {string} options.command - Test command to run
   * @param {number} [options.timeoutMs] - Execution timeout
   * @returns {Promise<TestResult>}
   *
   * @typedef {{
   *   passed: boolean,
   *   exitCode: number,
   *   stdout: string,
   *   stderr: string,
   *   durationMs: number,
   *   truncated: boolean,
   *   timedOut: boolean,
   *   summary: TestSummary|null,
   * }} TestResult
   *
   * @typedef {{
   *   total: number,
   *   passed: number,
   *   failed: number,
   *   skipped: number,
   * }} TestSummary
   */
  async runTests({ cwd, command, timeoutMs = DEFAULT_TEST_TIMEOUT_MS } = {}) {
    if (!command || typeof command !== "string" || !command.trim()) {
      return {
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: "No test command provided.",
        durationMs: 0,
        truncated: false,
        timedOut: false,
        summary: null,
      };
    }

    const startTime = Date.now();
    const trimmedCommand = command.trim();

    // Determine shell
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "cmd.exe" : "/bin/sh";
    const shellArgs = isWindows ? ["/c", trimmedCommand] : ["-c", trimmedCommand];

    try {
      const result = await this.#runProcess(shell, shellArgs, {
        cwd,
        timeoutMs,
        maxOutputBytes: MAX_TEST_OUTPUT_BYTES,
      });

      const durationMs = Date.now() - startTime;
      const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
      const summary = this.parseTestSummary(combinedOutput);

      return {
        passed: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs,
        truncated: result.truncated,
        timedOut: result.timedOut,
        summary,
      };
    } catch (error) {
      return {
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: error.message,
        durationMs: Date.now() - startTime,
        truncated: false,
        timedOut: false,
        summary: null,
      };
    }
  }

  /**
   * Parse test summary from common test runner output formats.
   *
   * Supports:
   * - Node.js `--test` runner: "# tests 10 # pass 8 # fail 2"
   * - Jest: "Tests: 2 failed, 8 passed, 10 total"
   * - pytest: "10 passed, 2 failed"
   * - cargo test: "test result: ok. 8 passed; 2 failed;"
   * - go test: "ok" / "FAIL" lines
   *
   * @param {string} output - Combined test output
   * @returns {TestSummary|null}
   */
  parseTestSummary(output) {
    if (!output || typeof output !== "string") return null;

    // Node.js --test runner format
    const nodeTests = output.match(/# tests (\d+)/);
    const nodePass = output.match(/# pass (\d+)/);
    const nodeFail = output.match(/# fail (\d+)/);
    const nodeSkip = output.match(/# skip(?:ped)? (\d+)/);

    if (nodeTests || nodePass || nodeFail) {
      return {
        total: parseInt(nodeTests?.[1] || "0", 10),
        passed: parseInt(nodePass?.[1] || "0", 10),
        failed: parseInt(nodeFail?.[1] || "0", 10),
        skipped: parseInt(nodeSkip?.[1] || "0", 10),
      };
    }

    // Jest format: "Tests:  2 failed, 8 passed, 10 total"
    const jestMatch = output.match(/Tests:\s+(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+skipped,?\s*)?(?:(\d+)\s+passed,?\s*)?(\d+)\s+total/);
    if (jestMatch) {
      return {
        total: parseInt(jestMatch[4] || "0", 10),
        passed: parseInt(jestMatch[3] || "0", 10),
        failed: parseInt(jestMatch[1] || "0", 10),
        skipped: parseInt(jestMatch[2] || "0", 10),
      };
    }

    // pytest format: "10 passed, 2 failed" or "10 passed"
    const pytestPassed = output.match(/(\d+)\s+passed/);
    const pytestFailed = output.match(/(\d+)\s+failed/);
    const pytestSkipped = output.match(/(\d+)\s+skipped/);

    if (pytestPassed || pytestFailed) {
      const passed = parseInt(pytestPassed?.[1] || "0", 10);
      const failed = parseInt(pytestFailed?.[1] || "0", 10);
      const skipped = parseInt(pytestSkipped?.[1] || "0", 10);
      return {
        total: passed + failed + skipped,
        passed,
        failed,
        skipped,
      };
    }

    // cargo test format: "test result: ok. 8 passed; 2 failed; 0 ignored;"
    const cargoMatch = output.match(/test result:.*?(\d+)\s+passed;\s*(\d+)\s+failed;\s*(\d+)\s+ignored/);
    if (cargoMatch) {
      const passed = parseInt(cargoMatch[1], 10);
      const failed = parseInt(cargoMatch[2], 10);
      const skipped = parseInt(cargoMatch[3], 10);
      return {
        total: passed + failed + skipped,
        passed,
        failed,
        skipped,
      };
    }

    // go test format: count "ok" and "FAIL" lines
    const goOk = (output.match(/^ok\s+/gm) || []).length;
    const goFail = (output.match(/^FAIL\s+/gm) || []).length;

    if (goOk > 0 || goFail > 0) {
      return {
        total: goOk + goFail,
        passed: goOk,
        failed: goFail,
        skipped: 0,
      };
    }

    return null;
  }

  /**
   * Format test results for display or LLM feedback.
   *
   * @param {TestResult} result
   * @returns {string}
   */
  formatTestResult(result) {
    const parts = [];

    if (result.passed) {
      parts.push("Tests PASSED ✓");
    } else {
      parts.push("Tests FAILED ✗");
    }

    parts.push(`Exit code: ${result.exitCode}`);
    parts.push(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);

    if (result.summary) {
      const s = result.summary;
      parts.push(`Results: ${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped (${s.total} total)`);
    }

    if (result.timedOut) {
      parts.push("[Timed out]");
    }

    if (result.truncated) {
      parts.push("[Output truncated]");
    }

    // Include relevant output (for LLM consumption)
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    if (output) {
      // Limit to last 4000 chars for LLM consumption
      const maxChars = 4000;
      const trimmedOutput = output.length > maxChars
        ? "...\n" + output.slice(-maxChars)
        : output;
      parts.push(`\n--- Test Output ---\n${trimmedOutput}`);
    }

    return parts.join("\n");
  }

  // --- Private detection methods ---

  async #detectFromFortifyConfig(cwd) {
    try {
      const configPath = path.join(cwd, ".fortify", "config.json");
      const raw = await this.fs.readFile(configPath, "utf8");
      const config = JSON.parse(raw);
      if (config.testCommand && typeof config.testCommand === "string") {
        return config.testCommand.trim() || null;
      }
    } catch {
      // No config or invalid JSON — continue detection chain
    }
    return null;
  }

  async #detectFromPackageJson(cwd) {
    try {
      const pkgPath = path.join(cwd, "package.json");
      const raw = await this.fs.readFile(pkgPath, "utf8");
      const pkg = JSON.parse(raw);
      const testScript = pkg?.scripts?.test;

      if (testScript && typeof testScript === "string" && testScript.trim() !== NPM_TEST_DEFAULT_STUB) {
        // Use npm test for standard scripts, or the raw command
        return "npm test";
      }
    } catch {
      // No package.json — continue
    }
    return null;
  }

  async #detectFromMakefile(cwd) {
    for (const name of ["Makefile", "makefile", "GNUmakefile", "Justfile", "justfile"]) {
      try {
        const content = await this.fs.readFile(path.join(cwd, name), "utf8");
        // Look for a "test:" target
        if (/^test\s*:/m.test(content)) {
          return name.toLowerCase().includes("just") ? "just test" : "make test";
        }
      } catch {
        // File doesn't exist — continue
      }
    }
    return null;
  }

  async #detectFromPython(cwd) {
    // Check for pytest indicators
    for (const name of ["pytest.ini", "setup.cfg", "pyproject.toml"]) {
      try {
        const content = await this.fs.readFile(path.join(cwd, name), "utf8");
        if (content.includes("[tool.pytest") || content.includes("[pytest]") || name === "pytest.ini") {
          return "pytest";
        }
      } catch {
        // File doesn't exist — continue
      }
    }

    // Check for tests directory
    try {
      const pyproject = await this.fs.readFile(path.join(cwd, "pyproject.toml"), "utf8");
      if (pyproject) return "pytest";
    } catch {
      // No pyproject.toml
    }

    return null;
  }

  async #detectFromCargo(cwd) {
    try {
      await this.fs.readFile(path.join(cwd, "Cargo.toml"), "utf8");
      return "cargo test";
    } catch {
      return null;
    }
  }

  async #detectFromGo(cwd) {
    try {
      await this.fs.readFile(path.join(cwd, "go.mod"), "utf8");
      return "go test ./...";
    } catch {
      return null;
    }
  }

  /**
   * Run a process with timeout and output capture.
   */
  #runProcess(command, args, { cwd, timeoutMs, maxOutputBytes }) {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const child = this.spawnFn(command, args, {
        cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
          setTimeout(() => {
            try { child.kill("SIGKILL"); } catch { /* already dead */ }
          }, 2000);
        } catch { /* already dead */ }
      }, timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk) => {
        if (stdout.length + stderr.length < maxOutputBytes) {
          stdout += chunk;
        } else {
          truncated = true;
        }
      });

      child.stderr.on("data", (chunk) => {
        if (stdout.length + stderr.length < maxOutputBytes) {
          stderr += chunk;
        } else {
          truncated = true;
        }
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: exitCode ?? 1,
            truncated,
            timedOut,
          });
        }
      });
    });
  }
}

/**
 * Create a TestRunnerService instance.
 * @param {object} [options]
 * @returns {TestRunnerService}
 */
export function createTestRunnerService(options) {
  return new TestRunnerService(options);
}

export { DEFAULT_TEST_TIMEOUT_MS, MAX_TEST_OUTPUT_BYTES, NPM_TEST_DEFAULT_STUB };
