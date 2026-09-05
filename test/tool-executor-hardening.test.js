import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolExecutor } from "../src/services/tool-executor.js";
import { ToolRegistry, PERMISSION_LEVEL } from "../src/services/tool-registry.js";
import { PERMISSION_RESPONSE } from "../src/renderers/permission-prompt.js";

function createMockStdout() {
  return {
    chunks: [],
    isTTY: false,
    columns: 80,
    write(data) { this.chunks.push(data); return true; },
  };
}

function createTestRegistry() {
  const registry = new ToolRegistry();
  // Register a write-level tool (requires permission)
  registry.register({
    name: "write_file",
    description: "Write file",
    parameters: { type: "object", properties: {} },
    permissionLevel: PERMISSION_LEVEL.WRITE,
    requiresPermission: true,
  });
  // Register a read-level tool (auto-approved by default)
  registry.register({
    name: "read_file",
    description: "Read file",
    parameters: { type: "object", properties: {} },
    permissionLevel: PERMISSION_LEVEL.READ,
    requiresPermission: true,
  });
  // Register a tool for timeout testing
  registry.register({
    name: "slow_tool",
    description: "Slow tool for testing",
    parameters: { type: "object", properties: {} },
    permissionLevel: PERMISSION_LEVEL.READ,
    requiresPermission: false,
  });
  return registry;
}

// ─────────────────────────────────────────────────────────────────
// Auto-approve mode
// ─────────────────────────────────────────────────────────────────

describe("ToolExecutor — auto-approve mode", () => {
  it("skips permission prompt when context.autoApprove is true", async () => {
    const stdout = createMockStdout();
    const registry = createTestRegistry();
    let permissionRequested = false;

    const executor = new ToolExecutor({
      toolRegistry: registry,
      permissionPrompt: {
        requestPermission: async () => {
          permissionRequested = true;
          return PERMISSION_RESPONSE.ALLOW;
        },
      },
      stdout,
      env: { NO_COLOR: "1" },
    });

    executor.registerHandler("write_file", async () => ({ output: "Written" }));

    const result = await executor.execute(
      { name: "write_file", arguments: { path: "test.txt", content: "hello" } },
      { autoApprove: true },
    );

    assert.equal(permissionRequested, false, "should NOT prompt for permission in auto-approve");
    assert.equal(result.success, true);
  });

  it("prompts for permission when autoApprove is not set", async () => {
    const stdout = createMockStdout();
    const registry = createTestRegistry();
    let permissionRequested = false;

    const executor = new ToolExecutor({
      toolRegistry: registry,
      permissionPrompt: {
        requestPermission: async () => {
          permissionRequested = true;
          return PERMISSION_RESPONSE.ALLOW;
        },
      },
      stdout,
      env: { NO_COLOR: "1" },
    });

    executor.registerHandler("write_file", async () => ({ output: "Written" }));

    await executor.execute(
      { name: "write_file", arguments: { path: "test.txt", content: "hello" } },
      {},
    );

    assert.equal(permissionRequested, true, "should prompt for permission normally");
  });

  it("prompts for permission when autoApprove is false", async () => {
    const stdout = createMockStdout();
    const registry = createTestRegistry();
    let permissionRequested = false;

    const executor = new ToolExecutor({
      toolRegistry: registry,
      permissionPrompt: {
        requestPermission: async () => {
          permissionRequested = true;
          return PERMISSION_RESPONSE.ALLOW;
        },
      },
      stdout,
      env: { NO_COLOR: "1" },
    });

    executor.registerHandler("write_file", async () => ({ output: "Written" }));

    await executor.execute(
      { name: "write_file", arguments: { path: "test.txt", content: "hello" } },
      { autoApprove: false },
    );

    assert.equal(permissionRequested, true, "should prompt for permission when autoApprove=false");
  });
});

// ─────────────────────────────────────────────────────────────────
// Per-tool execution timeout
// ─────────────────────────────────────────────────────────────────

describe("ToolExecutor — per-tool timeout", () => {
  it("times out a slow tool using custom timeout", async () => {
    const stdout = createMockStdout();
    const registry = createTestRegistry();

    const executor = new ToolExecutor({
      toolRegistry: registry,
      permissionPrompt: {
        requestPermission: async () => PERMISSION_RESPONSE.ALLOW,
      },
      stdout,
      env: { NO_COLOR: "1" },
    });

    executor.registerHandler("slow_tool", async () => {
      // Simulate a slow operation (500ms) — timeout will fire before this
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { output: "Should not reach here" };
    });

    const result = await executor.execute(
      { name: "slow_tool", arguments: {} },
      { toolTimeoutMs: { slow_tool: 50 } }, // Override to 50ms for test speed
    );

    assert.equal(result.success, false);
    assert.ok(result.error.includes("timed out"), "error should mention timeout");
  });

  it("succeeds for fast tools within timeout", async () => {
    const stdout = createMockStdout();
    const registry = createTestRegistry();

    const executor = new ToolExecutor({
      toolRegistry: registry,
      permissionPrompt: {
        requestPermission: async () => PERMISSION_RESPONSE.ALLOW,
      },
      stdout,
      env: { NO_COLOR: "1" },
    });

    executor.registerHandler("read_file", async () => ({ output: "file content" }));

    const result = await executor.execute(
      { name: "read_file", arguments: { path: "test.txt" } },
      { autoApprove: true },
    );

    assert.equal(result.success, true);
    assert.equal(result.output, "file content");
  });

  it("respects custom timeout overrides per tool", async () => {
    const stdout = createMockStdout();
    const registry = createTestRegistry();

    const executor = new ToolExecutor({
      toolRegistry: registry,
      permissionPrompt: {
        requestPermission: async () => PERMISSION_RESPONSE.ALLOW,
      },
      stdout,
      env: { NO_COLOR: "1" },
    });

    executor.registerHandler("slow_tool", async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { output: "completed" };
    });

    // Custom timeout longer than the handler delay
    const result = await executor.execute(
      { name: "slow_tool", arguments: {} },
      { toolTimeoutMs: { slow_tool: 1000 } },
    );

    assert.equal(result.success, true);
    assert.equal(result.output, "completed");
  });
});
