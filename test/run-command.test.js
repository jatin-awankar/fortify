import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAndRunNativeCli, printHelpText } from "../src/commands/native-cli-parser.js";

// ─────────────────────────────────────────────────────────────────
// fortify run command routing
// ─────────────────────────────────────────────────────────────────

describe("fortify run — CLI routing", () => {
  it("routes 'run' command to commandService.run()", async () => {
    let runCalled = false;
    let capturedArgs = null;

    const mockService = {
      run: async (input) => {
        runCalled = true;
        capturedArgs = input;
      },
    };

    await parseAndRunNativeCli(
      ["node", "fortify", "run", "fix the login bug"],
      mockService
    );

    assert.ok(runCalled, "should call commandService.run()");
    assert.equal(capturedArgs.prompt, "fix the login bug");
  });

  it("passes multi-word prompts as a single string", async () => {
    let capturedArgs = null;

    const mockService = {
      run: async (input) => { capturedArgs = input; },
    };

    await parseAndRunNativeCli(
      ["node", "fortify", "run", "add", "error", "handling", "to", "api.js"],
      mockService
    );

    assert.equal(capturedArgs.prompt, "add error handling to api.js");
  });

  it("errors when no prompt is provided", async () => {
    const originalExitCode = process.exitCode;
    const mockService = { run: async () => {} };

    await parseAndRunNativeCli(
      ["node", "fortify", "run"],
      mockService
    );

    assert.equal(process.exitCode, 1);
    process.exitCode = originalExitCode;
  });

  it("passes --provider and --model flags", async () => {
    let capturedArgs = null;

    const mockService = {
      run: async (input) => { capturedArgs = input; },
    };

    await parseAndRunNativeCli(
      ["node", "fortify", "run", "do something", "-p", "anthropic", "--model", "claude-3-5"],
      mockService
    );

    assert.equal(capturedArgs.provider, "anthropic");
    assert.equal(capturedArgs.model, "claude-3-5");
  });

  it("passes --timeout flag as integer", async () => {
    let capturedArgs = null;

    const mockService = {
      run: async (input) => { capturedArgs = input; },
    };

    await parseAndRunNativeCli(
      ["node", "fortify", "run", "fix bugs", "--timeout", "120"],
      mockService
    );

    assert.equal(capturedArgs.timeout, 120);
  });

  it("passes --max-iterations flag as integer", async () => {
    let capturedArgs = null;

    const mockService = {
      run: async (input) => { capturedArgs = input; },
    };

    await parseAndRunNativeCli(
      ["node", "fortify", "run", "fix bugs", "--max-iterations", "10"],
      mockService
    );

    assert.equal(capturedArgs.maxIterations, 10);
  });

  it("always sets yes: true for headless mode", async () => {
    let capturedArgs = null;

    const mockService = {
      run: async (input) => { capturedArgs = input; },
    };

    await parseAndRunNativeCli(
      ["node", "fortify", "run", "something"],
      mockService
    );

    assert.equal(capturedArgs.yes, true);
  });
});

// ─────────────────────────────────────────────────────────────────
// fortify doctor command routing
// ─────────────────────────────────────────────────────────────────

describe("fortify doctor — CLI routing", () => {
  it("routes 'doctor' command to commandService.doctor()", async () => {
    let doctorCalled = false;

    const mockService = {
      doctor: async () => { doctorCalled = true; },
    };

    await parseAndRunNativeCli(
      ["node", "fortify", "doctor"],
      mockService
    );

    assert.ok(doctorCalled, "should call commandService.doctor()");
  });
});

// ─────────────────────────────────────────────────────────────────
// Help text includes new commands
// ─────────────────────────────────────────────────────────────────

describe("help text — includes run and doctor", () => {
  it("includes run command in help text", () => {
    const originalWrite = process.stdout.write;
    let output = "";
    process.stdout.write = (data) => { output += data; return true; };

    try {
      printHelpText();
    } finally {
      process.stdout.write = originalWrite;
    }

    assert.ok(output.includes("run <prompt>"), "help should list run command");
    assert.ok(output.includes("doctor"), "help should list doctor command");
  });
});
