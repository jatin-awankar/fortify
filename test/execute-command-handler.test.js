import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { executeCommandHandler } from "../src/tools/execute-command-handler.js";
import { CommandAllowlist } from "../src/config/command-allowlist.js";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

let tmpDir;

async function setup() {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "fortify-exec-test-"));
}

async function teardown() {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────
// executeCommandHandler
// ─────────────────────────────────────────────────────────────────

describe("executeCommandHandler", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("executes a simple command and captures stdout", async () => {
    const result = await executeCommandHandler(
      { command: "echo hello world" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("hello world"));
  });

  it("captures stderr", async () => {
    await writeFile(path.join(tmpDir, "_stderr_test.js"), "process.stderr.write('err msg');", "utf8");

    const result = await executeCommandHandler(
      { command: "node _stderr_test.js" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("err msg"));
    assert.ok(result.output.includes("[stderr]"));
  });

  it("reports non-zero exit code", async () => {
    await writeFile(path.join(tmpDir, "_exit_test.js"), "process.exit(1);", "utf8");

    const result = await executeCommandHandler(
      { command: "node _exit_test.js" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Exit code: 1]"));
  });

  it("runs in the project root by default", async () => {
    await writeFile(path.join(tmpDir, "marker.txt"), "found", "utf8");

    const isWindows = process.platform === "win32";
    const cmd = isWindows ? "type marker.txt" : "cat marker.txt";
    const result = await executeCommandHandler(
      { command: cmd },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("found"));
  });

  it("respects custom working directory", async () => {
    await mkdir(path.join(tmpDir, "subdir"), { recursive: true });
    await writeFile(path.join(tmpDir, "subdir", "data.txt"), "subdir-data", "utf8");

    const isWindows = process.platform === "win32";
    const cmd = isWindows ? "type data.txt" : "cat data.txt";
    const result = await executeCommandHandler(
      { command: cmd, cwd: "subdir" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("subdir-data"));
  });

  it("rejects working directory outside project root", async () => {
    const result = await executeCommandHandler(
      { command: "echo test", cwd: "../../" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Error]"));
    assert.ok(result.output.includes("outside"));
  });

  it("integrates with CommandAllowlist — blocks disallowed commands", async () => {
    const allowlist = new CommandAllowlist();
    const result = await executeCommandHandler(
      { command: "some-evil-binary --destroy" },
      { cwd: tmpDir, commandAllowlist: allowlist },
    );

    assert.ok(result.output.includes("[Blocked]"));
  });

  it("integrates with CommandAllowlist — allows safe commands", async () => {
    const allowlist = new CommandAllowlist();
    const result = await executeCommandHandler(
      { command: "echo allowed" },
      { cwd: tmpDir, commandAllowlist: allowlist },
    );

    assert.ok(result.output.includes("allowed"));
    assert.ok(!result.output.includes("[Blocked]"));
  });

  it("integrates with CommandAllowlist — blocks dangerous patterns", async () => {
    const allowlist = new CommandAllowlist();
    const result = await executeCommandHandler(
      { command: "rm -rf /" },
      { cwd: tmpDir, commandAllowlist: allowlist },
    );

    assert.ok(result.output.includes("[Blocked]"));
  });

  it("returns error for empty command", async () => {
    const result = await executeCommandHandler(
      { command: "" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Error]"));
  });

  it("returns (no output) for silent commands", async () => {
    const result = await executeCommandHandler(
      { command: "node -e \"\"" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("(no output)") || result.output.trim() === "");
  });

  it("handles node script execution", async () => {
    const result = await executeCommandHandler(
      { command: "node -e \"console.log(2 + 2)\"" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("4"));
  });
});
