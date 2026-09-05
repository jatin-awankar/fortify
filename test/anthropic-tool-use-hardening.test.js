import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AnthropicService, AnthropicConfigurationError } from "../src/services/anthropic/anthropic-service.js";

// ─────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────

const MOCK_CONFIG = {
  apiKeys: { anthropic: "sk-ant-test" },
  modelPreferences: { anthropicModel: "claude-3-5-sonnet-20241022" },
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
    // Skip model discovery requests
    if (url.endsWith("/models")) {
      return { ok: true, json: async () => ({ data: [] }) };
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
// Empty text block guard
// ─────────────────────────────────────────────────────────────────

describe("Anthropic createResponse — empty text block guard", () => {
  it("omits text block when assistant content is null", async () => {
    const { fetchFn, getCapturedBody } = createMockFetch({
      content: [{ type: "text", text: "Done." }],
      stop_reason: "end_turn",
    });

    const service = new AnthropicService({
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
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"test.js"}' },
          }],
        },
        { role: "tool", tool_call_id: "call_1", content: "file content" },
      ],
      tools: sampleTools,
    });

    const body = getCapturedBody();
    const assistantMsg = body.messages.find((m) =>
      m.role === "assistant" && Array.isArray(m.content)
    );
    assert.ok(assistantMsg, "should have assistant message with content array");

    // Should only have tool_use blocks, no text block
    const textBlocks = assistantMsg.content.filter((b) => b.type === "text");
    assert.equal(textBlocks.length, 0, "should not include text block when content is null");
  });

  it("omits text block when assistant content is empty string", async () => {
    const { fetchFn, getCapturedBody } = createMockFetch({
      content: [{ type: "text", text: "Done." }],
      stop_reason: "end_turn",
    });

    const service = new AnthropicService({
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
            function: { name: "read_file", arguments: '{"path":"test.js"}' },
          }],
        },
        { role: "tool", tool_call_id: "call_1", content: "file content" },
      ],
      tools: sampleTools,
    });

    const body = getCapturedBody();
    const assistantMsg = body.messages.find((m) =>
      m.role === "assistant" && Array.isArray(m.content)
    );
    const textBlocks = assistantMsg.content.filter((b) => b.type === "text");
    assert.equal(textBlocks.length, 0, "should not include text block when content is empty string");
  });

  it("preserves text block when assistant has real content", async () => {
    const { fetchFn, getCapturedBody } = createMockFetch({
      content: [{ type: "text", text: "Done." }],
      stop_reason: "end_turn",
    });

    const service = new AnthropicService({
      configLoader: mockConfigLoader,
      fetchFn,
    });

    await service.createResponse({
      input: [
        { role: "user", content: "Read test.js" },
        {
          role: "assistant",
          content: "Let me read that file.",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"test.js"}' },
          }],
        },
        { role: "tool", tool_call_id: "call_1", content: "file content" },
      ],
      tools: sampleTools,
    });

    const body = getCapturedBody();
    const assistantMsg = body.messages.find((m) =>
      m.role === "assistant" && Array.isArray(m.content)
    );
    const textBlocks = assistantMsg.content.filter((b) => b.type === "text");
    assert.equal(textBlocks.length, 1, "should include text block when content is non-empty");
    assert.equal(textBlocks[0].text, "Let me read that file.");
  });
});

// ─────────────────────────────────────────────────────────────────
// Consecutive tool_result merging
// ─────────────────────────────────────────────────────────────────

describe("Anthropic createResponse — consecutive tool_result merging", () => {
  it("merges consecutive tool results into a single user message", async () => {
    const { fetchFn, getCapturedBody } = createMockFetch({
      content: [{ type: "text", text: "Both files processed." }],
      stop_reason: "end_turn",
    });

    const service = new AnthropicService({
      configLoader: mockConfigLoader,
      fetchFn,
    });

    await service.createResponse({
      input: [
        { role: "user", content: "Read two files" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.js"}' } },
            { id: "call_2", type: "function", function: { name: "read_file", arguments: '{"path":"b.js"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "content a" },
        { role: "tool", tool_call_id: "call_2", content: "content b" },
      ],
      tools: sampleTools,
    });

    const body = getCapturedBody();
    // Count user messages with tool_result content
    const toolResultMessages = body.messages.filter((m) =>
      m.role === "user" && Array.isArray(m.content) && m.content[0]?.type === "tool_result"
    );
    assert.equal(toolResultMessages.length, 1,
      "consecutive tool results should be merged into 1 user message");
    assert.equal(toolResultMessages[0].content.length, 2,
      "merged message should have 2 tool_result blocks");
    assert.equal(toolResultMessages[0].content[0].tool_use_id, "call_1");
    assert.equal(toolResultMessages[0].content[1].tool_use_id, "call_2");
  });
});

// ─────────────────────────────────────────────────────────────────
// Model fallback chain
// ─────────────────────────────────────────────────────────────────

describe("Anthropic createResponse — model fallback", () => {
  it("falls back to next model on 429 rate limit error", async () => {
    let callCount = 0;
    const modelsUsed = [];

    const service = new AnthropicService({
      configLoader: mockConfigLoader,
      fetchFn: async (url, opts) => {
        if (url.endsWith("/models")) {
          return { ok: true, json: async () => ({ data: [] }) };
        }

        callCount++;
        const body = JSON.parse(opts.body);
        modelsUsed.push(body.model);

        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            text: async () => "Rate limit exceeded (429)",
          };
        }
        return {
          ok: true,
          json: async () => ({
            content: [{ type: "text", text: "Fallback success" }],
            stop_reason: "end_turn",
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
    const service = new AnthropicService({
      configLoader: mockConfigLoader,
      fetchFn: async (url) => {
        if (url.endsWith("/models")) {
          return { ok: true, json: async () => ({ data: [] }) };
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

  it("throws AnthropicConfigurationError when API key is missing", async () => {
    const service = new AnthropicService({
      configLoader: async () => ({ apiKeys: { anthropic: "" } }),
    });

    await assert.rejects(
      () => service.createResponse({
        input: [{ role: "user", content: "Hello" }],
      }),
      (err) => err instanceof AnthropicConfigurationError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// Malformed JSON arguments handling
// ─────────────────────────────────────────────────────────────────

describe("Anthropic createResponse — malformed arguments handling", () => {
  it("wraps malformed JSON arguments in _raw field instead of throwing", async () => {
    const { fetchFn, getCapturedBody } = createMockFetch({
      content: [{ type: "text", text: "Done." }],
      stop_reason: "end_turn",
    });

    const service = new AnthropicService({
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
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: "not valid json" },
          }],
        },
        { role: "tool", tool_call_id: "call_1", content: "result" },
      ],
      tools: sampleTools,
    });

    const body = getCapturedBody();
    const assistantMsg = body.messages.find((m) =>
      m.role === "assistant" && Array.isArray(m.content)
    );
    const toolUseBlock = assistantMsg.content.find((b) => b.type === "tool_use");
    assert.ok(toolUseBlock, "should have tool_use block");
    assert.deepEqual(toolUseBlock.input, { _raw: "not valid json" },
      "malformed JSON should be wrapped in _raw field");
  });
});
