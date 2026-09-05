import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HeadlessChatService } from "../src/services/headless-chat-service.js";
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

function createMockProjectContext() {
  return {
    cwd: process.cwd(),
    gitService: { getStatus: async () => ({}) },
    getProjectContextSummary: async () => ({
      name: "test-project",
      stack: ["node"],
      hasMemory: false,
    }),
    formatSystemPromptContext: () => "You are a helpful assistant.",
  };
}

function createMockProviderFactory(responses) {
  let callIdx = 0;
  return {
    getProvider: async () => ({
      createResponse: async ({ input, tools }) => {
        const resp = Array.isArray(responses) ? responses[callIdx++] : responses;
        return resp;
      },
    }),
  };
}

// ─────────────────────────────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────────────────────────────

describe("HeadlessChatService — input validation", () => {
  it("returns error for empty prompt", async () => {
    const service = new HeadlessChatService({
      projectContextService: createMockProjectContext(),
    });

    const result = await service.run({ prompt: "" });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.ok(result.error.includes("No prompt"));
  });

  it("returns error for null prompt", async () => {
    const service = new HeadlessChatService({
      projectContextService: createMockProjectContext(),
    });

    const result = await service.run({ prompt: null });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
  });

  it("returns error for whitespace-only prompt", async () => {
    const service = new HeadlessChatService({
      projectContextService: createMockProjectContext(),
    });

    const result = await service.run({ prompt: "   " });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
  });
});

// ─────────────────────────────────────────────────────────────────
// Successful execution
// ─────────────────────────────────────────────────────────────────

describe("HeadlessChatService — successful execution", () => {
  it("runs a simple text-only response", async () => {
    const stdout = createMockStdout();
    const providerFactory = createMockProviderFactory({
      choices: [{
        message: { role: "assistant", content: "Hello from headless!", tool_calls: undefined },
        finish_reason: "stop",
      }],
    });

    const service = new HeadlessChatService({
      providerFactory,
      projectContextService: createMockProjectContext(),
      stdout,
      env: { NO_COLOR: "1" },
    });

    const result = await service.run({ prompt: "Say hello" });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.text, "Hello from headless!");
    assert.equal(result.iterations, 1);
  });

  it("runs a tool-use turn and returns results", async () => {
    const stdout = createMockStdout();
    let callCount = 0;

    const providerFactory = {
      getProvider: async () => ({
        createResponse: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              choices: [{
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [{
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "list_directory",
                      arguments: JSON.stringify({ path: "." }),
                    },
                  }],
                },
                finish_reason: "tool_calls",
              }],
            };
          }
          return {
            choices: [{
              message: { role: "assistant", content: "I listed the directory.", tool_calls: undefined },
              finish_reason: "stop",
            }],
          };
        },
      }),
    };

    const service = new HeadlessChatService({
      providerFactory,
      projectContextService: createMockProjectContext(),
      stdout,
      env: { NO_COLOR: "1" },
    });

    const result = await service.run({ prompt: "List the current directory" });

    assert.equal(result.ok, true);
    assert.equal(result.text, "I listed the directory.");
    assert.ok(result.toolResults.length > 0, "should have tool results");
    assert.ok(result.iterations >= 2, "should have multiple iterations");
  });

  it("includes tokensUsed in result", async () => {
    const providerFactory = createMockProviderFactory({
      choices: [{
        message: { role: "assistant", content: "Token tracking works", tool_calls: undefined },
        finish_reason: "stop",
      }],
    });

    const service = new HeadlessChatService({
      providerFactory,
      projectContextService: createMockProjectContext(),
      stdout: createMockStdout(),
      env: { NO_COLOR: "1" },
    });

    const result = await service.run({ prompt: "Test token tracking" });

    assert.ok(typeof result.tokensUsed === "number");
    assert.ok(result.tokensUsed > 0);
  });
});

// ─────────────────────────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────────────────────────

describe("HeadlessChatService — error handling", () => {
  it("returns error result when provider fails", async () => {
    const providerFactory = {
      getProvider: async () => ({
        createResponse: async () => {
          throw new Error("API key invalid");
        },
      }),
    };

    const service = new HeadlessChatService({
      providerFactory,
      projectContextService: createMockProjectContext(),
      stdout: createMockStdout(),
      env: { NO_COLOR: "1" },
    });

    const result = await service.run({ prompt: "This will fail" });

    // The error gets caught inside the agentic loop as an LLM error
    assert.equal(result.exitCode, 0); // loop completes with error text, not a crash
    assert.ok(result.text.includes("Error calling LLM") || result.error);
  });

  it("handles abort signal", async () => {
    const ac = new AbortController();
    ac.abort(); // Pre-abort

    const providerFactory = createMockProviderFactory({
      choices: [{
        message: { role: "assistant", content: "Should not see", tool_calls: undefined },
        finish_reason: "stop",
      }],
    });

    const service = new HeadlessChatService({
      providerFactory,
      projectContextService: createMockProjectContext(),
      stdout: createMockStdout(),
      env: { NO_COLOR: "1" },
    });

    const result = await service.run({
      prompt: "Aborted task",
      signal: ac.signal,
    });

    // Pre-aborted signal should cause the loop to abort
    assert.equal(result.ok, false);
  });
});

// ─────────────────────────────────────────────────────────────────
// Auto-approve behavior
// ─────────────────────────────────────────────────────────────────

describe("HeadlessChatService — auto-approve", () => {
  it("never prompts for permission in headless mode", async () => {
    const stdout = createMockStdout();
    let permissionPrompted = false;

    const registry = new ToolRegistry();
    const executor = new ToolExecutor({
      toolRegistry: registry,
      permissionPrompt: {
        requestPermission: async () => {
          permissionPrompted = true;
          return PERMISSION_RESPONSE.ALLOW;
        },
      },
      stdout,
      env: { NO_COLOR: "1" },
    });
    registerAllHandlers(executor);

    let callCount = 0;
    const providerFactory = {
      getProvider: async () => ({
        createResponse: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              choices: [{
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [{
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "list_directory",
                      arguments: JSON.stringify({ path: "." }),
                    },
                  }],
                },
                finish_reason: "tool_calls",
              }],
            };
          }
          return {
            choices: [{
              message: { role: "assistant", content: "Done", tool_calls: undefined },
              finish_reason: "stop",
            }],
          };
        },
      }),
    };

    const service = new HeadlessChatService({
      providerFactory,
      projectContextService: createMockProjectContext(),
      toolRegistry: registry,
      toolExecutor: executor,
      stdout,
      env: { NO_COLOR: "1" },
    });

    await service.run({ prompt: "List files" });

    assert.equal(permissionPrompted, false,
      "should never prompt for permission in headless mode");
  });
});
