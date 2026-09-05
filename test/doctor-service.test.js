import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DoctorService } from "../src/services/doctor-service.js";

function createMockStdout() {
  return {
    chunks: [],
    isTTY: false,
    columns: 80,
    write(data) { this.chunks.push(data); return true; },
    get output() { return this.chunks.join(""); },
  };
}

// ─────────────────────────────────────────────────────────────────
// Diagnostic checks
// ─────────────────────────────────────────────────────────────────

describe("DoctorService — diagnostic checks", () => {
  it("returns a structured result with all checks", async () => {
    const stdout = createMockStdout();

    const doctor = new DoctorService({
      cwd: process.cwd(),
      stdout,
      configLoader: async () => ({
        apiKeys: { openai: "sk-test" },
      }),
    });

    const result = await doctor.runDiagnostics();

    assert.ok(Array.isArray(result.checks), "should have checks array");
    assert.ok(result.checks.length >= 10, `should have at least 10 checks, got ${result.checks.length}`);
    assert.ok(typeof result.passed === "number");
    assert.ok(typeof result.failed === "number");
    assert.ok(typeof result.optional === "number");
    assert.ok(typeof result.ok === "boolean");
  });

  it("detects Node.js version as passing (>= 20)", async () => {
    const stdout = createMockStdout();

    const doctor = new DoctorService({
      stdout,
      configLoader: async () => ({}),
    });

    const result = await doctor.runDiagnostics();
    const nodeCheck = result.checks.find((c) => c.name === "Node.js version");

    assert.ok(nodeCheck, "should have Node.js version check");
    assert.equal(nodeCheck.status, "pass");
    assert.ok(nodeCheck.detail.includes(process.version));
  });

  it("detects API key as configured when present", async () => {
    const stdout = createMockStdout();

    const doctor = new DoctorService({
      stdout,
      configLoader: async () => ({
        apiKeys: { openai: "sk-test-key" },
      }),
    });

    const result = await doctor.runDiagnostics();
    const openaiCheck = result.checks.find((c) => c.name === "OpenAI API key");

    assert.ok(openaiCheck);
    assert.equal(openaiCheck.status, "pass");
  });

  it("detects missing API key", async () => {
    const stdout = createMockStdout();

    const doctor = new DoctorService({
      stdout,
      env: {}, // No env vars
      configLoader: async () => ({ apiKeys: {} }),
    });

    const result = await doctor.runDiagnostics();
    const anthropicCheck = result.checks.find((c) => c.name === "Anthropic API key");

    assert.ok(anthropicCheck);
    assert.equal(anthropicCheck.status, "fail");
    assert.ok(anthropicCheck.detail.includes("missing"));
  });

  it("detects Git as available", async () => {
    const stdout = createMockStdout();

    const doctor = new DoctorService({
      stdout,
      configLoader: async () => ({}),
    });

    const result = await doctor.runDiagnostics();
    const gitCheck = result.checks.find((c) => c.name === "Git");

    assert.ok(gitCheck);
    assert.equal(gitCheck.status, "pass");
  });

  it("detects current directory as git repository", async () => {
    const stdout = createMockStdout();

    const doctor = new DoctorService({
      cwd: process.cwd(),
      stdout,
      configLoader: async () => ({}),
    });

    const result = await doctor.runDiagnostics();
    const repoCheck = result.checks.find((c) => c.name === "Git repository");

    assert.ok(repoCheck);
    assert.equal(repoCheck.status, "pass");
  });

  it("detects test command from package.json", async () => {
    const stdout = createMockStdout();

    const doctor = new DoctorService({
      cwd: process.cwd(), // Fortify's own package.json has a test script
      stdout,
      configLoader: async () => ({}),
    });

    const result = await doctor.runDiagnostics();
    const testCheck = result.checks.find((c) => c.name === "Test command");

    assert.ok(testCheck);
    assert.equal(testCheck.status, "pass");
  });

  it("renders human-readable output to stdout", async () => {
    const stdout = createMockStdout();

    const doctor = new DoctorService({
      stdout,
      configLoader: async () => ({}),
    });

    await doctor.runDiagnostics();

    const output = stdout.output;
    assert.ok(output.includes("fortify doctor"), "should render header");
    assert.ok(output.includes("passed"), "should render summary");
  });

  it("handles config loader errors gracefully", async () => {
    const stdout = createMockStdout();

    const doctor = new DoctorService({
      stdout,
      configLoader: async () => { throw new Error("Config failed"); },
    });

    // Should not throw
    const result = await doctor.runDiagnostics();

    assert.ok(Array.isArray(result.checks));
    assert.ok(result.checks.length > 0);
  });
});
