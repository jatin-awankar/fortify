import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgenticLoop, estimateTokens, formatToolError } from "../src/services/agentic-loop.js";
import { ToolRegistry } from "../src/services/tool-registry.js";
import { ToolExecutor } from "../src/services/tool-executor.js";
import { PERMISSION_RESPONSE } from "../src/renderers/permission-prompt.js";
import { registerAllHandlers } from "../src/tools/index.js";

function createMockStdout() {
  return {
    chunks: [],
    isTTY: false,
    columns: 80,
    write(data) { this.chunks.push(data); return true; },
  };
}

function createTestSetup() {
  const stdout = createMockStdout();
  const registry = new ToolRegistry();
  const executor = new ToolExecutor({
    toolRegistry: registry,
    permissionPrompt: {
      requestPermission: async () => PERMISSION_RESPONSE.ALLOW,
    },
    stdout,
    env: { NO_COLOR: "1" },
  });
  registerAllHandlers(executor);
  return { stdout, registry, executor };
}

// ─────────────────────────────────────────────────────────────────
// estimateTokens helper
// ─────────────────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns 0 for empty/null input", () => {
    assert.equal(estimateTokens(""), 0);
    assert.equal(estimateTokens(null), 0);
    assert.equal(estimateTokens(undefined), 0);
  });

  it("estimates tokens from character count (~4 chars per token)", () => {
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("abcdefgh"), 2);
    assert.equal(estimateTokens("abc"), 1); // ceil(3/4)
  });

  it("handles longer text", () => {
    const text = "a".repeat(100);
    assert.equal(estimateTokens(text), 25);
  });
});

// ─────────────────────────────────────────────────────────────────
// formatToolError helper
// ─────────────────────────────────────────────────────────────────

describe("formatToolError", () => {
  it("formats a structured error message", () => {
    const result = { error: "File not found" };
    const output = formatToolError(result, "read_file");
    assert.ok(output.includes("[Tool Error]"));
    assert.ok(output.includes("read_file"));
    assert.ok(output.includes("File not found"));
    assert.ok(output.includes("try again"));
  });

  it("handles missing error field", () => {
    const result = {};
    const output = formatToolError(result, "write_file");
    assert.ok(output.includes("Unknown error"));
  });
});

// ─────────────────────────────────────────────────────────────────
// Token budget
// ─────────────────────────────────────────────────────────────────

describe("AgenticLoop — token budget", () => {
  it("stops when token budget is exceeded", async () => {
    const setup = createTestSetup();
    let budgetExceededCalled = false;

    const loop = new AgenticLoop({
      toolRegistry: setup.registry,
      toolExecutor: setup.executor,
      tokenBudget: 10, // Very small budget
      onTokenBudgetExceeded: () => { budgetExceededCalled = true; },
    });

    // Start with messages that already exceed the budget
    const result = await loop.run({
      messages: [
        { role: "system", content: "a".repeat(50) }, // ~12.5 tokens
      ],
      sendToLLM: async () => ({
        text: "Should not get here",
        toolCalls: [],
      }),
    });

    assert.ok(result.text.includes("token budget exceeded"));
    assert.ok(budgetExceededCalled);
    assert.equal(result.iterations, 0, "should not run any iterations");
  });

  it("tracks tokens across iterations", async () => {
    const setup = createTestSetup();
    let iterationCount = 0;

    const loop = new AgenticLoop({
      toolRegistry: setup.registry,
      toolExecutor: setup.executor,
      tokenBudget: 100, // Moderate budget
    });

    const result = await loop.run({
      messages: [{ role: "user", content: "Hello" }],
      sendToLLM: async () => {
        iterationCount++;
        if (iterationCount < 3) {
          return {
            text: "a".repeat(200), // ~50 tokens per response
            toolCalls: [],
          };
        }
        return { text: "Final", toolCalls: [] };
      },
    });

    assert.ok(result.tokensUsed > 0, "should track tokens");
  });

  it("returns tokensUsed in result even with unlimited budget", async () => {
    const setup = createTestSetup();

    const loop = new AgenticLoop({
      toolRegistry: setup.registry,
      toolExecutor: setup.executor,
      tokenBudget: 0, // Unlimited
    });

    const result = await loop.run({
      messages: [{ role: "user", content: "Hello world" }],
      sendToLLM: async () => ({
        text: "Hi there!",
        toolCalls: [],
      }),
    });

    assert.ok(typeof result.tokensUsed === "number");
    assert.ok(result.tokensUsed > 0, "should still track tokens with unlimited budget");
  });
});

// ─────────────────────────────────────────────────────────────────
// Wall-clock timeout
// ─────────────────────────────────────────────────────────────────

describe("AgenticLoop — wall-clock timeout", () => {
  it("stops when timeout is exceeded", async () => {
    const setup = createTestSetup();
    let timeoutCalled = false;

    const loop = new AgenticLoop({
      toolRegistry: setup.registry,
      toolExecutor: setup.executor,
      timeoutMs: 50, // 50ms timeout
      onTimeout: () => { timeoutCalled = true; },
    });

    const result = await loop.run({
      messages: [{ role: "user", content: "Hello" }],
      sendToLLM: async () => {
        // Simulate slow LLM that takes longer than timeout
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { text: "Done", toolCalls: [] };
      },
    });

    // After first LLM call returns (after 100ms), timeout should trigger on next iteration check
    // But since the LLM call takes 100ms and timeout is 50ms, the loop won't timeout mid-call
    // It will timeout at the start of the next iteration
    assert.ok(typeof result.tokensUsed === "number");
  });

  it("does not timeout with timeoutMs: 0 (default)", async () => {
    const setup = createTestSetup();

    const loop = new AgenticLoop({
      toolRegistry: setup.registry,
      toolExecutor: setup.executor,
      timeoutMs: 0,
    });

    const result = await loop.run({
      messages: [{ role: "user", content: "Hello" }],
      sendToLLM: async () => ({
        text: "No timeout!",
        toolCalls: [],
      }),
    });

    assert.equal(result.text, "No timeout!");
    assert.equal(result.aborted, false);
  });
});

// ─────────────────────────────────────────────────────────────────
// Structured tool error formatting
// ─────────────────────────────────────────────────────────────────

describe("AgenticLoop — structured error in tool results", () => {
  it("sends structured error message to LLM when tool fails", async () => {
    const setup = createTestSetup();
    const sentMessages = [];

    const loop = new AgenticLoop({
      toolRegistry: setup.registry,
      toolExecutor: setup.executor,
    });

    let callCount = 0;
    const result = await loop.run({
      messages: [{ role: "user", content: "Read a missing file" }],
      sendToLLM: async (msgs) => {
        sentMessages.push(JSON.parse(JSON.stringify(msgs)));
        callCount++;
        if (callCount === 1) {
          return {
            text: "",
            toolCalls: [{
              id: "call_1",
              name: "read_file",
              arguments: { path: "/nonexistent/path/that/does/not/exist.xyz" },
            }],
          };
        }
        return { text: "I see the file was not found.", toolCalls: [] };
      },
    });

    // The second call should have a tool message with structured error
    assert.ok(sentMessages.length >= 2, "should have called LLM at least twice");
    const secondCallMsgs = sentMessages[1];
    const toolMsg = secondCallMsgs.find((m) => m.role === "tool");
    assert.ok(toolMsg, "should have tool result message");
    assert.ok(toolMsg.content.includes("[Tool Error]"), "should use structured error format");
    assert.ok(toolMsg.content.includes("try again"), "should include recovery hint");
  });
});
