import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TestRunnerService, DEFAULT_TEST_TIMEOUT_MS, MAX_TEST_OUTPUT_BYTES, NPM_TEST_DEFAULT_STUB } from "../src/services/test-runner-service.js";
import { EventEmitter } from "node:events";

/**
 * Create a mock filesystem for testing auto-detection.
 * @param {Record<string, string>} files - path → content map
 */
function createMockFs(files = {}) {
  return {
    readFile: async (filePath, encoding) => {
      // Normalize path separators for cross-platform matching
      const normalized = filePath.replace(/\\/g, "/");
      for (const [key, value] of Object.entries(files)) {
        const normalizedKey = key.replace(/\\/g, "/");
        if (normalized.endsWith(normalizedKey) || normalized === normalizedKey) {
          return value;
        }
      }
      const err = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      err.code = "ENOENT";
      throw err;
    },
  };
}

/**
 * Create a mock spawn function that simulates a child process.
 */
function createMockSpawn({ exitCode = 0, stdout = "", stderr = "", delay = 0 } = {}) {
  const calls = [];

  const spawnFn = (command, args, options) => {
    calls.push({ command, args, options });

    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};
    child.kill = () => {};

    setTimeout(() => {
      if (stdout) child.stdout.emit("data", stdout);
      if (stderr) child.stderr.emit("data", stderr);
      child.emit("close", exitCode);
    }, delay);

    return child;
  };

  return { spawnFn, calls };
}

describe("TestRunnerService", () => {
  describe("detectTestCommand", () => {
    it("should detect from .fortify/config.json first", async () => {
      const fs = createMockFs({
        ".fortify/config.json": JSON.stringify({ testCommand: "vitest run" }),
        "package.json": JSON.stringify({ scripts: { test: "jest" } }),
      });

      const service = new TestRunnerService({ fsPromises: fs });
      const cmd = await service.detectTestCommand({ cwd: "/project" });
      assert.equal(cmd, "vitest run");
    });

    it("should detect from package.json scripts.test", async () => {
      const fs = createMockFs({
        "package.json": JSON.stringify({ scripts: { test: "jest --coverage" } }),
      });

      const service = new TestRunnerService({ fsPromises: fs });
      const cmd = await service.detectTestCommand({ cwd: "/project" });
      assert.equal(cmd, "npm test");
    });

    it("should ignore the npm default test stub", async () => {
      const fs = createMockFs({
        "package.json": JSON.stringify({
          scripts: { test: NPM_TEST_DEFAULT_STUB },
        }),
      });

      const service = new TestRunnerService({ fsPromises: fs });
      const cmd = await service.detectTestCommand({ cwd: "/project" });
      assert.equal(cmd, null);
    });

    it("should detect from Makefile with test target", async () => {
      const fs = createMockFs({
        "Makefile": "build:\n\tgo build .\n\ntest:\n\tgo test ./...\n",
      });

      const service = new TestRunnerService({ fsPromises: fs });
      const cmd = await service.detectTestCommand({ cwd: "/project" });
      assert.equal(cmd, "make test");
    });

    it("should detect from Justfile with test target", async () => {
      const fs = createMockFs({
        "Justfile": "test:\n  cargo test\n",
      });

      const service = new TestRunnerService({ fsPromises: fs });
      const cmd = await service.detectTestCommand({ cwd: "/project" });
      assert.equal(cmd, "just test");
    });

    it("should detect pytest from pytest.ini", async () => {
      const fs = createMockFs({
        "pytest.ini": "[pytest]\naddopts = -v\n",
      });

      const service = new TestRunnerService({ fsPromises: fs });
      const cmd = await service.detectTestCommand({ cwd: "/project" });
      assert.equal(cmd, "pytest");
    });

    it("should detect pytest from pyproject.toml with tool.pytest section", async () => {
      const fs = createMockFs({
        "pyproject.toml": "[tool.pytest.ini_options]\naddopts = '-v'\n",
      });

      const service = new TestRunnerService({ fsPromises: fs });
      const cmd = await service.detectTestCommand({ cwd: "/project" });
      assert.equal(cmd, "pytest");
    });

    it("should detect cargo test from Cargo.toml", async () => {
      const fs = createMockFs({
        "Cargo.toml": "[package]\nname = \"my-crate\"\nversion = \"0.1.0\"\n",
      });

      const service = new TestRunnerService({ fsPromises: fs });
      const cmd = await service.detectTestCommand({ cwd: "/project" });
      assert.equal(cmd, "cargo test");
    });

    it("should detect go test from go.mod", async () => {
      const fs = createMockFs({
        "go.mod": "module github.com/user/project\n\ngo 1.22\n",
      });

      const service = new TestRunnerService({ fsPromises: fs });
      const cmd = await service.detectTestCommand({ cwd: "/project" });
      assert.equal(cmd, "go test ./...");
    });

    it("should return null when no test command is detected", async () => {
      const fs = createMockFs({}); // empty project

      const service = new TestRunnerService({ fsPromises: fs });
      const cmd = await service.detectTestCommand({ cwd: "/project" });
      assert.equal(cmd, null);
    });

    it("should prioritize .fortify/config.json over all other sources", async () => {
      const fs = createMockFs({
        ".fortify/config.json": JSON.stringify({ testCommand: "custom-runner" }),
        "package.json": JSON.stringify({ scripts: { test: "jest" } }),
        "Makefile": "test:\n\tmake check\n",
        "Cargo.toml": "[package]",
      });

      const service = new TestRunnerService({ fsPromises: fs });
      const cmd = await service.detectTestCommand({ cwd: "/project" });
      assert.equal(cmd, "custom-runner");
    });

    it("should handle invalid JSON in .fortify/config.json gracefully", async () => {
      const fs = createMockFs({
        ".fortify/config.json": "not valid json{{{",
        "package.json": JSON.stringify({ scripts: { test: "jest" } }),
      });

      const service = new TestRunnerService({ fsPromises: fs });
      const cmd = await service.detectTestCommand({ cwd: "/project" });
      assert.equal(cmd, "npm test");
    });

    it("should handle empty testCommand in config", async () => {
      const fs = createMockFs({
        ".fortify/config.json": JSON.stringify({ testCommand: "" }),
        "package.json": JSON.stringify({ scripts: { test: "jest" } }),
      });

      const service = new TestRunnerService({ fsPromises: fs });
      const cmd = await service.detectTestCommand({ cwd: "/project" });
      assert.equal(cmd, "npm test");
    });
  });

  describe("runTests", () => {
    it("should return passed=true when exit code is 0", async () => {
      const { spawnFn } = createMockSpawn({ exitCode: 0, stdout: "All tests passed" });
      const service = new TestRunnerService({ spawnFn });

      const result = await service.runTests({ cwd: "/project", command: "npm test" });

      assert.equal(result.passed, true);
      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes("All tests passed"));
    });

    it("should return passed=false when exit code is non-zero", async () => {
      const { spawnFn } = createMockSpawn({ exitCode: 1, stderr: "1 test failed" });
      const service = new TestRunnerService({ spawnFn });

      const result = await service.runTests({ cwd: "/project", command: "npm test" });

      assert.equal(result.passed, false);
      assert.equal(result.exitCode, 1);
    });

    it("should capture stdout and stderr separately", async () => {
      const { spawnFn } = createMockSpawn({
        exitCode: 0,
        stdout: "stdout output",
        stderr: "stderr output",
      });
      const service = new TestRunnerService({ spawnFn });

      const result = await service.runTests({ cwd: "/project", command: "npm test" });

      assert.equal(result.stdout, "stdout output");
      assert.equal(result.stderr, "stderr output");
    });

    it("should measure duration", async () => {
      const { spawnFn } = createMockSpawn({ exitCode: 0, delay: 10 });
      const service = new TestRunnerService({ spawnFn });

      const result = await service.runTests({ cwd: "/project", command: "npm test" });

      assert.ok(result.durationMs >= 0);
    });

    it("should return error when command is empty", async () => {
      const service = new TestRunnerService({});

      const result = await service.runTests({ cwd: "/project", command: "" });

      assert.equal(result.passed, false);
      assert.equal(result.stderr, "No test command provided.");
    });

    it("should return error when command is null", async () => {
      const service = new TestRunnerService({});

      const result = await service.runTests({ cwd: "/project", command: null });

      assert.equal(result.passed, false);
    });

    it("should pass correct shell args", async () => {
      const { spawnFn, calls } = createMockSpawn({ exitCode: 0 });
      const service = new TestRunnerService({ spawnFn });

      await service.runTests({ cwd: "/project", command: "npm test" });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].args[1], "npm test");
      assert.equal(calls[0].options.cwd, "/project");
    });

    it("should handle spawn errors gracefully", async () => {
      const spawnFn = () => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.stdout.setEncoding = () => {};
        child.stderr.setEncoding = () => {};
        child.kill = () => {};

        setTimeout(() => {
          child.emit("error", new Error("spawn failed"));
        }, 0);

        return child;
      };

      const service = new TestRunnerService({ spawnFn });
      const result = await service.runTests({ cwd: "/project", command: "npm test" });

      assert.equal(result.passed, false);
      assert.ok(result.stderr.includes("spawn failed"));
    });
  });

  describe("parseTestSummary", () => {
    it("should parse Node.js --test runner format", () => {
      const output = `
# Subtest: example
ok 1 - example
# tests 10
# suites 2
# pass 8
# fail 2
# cancelled 0
# skipped 0
# duration_ms 150`;

      const service = new TestRunnerService({});
      const summary = service.parseTestSummary(output);

      assert.deepEqual(summary, { total: 10, passed: 8, failed: 2, skipped: 0 });
    });

    it("should parse Jest format", () => {
      const output = `
PASS  src/index.test.js
Tests:  2 failed, 1 skipped, 8 passed, 11 total
Snapshots:   0 total
Time:        1.234 s`;

      const service = new TestRunnerService({});
      const summary = service.parseTestSummary(output);

      assert.deepEqual(summary, { total: 11, passed: 8, failed: 2, skipped: 1 });
    });

    it("should parse pytest format", () => {
      const output = "===== 8 passed, 2 failed in 3.21s =====";

      const service = new TestRunnerService({});
      const summary = service.parseTestSummary(output);

      assert.deepEqual(summary, { total: 10, passed: 8, failed: 2, skipped: 0 });
    });

    it("should parse pytest passed-only format", () => {
      const output = "===== 15 passed in 1.5s =====";

      const service = new TestRunnerService({});
      const summary = service.parseTestSummary(output);

      assert.deepEqual(summary, { total: 15, passed: 15, failed: 0, skipped: 0 });
    });

    it("should parse cargo test format", () => {
      const output = `running 10 tests
test it_works ... ok
test result: ok. 8 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out`;

      const service = new TestRunnerService({});
      const summary = service.parseTestSummary(output);

      assert.deepEqual(summary, { total: 10, passed: 8, failed: 2, skipped: 0 });
    });

    it("should parse go test format", () => {
      const output = `ok  	github.com/user/pkg1	0.5s
ok  	github.com/user/pkg2	1.2s
FAIL	github.com/user/pkg3	0.3s`;

      const service = new TestRunnerService({});
      const summary = service.parseTestSummary(output);

      assert.deepEqual(summary, { total: 3, passed: 2, failed: 1, skipped: 0 });
    });

    it("should return null for unrecognized output", () => {
      const service = new TestRunnerService({});
      const summary = service.parseTestSummary("some random output");
      assert.equal(summary, null);
    });

    it("should return null for empty output", () => {
      const service = new TestRunnerService({});
      assert.equal(service.parseTestSummary(""), null);
      assert.equal(service.parseTestSummary(null), null);
    });
  });

  describe("formatTestResult", () => {
    it("should format passing test result", () => {
      const service = new TestRunnerService({});
      const result = service.formatTestResult({
        passed: true,
        exitCode: 0,
        stdout: "all good",
        stderr: "",
        durationMs: 1500,
        truncated: false,
        timedOut: false,
        summary: { total: 10, passed: 10, failed: 0, skipped: 0 },
      });

      assert.ok(result.includes("Tests PASSED ✓"));
      assert.ok(result.includes("10 passed"));
      assert.ok(result.includes("0 failed"));
    });

    it("should format failing test result", () => {
      const service = new TestRunnerService({});
      const result = service.formatTestResult({
        passed: false,
        exitCode: 1,
        stdout: "failure details",
        stderr: "error output",
        durationMs: 2000,
        truncated: false,
        timedOut: false,
        summary: { total: 10, passed: 8, failed: 2, skipped: 0 },
      });

      assert.ok(result.includes("Tests FAILED ✗"));
      assert.ok(result.includes("2 failed"));
    });

    it("should include timeout notice", () => {
      const service = new TestRunnerService({});
      const result = service.formatTestResult({
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: "",
        durationMs: 120000,
        truncated: false,
        timedOut: true,
        summary: null,
      });

      assert.ok(result.includes("[Timed out]"));
    });

    it("should include truncation notice", () => {
      const service = new TestRunnerService({});
      const result = service.formatTestResult({
        passed: true,
        exitCode: 0,
        stdout: "output",
        stderr: "",
        durationMs: 1000,
        truncated: true,
        timedOut: false,
        summary: null,
      });

      assert.ok(result.includes("[Output truncated]"));
    });
  });

  describe("exports", () => {
    it("should export DEFAULT_TEST_TIMEOUT_MS", () => {
      assert.equal(DEFAULT_TEST_TIMEOUT_MS, 120_000);
    });

    it("should export MAX_TEST_OUTPUT_BYTES", () => {
      assert.equal(MAX_TEST_OUTPUT_BYTES, 102_400);
    });

    it("should export NPM_TEST_DEFAULT_STUB", () => {
      assert.ok(NPM_TEST_DEFAULT_STUB.includes("no test specified"));
    });
  });
});
