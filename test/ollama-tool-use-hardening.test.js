import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OllamaService } from "../src/services/ollama/ollama-service.js";

// ─────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────

const MOCK_CONFIG = {
  endpoints: { ollama: "http://localhost:11434" },
  modelPreferences: { ollamaModel: "llama3" },
};

function mockConfigLoader() {
  return Promise.resolve(MOCK_CONFIG);
}

const sampleTools = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read file contents",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
        },
        required: ["path"],
      },
    },
  },
];

function createMockFetch(responseData) {
  let capturedBody = null;

  const fetchFn = async (url, opts) => {
    if (url.endsWith("/api/tags")) {
      return { ok: true, json: async () => ({ models: [] }) };
    }
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => responseData,
    };
  };

  return { fetchFn, getCapturedBody: () => capturedBody };
}

// ─────────────────────────────────────────────────────────────────
// Model fallback chain
// ─────────────────────────────────────────────────────────────────

describe("Ollama createResponse — model fallback", () => {
  it("falls back to next model on model-not-found error", async () => {
    let callCount = 0;
    const modelsUsed = [];

    const service = new OllamaService({
      configLoader: mockConfigLoader,
      fetchFn: async (url, opts) => {
        if (url.endsWith("/api/tags")) {
          return {
            ok: true,
            json: async () => ({ models: [{ name: "llama3" }, { name: "codellama" }] }),
          };
        }

        callCount++;
        const body = JSON.parse(opts.body);
        modelsUsed.push(body.model);

        if (callCount === 1) {
          return {
            ok: false,
            status: 404,
            text: async () => "model not found (404)",
          };
        }
        return {
          ok: true,
          json: async () => ({
            message: { role: "assistant", content: "Fallback success" },
          }),
        };
      },
    });

    const response = await service.createResponse({
      input: [{ role: "user", content: "Hello" }],
    });

    assert.equal(response.choices[0].message.content, "Fallback success");
    assert.ok(modelsUsed.length >= 2, "should have tried at least 2 models");
  });

  it("throws non-model errors immediately without fallback", async () => {
    const service = new OllamaService({
      configLoader: mockConfigLoader,
      fetchFn: async (url) => {
        if (url.endsWith("/api/tags")) {
          return { ok: true, json: async () => ({ models: [] }) };
        }
        return {
          ok: false,
          status: 500,
          text: async () => "Internal server error (500)",
        };
      },
    });

    await assert.rejects(
      () => service.createResponse({
        input: [{ role: "user", content: "Hello" }],
      }),
      (err) => err.message.includes("500"),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// Connection error wrapping
// ─────────────────────────────────────────────────────────────────

describe("Ollama createResponse — connection error handling", () => {
  it("wraps connection errors with helpful message", async () => {
    const service = new OllamaService({
      configLoader: mockConfigLoader,
      fetchFn: async (url) => {
        if (url.endsWith("/api/tags")) {
          return { ok: true, json: async () => ({ models: [] }) };
        }
        throw new Error("ECONNREFUSED");
      },
    });

    await assert.rejects(
      () => service.createResponse({
        input: [{ role: "user", content: "Hello" }],
      }),
      (err) => {
        return err.message.includes("Failed to connect") &&
               err.message.includes("Is Ollama running") &&
               err.message.includes("ECONNREFUSED");
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// Arguments normalization
// ─────────────────────────────────────────────────────────────────

describe("Ollama createResponse — arguments normalization", () => {
  it("normalizes object arguments to JSON string in tool_calls", async () => {
    const { fetchFn, getCapturedBody } = createMockFetch({
      message: { role: "assistant", content: "Done." },
    });

    const service = new OllamaService({
      configLoader: mockConfigLoader,
      fetchFn,
    });

    await service.createResponse({
      input: [
        { role: "user", content: "Read test.js" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: {
              name: "read_file",
              arguments: { path: "test.js" }, // Object, not string
            },
          }],
        },
        { role: "tool", content: "file content" },
      ],
      tools: sampleTools,
    });

    const body = getCapturedBody();
    const assistantMsg = body.messages.find((m) =>
      m.role === "assistant" && Array.isArray(m.tool_calls)
    );
    assert.ok(assistantMsg, "should have assistant message with tool_calls");
    const args = assistantMsg.tool_calls[0].function.arguments;
    assert.equal(typeof args, "string", "arguments should be serialized to string");
    assert.deepEqual(JSON.parse(args), { path: "test.js" });
  });

  it("preserves string arguments as-is in tool_calls", async () => {
    const { fetchFn, getCapturedBody } = createMockFetch({
      message: { role: "assistant", content: "Done." },
    });

    const service = new OllamaService({
      configLoader: mockConfigLoader,
      fetchFn,
    });

    await service.createResponse({
      input: [
        { role: "user", content: "Read test.js" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: {
              name: "read_file",
              arguments: '{"path":"test.js"}', // Already string
            },
          }],
        },
        { role: "tool", content: "file content" },
      ],
      tools: sampleTools,
    });

    const body = getCapturedBody();
    const assistantMsg = body.messages.find((m) =>
      m.role === "assistant" && Array.isArray(m.tool_calls)
    );
    assert.equal(assistantMsg.tool_calls[0].function.arguments, '{"path":"test.js"}');
  });
});
