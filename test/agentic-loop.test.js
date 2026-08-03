import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AgenticLoop } from "../src/services/agentic-loop.js";
import { ToolRegistry } from "../src/services/tool-registry.js";
import { ToolExecutor } from "../src/services/tool-executor.js";
import { PERMISSION_RESPONSE } from "../src/renderers/permission-prompt.js";

function createMockStdout() {
  const chunks = [];
  return {
    chunks,
    isTTY: false,
    columns: 80,
    write(data) { chunks.push(data); return true; },
    get output() { return chunks.join(""); },
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

  return { stdout, registry, executor };
}

describe("AgenticLoop", () => {
  let setup;

  beforeEach(() => {
    setup = createTestSetup();
  });

  describe("text-only response (no tools)", () => {
    it("returns immediately when LLM responds with text only", async () => {
      const loop = new AgenticLoop({
        toolRegistry: setup.registry,
        toolExecutor: setup.executor,
      });

      const result = await loop.run({
        messages: [{ role: "user", content: "Hello" }],
        sendToLLM: async () => ({
          text: "Hello! How can I help?",
          toolCalls: [],
        }),
      });

      assert.equal(result.text, "Hello! How can I help?");
      assert.equal(result.toolResults.length, 0);
      assert.equal(result.iterations, 1);
      assert.ok(!result.aborted);
    });
  });

  describe("single tool call", () => {
    it("executes a tool and then returns final text", async () => {
      let callCount = 0;

      const loop = new AgenticLoop({
        toolRegistry: setup.registry,
        toolExecutor: setup.executor,
      });

      const result = await loop.run({
        messages: [{ role: "user", content: "Read package.json" }],
        sendToLLM: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              text: "",
              toolCalls: [{
                id: "call_1",
                name: "read_file",
                arguments: { path: "package.json" },
              }],
            };
          }
          // Second call — return final text
          return { text: "I read the file.", toolCalls: [] };
        },
      });

      assert.equal(result.text, "I read the file.");
      assert.equal(result.toolResults.length, 1);
      assert.ok(result.toolResults[0].success);
      assert.equal(result.iterations, 2);
    });
  });

  describe("multiple sequential tool calls", () => {
    it("handles multiple tool calls in one response", async () => {
      let callCount = 0;

      const loop = new AgenticLoop({
        toolRegistry: setup.registry,
        toolExecutor: setup.executor,
      });

      const result = await loop.run({
        messages: [{ role: "user", content: "Read two files" }],
        sendToLLM: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              text: "",
              toolCalls: [
                { id: "call_1", name: "read_file", arguments: { path: "a.js" } },
                { id: "call_2", name: "read_file", arguments: { path: "b.js" } },
              ],
            };
          }
          return { text: "Done reading both files.", toolCalls: [] };
        },
      });

      assert.equal(result.toolResults.length, 2);
      assert.equal(result.text, "Done reading both files.");
      assert.equal(result.iterations, 2);
    });
  });

  describe("multi-turn tool loop", () => {
    it("loops until LLM stops calling tools", async () => {
      let callCount = 0;

      const loop = new AgenticLoop({
        toolRegistry: setup.registry,
        toolExecutor: setup.executor,
      });

      const result = await loop.run({
        messages: [{ role: "user", content: "Search and read" }],
        sendToLLM: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              text: "",
              toolCalls: [{ id: "c1", name: "search_files", arguments: { query: "TODO" } }],
            };
          }
          if (callCount === 2) {
            return {
              text: "",
              toolCalls: [{ id: "c2", name: "read_file", arguments: { path: "found.js" } }],
            };
          }
          return { text: "Found and read the file.", toolCalls: [] };
        },
      });

      assert.equal(result.iterations, 3);
      assert.equal(result.toolResults.length, 2);
      assert.equal(result.text, "Found and read the file.");
    });
  });

  describe("max iterations safety", () => {
    it("stops after max iterations", async () => {
      const loop = new AgenticLoop({
        toolRegistry: setup.registry,
        toolExecutor: setup.executor,
        maxIterations: 3,
      });

      const result = await loop.run({
        messages: [{ role: "user", content: "Loop forever" }],
        sendToLLM: async () => ({
          text: "",
          toolCalls: [{ id: "c", name: "read_file", arguments: { path: "x.js" } }],
        }),
      });

      assert.equal(result.iterations, 3);
      assert.ok(result.text.includes("stopped"));
    });
  });

  describe("abort signal", () => {
    it("stops when abort signal is triggered", async () => {
      const controller = new AbortController();
      controller.abort();

      const loop = new AgenticLoop({
        toolRegistry: setup.registry,
        toolExecutor: setup.executor,
      });

      const result = await loop.run({
        messages: [{ role: "user", content: "test" }],
        sendToLLM: async () => ({ text: "hello", toolCalls: [] }),
        signal: controller.signal,
      });

      assert.ok(result.aborted);
    });
  });

  describe("LLM error handling", () => {
    it("returns error message when LLM call fails", async () => {
      const loop = new AgenticLoop({
        toolRegistry: setup.registry,
        toolExecutor: setup.executor,
      });

      const result = await loop.run({
        messages: [{ role: "user", content: "test" }],
        sendToLLM: async () => {
          throw new Error("Rate limited");
        },
      });

      assert.ok(result.text.includes("Rate limited"));
      assert.equal(result.iterations, 1);
    });
  });

  describe("lifecycle hooks", () => {
    it("calls onIteration for each loop", async () => {
      const iterations = [];

      const loop = new AgenticLoop({
        toolRegistry: setup.registry,
        toolExecutor: setup.executor,
        onIteration: (n) => iterations.push(n),
      });

      await loop.run({
        messages: [{ role: "user", content: "test" }],
        sendToLLM: async () => ({ text: "done", toolCalls: [] }),
      });

      assert.deepEqual(iterations, [1]);
    });

    it("calls onToolResults after tool execution", async () => {
      let resultsReceived = null;
      let callCount = 0;

      const loop = new AgenticLoop({
        toolRegistry: setup.registry,
        toolExecutor: setup.executor,
        onToolResults: (results) => { resultsReceived = results; },
      });

      await loop.run({
        messages: [{ role: "user", content: "test" }],
        sendToLLM: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              text: "",
              toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a.js" } }],
            };
          }
          return { text: "done", toolCalls: [] };
        },
      });

      assert.ok(resultsReceived);
      assert.equal(resultsReceived.length, 1);
    });

    it("calls onComplete when loop finishes", async () => {
      let completionData = null;

      const loop = new AgenticLoop({
        toolRegistry: setup.registry,
        toolExecutor: setup.executor,
        onComplete: (data) => { completionData = data; },
      });

      await loop.run({
        messages: [{ role: "user", content: "test" }],
        sendToLLM: async () => ({ text: "done", toolCalls: [] }),
      });

      assert.ok(completionData);
      assert.equal(completionData.text, "done");
      assert.equal(completionData.iterations, 1);
    });
  });

  describe("static helpers", () => {
    it("hasToolCalls detects tool calls", () => {
      assert.ok(AgenticLoop.hasToolCalls({ toolCalls: [{ name: "a" }] }));
      assert.ok(!AgenticLoop.hasToolCalls({ toolCalls: [] }));
      assert.ok(!AgenticLoop.hasToolCalls({ text: "hello" }));
      assert.ok(!AgenticLoop.hasToolCalls(null));
    });

    it("parseResponse extracts text and tool calls from OpenAI format", () => {
      const parsed = AgenticLoop.parseResponse({
        choices: [{
          message: {
            content: "Let me check",
            tool_calls: [{
              id: "call_1",
              function: {
                name: "read_file",
                arguments: '{"path":"src/index.js"}',
              },
            }],
          },
        }],
      });

      assert.equal(parsed.text, "Let me check");
      assert.equal(parsed.toolCalls.length, 1);
      assert.equal(parsed.toolCalls[0].name, "read_file");
      assert.equal(parsed.toolCalls[0].arguments.path, "src/index.js");
    });

    it("parseResponse handles empty/null response", () => {
      const parsed = AgenticLoop.parseResponse(null);
      assert.equal(parsed.text, "");
      assert.equal(parsed.toolCalls.length, 0);
    });
  });
});
