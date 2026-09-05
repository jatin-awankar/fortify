import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GeminiService, GeminiConfigurationError } from "../src/services/gemini/gemini-service.js";

// ─────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────

const MOCK_CONFIG = {
  apiKeys: { gemini: "AIza-test" },
  modelPreferences: { geminiModel: "gemini-2.0-flash" },
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
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write file contents",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          content: { type: "string", description: "Content" },
        },
        required: ["path", "content"],
      },
    },
  },
];

/** Build a mock fetch that captures the request body and returns a canned response */
function createMockFetch(responseData) {
  let capturedBody = null;
  let capturedUrl = null;

  const fetchFn = async (url, opts) => {
    capturedUrl = url;
    // Skip model discovery requests
    if (url.endsWith("/models")) {
      return {
        ok: true,
        json: async () => ({ models: [] }),
      };
    }

    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => responseData,
    };
  };

  return { fetchFn, getCapturedBody: () => capturedBody, getCapturedUrl: () => capturedUrl };
}

// ─────────────────────────────────────────────────────────────────
// functionResponse name correlation
// ─────────────────────────────────────────────────────────────────

describe("Gemini createResponse — functionResponse name correlation", () => {
  it("resolves tool name from tool_call_id in preceding assistant message", async () => {
    const { fetchFn, getCapturedBody } = createMockFetch({
      candidates: [{ content: { parts: [{ text: "File content is: hello" }] } }],
    });

    const service = new GeminiService({
      configLoader: mockConfigLoader,
      fetchFn,
    });

    await service.createResponse({
      input: [
        { role: "user", content: "Read test.js" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_123",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"test.js"}' },
          }],
        },
        { role: "tool", tool_call_id: "call_123", content: "console.log('hello');" },
      ],
      tools: sampleTools,
    });

    const body = getCapturedBody();
    // Find the function response message
    const fnMsg = body.contents.find((c) => c.role === "function");
    assert.ok(fnMsg, "should have a function role message");
    assert.equal(fnMsg.parts[0].functionResponse.name, "read_file",
      "should resolve name from tool_call_id, not use fallback");
  });

  it("falls back to msg.name when tool_call_id has no match", async () => {
    const { fetchFn, getCapturedBody } = createMockFetch({
      candidates: [{ content: { parts: [{ text: "Done" }] } }],
    });

    const service = new GeminiService({
      configLoader: mockConfigLoader,
      fetchFn,
    });

    await service.createResponse({
      input: [
        { role: "user", content: "Do something" },
        // No preceding assistant with tool_calls
        { role: "tool", tool_call_id: "orphan_id", name: "custom_tool", content: "result" },
      ],
    });

    const body = getCapturedBody();
    const fnMsg = body.contents.find((c) => c.role === "function");
    assert.ok(fnMsg, "should have function message");
    assert.equal(fnMsg.parts[0].functionResponse.name, "custom_tool",
      "should fall back to msg.name");
  });

  it("falls back to 'tool_result' when no name source available", async () => {
    const { fetchFn, getCapturedBody } = createMockFetch({
      candidates: [{ content: { parts: [{ text: "Done" }] } }],
    });

    const service = new GeminiService({
      configLoader: mockConfigLoader,
      fetchFn,
    });

    await service.createResponse({
      input: [
        { role: "user", content: "Do something" },
        { role: "tool", tool_call_id: "orphan_id", content: "result" },
      ],
    });

    const body = getCapturedBody();
    const fnMsg = body.contents.find((c) => c.role === "function");
    assert.equal(fnMsg.parts[0].functionResponse.name, "tool_result",
      "should fall back to 'tool_result'");
  });
});

// ─────────────────────────────────────────────────────────────────
// Consecutive tool result batching
// ─────────────────────────────────────────────────────────────────

describe("Gemini createResponse — tool result batching", () => {
  it("batches consecutive tool results into a single function message", async () => {
    const { fetchFn, getCapturedBody } = createMockFetch({
      candidates: [{ content: { parts: [{ text: "Both files read." }] } }],
    });

    const service = new GeminiService({
      configLoader: mockConfigLoader,
      fetchFn,
    });

    await service.createResponse({
      input: [
        { role: "user", content: "Read both files" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.js"}' } },
            { id: "call_2", type: "function", function: { name: "read_file", arguments: '{"path":"b.js"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "content of a.js" },
        { role: "tool", tool_call_id: "call_2", content: "content of b.js" },
      ],
      tools: sampleTools,
    });

    const body = getCapturedBody();
    const fnMessages = body.contents.filter((c) => c.role === "function");
    assert.equal(fnMessages.length, 1, "consecutive tool results should be batched into 1 message");
    assert.equal(fnMessages[0].parts.length, 2, "should have 2 parts (one per tool result)");
    assert.equal(fnMessages[0].parts[0].functionResponse.name, "read_file");
    assert.equal(fnMessages[0].parts[1].functionResponse.name, "read_file");
  });

  it("does not batch tool results separated by other messages", async () => {
    const { fetchFn, getCapturedBody } = createMockFetch({
      candidates: [{ content: { parts: [{ text: "Done" }] } }],
    });

    const service = new GeminiService({
      configLoader: mockConfigLoader,
      fetchFn,
    });

    await service.createResponse({
      input: [
        { role: "user", content: "Read file" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.js"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "content of a.js" },
        { role: "user", content: "Now read another" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_2", type: "function", function: { name: "read_file", arguments: '{"path":"b.js"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call_2", content: "content of b.js" },
      ],
      tools: sampleTools,
    });

    const body = getCapturedBody();
    const fnMessages = body.contents.filter((c) => c.role === "function");
    assert.equal(fnMessages.length, 2, "non-consecutive tool results should produce separate messages");
  });
});

// ─────────────────────────────────────────────────────────────────
// Safety / content filter handling
// ─────────────────────────────────────────────────────────────────

describe("Gemini createResponse — safety and content filters", () => {
  it("throws on SAFETY finishReason", async () => {
    const { fetchFn } = createMockFetch({
      candidates: [{ finishReason: "SAFETY", content: { parts: [] } }],
    });

    const service = new GeminiService({
      configLoader: mockConfigLoader,
      fetchFn,
    });

    await assert.rejects(
      () => service.createResponse({
        input: [{ role: "user", content: "Something unsafe" }],
      }),
      (err) => err.message.includes("content filter") && err.message.includes("SAFETY"),
    );
  });

  it("throws on RECITATION finishReason", async () => {
    const { fetchFn } = createMockFetch({
      candidates: [{ finishReason: "RECITATION", content: { parts: [] } }],
    });

    const service = new GeminiService({
      configLoader: mockConfigLoader,
      fetchFn,
    });

    await assert.rejects(
      () => service.createResponse({
        input: [{ role: "user", content: "Recite something" }],
      }),
      (err) => err.message.includes("RECITATION"),
    );
  });

  it("throws on BLOCKED finishReason", async () => {
    const { fetchFn } = createMockFetch({
      candidates: [{ finishReason: "BLOCKED", content: { parts: [] } }],
    });

    const service = new GeminiService({
      configLoader: mockConfigLoader,
      fetchFn,
    });

    await assert.rejects(
      () => service.createResponse({
        input: [{ role: "user", content: "Blocked content" }],
      }),
      (err) => err.message.includes("BLOCKED"),
    );
  });

  it("does not throw on STOP finishReason", async () => {
    const { fetchFn } = createMockFetch({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "All good" }] } }],
    });

    const service = new GeminiService({
      configLoader: mockConfigLoader,
      fetchFn,
    });

    const response = await service.createResponse({
      input: [{ role: "user", content: "Hello" }],
    });

    assert.equal(response.choices[0].message.content, "All good");
  });
});

// ─────────────────────────────────────────────────────────────────
// Model fallback chain for createResponse
// ─────────────────────────────────────────────────────────────────

describe("Gemini createResponse — model fallback", () => {
  it("falls back to next model on 429 quota error", async () => {
    let callCount = 0;
    const modelsUsed = [];

    const service = new GeminiService({
      configLoader: mockConfigLoader,
      fetchFn: async (url) => {
        if (url.endsWith("/models")) {
          return { ok: true, json: async () => ({ models: [] }) };
        }

        callCount++;
        // Extract model from URL
        const modelMatch = url.match(/models\/([^:]+)/);
        if (modelMatch) modelsUsed.push(modelMatch[1]);

        if (callCount === 1) {
          // First call: 429 quota error
          return {
            ok: false,
            status: 429,
            text: async () => "Rate limit exceeded (429)",
          };
        }
        // Second call: succeed
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "Fallback success" }] } }],
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

  it("throws non-fallback-eligible errors immediately", async () => {
    const service = new GeminiService({
      configLoader: mockConfigLoader,
      fetchFn: async (url) => {
        if (url.endsWith("/models")) {
          return { ok: true, json: async () => ({ models: [] }) };
        }
        return {
          ok: false,
          status: 400,
          text: async () => "Invalid request (400)",
        };
      },
    });

    await assert.rejects(
      () => service.createResponse({
        input: [{ role: "user", content: "Hello" }],
      }),
      (err) => err.message.includes("400"),
    );
  });

  it("throws GeminiConfigurationError when API key is missing for createResponse", async () => {
    const service = new GeminiService({
      configLoader: async () => ({ apiKeys: { gemini: "" } }),
    });

    await assert.rejects(
      () => service.createResponse({
        input: [{ role: "user", content: "Hello" }],
      }),
      (err) => err instanceof GeminiConfigurationError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// Multi-turn tool conversation integrity
// ─────────────────────────────────────────────────────────────────

describe("Gemini createResponse — multi-turn conversation", () => {
  it("preserves full multi-turn tool conversation structure", async () => {
    const { fetchFn, getCapturedBody } = createMockFetch({
      candidates: [{ content: { parts: [{ text: "Here's the summary." }] } }],
    });

    const service = new GeminiService({
      configLoader: mockConfigLoader,
      fetchFn,
    });

    await service.createResponse({
      input: [
        { role: "system", content: "You are a code assistant." },
        { role: "user", content: "Read and summarize test.js" },
        {
          role: "assistant",
          content: "I'll read the file for you.",
          tool_calls: [{
            id: "call_abc",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"test.js"}' },
          }],
        },
        { role: "tool", tool_call_id: "call_abc", content: "const x = 1;" },
      ],
      tools: sampleTools,
    });

    const body = getCapturedBody();

    // System should become systemInstruction
    assert.ok(body.systemInstruction, "should have systemInstruction");
    assert.ok(body.systemInstruction.parts[0].text.includes("code assistant"));

    // Verify contents ordering: user → model (with functionCall) → function (with functionResponse)
    const roles = body.contents.map((c) => c.role);
    assert.deepEqual(roles, ["user", "model", "function"]);

    // Verify model message has both text and functionCall
    const modelMsg = body.contents[1];
    assert.equal(modelMsg.parts.length, 2, "model message should have text + functionCall");
    assert.equal(modelMsg.parts[0].text, "I'll read the file for you.");
    assert.equal(modelMsg.parts[1].functionCall.name, "read_file");

    // Verify function response name was resolved
    const fnMsg = body.contents[2];
    assert.equal(fnMsg.parts[0].functionResponse.name, "read_file");
    assert.equal(fnMsg.parts[0].functionResponse.response.content, "const x = 1;");
  });
});
