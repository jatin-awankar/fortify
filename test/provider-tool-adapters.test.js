import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OpenAIService } from "../src/services/openai/openai-service.js";
import { AnthropicService } from "../src/services/anthropic/anthropic-service.js";
import { GeminiService } from "../src/services/gemini/gemini-service.js";
import { OllamaService } from "../src/services/ollama/ollama-service.js";

// ─────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────

const MOCK_CONFIG = {
  apiKeys: {
    openai: "sk-test-key",
    anthropic: "sk-ant-test",
    gemini: "AIza-test",
  },
  endpoints: { ollama: "http://localhost:11434" },
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

// ─────────────────────────────────────────────────────────────────
// OpenAI createResponse
// ─────────────────────────────────────────────────────────────────

describe("OpenAI createResponse", () => {
  it("sends tools in the request payload", async () => {
    let capturedBody;
    const service = new OpenAIService({
      configLoader: mockConfigLoader,
      fetchFn: async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { role: "assistant", content: "Done.", tool_calls: undefined } }],
          }),
        };
      },
    });

    await service.createResponse({
      input: [{ role: "user", content: "Hello" }],
      model: "gpt-4",
      tools: sampleTools,
    });

    assert.ok(capturedBody.tools, "tools should be in payload");
    assert.equal(capturedBody.tools.length, 1);
    assert.equal(capturedBody.tools[0].function.name, "read_file");
    assert.equal(capturedBody.tool_choice, "auto");
  });

  it("returns tool_calls from the response", async () => {
    const service = new OpenAIService({
      configLoader: mockConfigLoader,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call_1",
                type: "function",
                function: { name: "read_file", arguments: '{"path":"test.js"}' },
              }],
            },
          }],
        }),
      }),
    });

    const response = await service.createResponse({
      input: [{ role: "user", content: "Read test.js" }],
      model: "gpt-4",
      tools: sampleTools,
    });

    assert.ok(response.choices[0].message.tool_calls);
    assert.equal(response.choices[0].message.tool_calls[0].function.name, "read_file");
  });

  it("works without tools", async () => {
    let capturedBody;
    const service = new OpenAIService({
      configLoader: mockConfigLoader,
      fetchFn: async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { role: "assistant", content: "Hi!" } }],
          }),
        };
      },
    });

    const response = await service.createResponse({
      input: [{ role: "user", content: "Hello" }],
      model: "gpt-4",
    });

    assert.ok(!capturedBody.tools, "tools should not be in payload");
    assert.equal(response.choices[0].message.content, "Hi!");
  });
});

// ─────────────────────────────────────────────────────────────────
// Anthropic createResponse
// ─────────────────────────────────────────────────────────────────

describe("Anthropic createResponse", () => {
  it("converts OpenAI tools to Anthropic format", async () => {
    let capturedBody;
    const service = new AnthropicService({
      configLoader: mockConfigLoader,
      fetchFn: async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            content: [{ type: "text", text: "Done." }],
            stop_reason: "end_turn",
          }),
        };
      },
    });

    await service.createResponse({
      input: [{ role: "user", content: "Hello" }],
      tools: sampleTools,
    });

    assert.ok(capturedBody.tools, "tools should be in payload");
    assert.equal(capturedBody.tools[0].name, "read_file");
    assert.ok(capturedBody.tools[0].input_schema, "should use input_schema");
  });

  it("converts Anthropic tool_use response to OpenAI format", async () => {
    const service = new AnthropicService({
      configLoader: mockConfigLoader,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          content: [
            { type: "text", text: "Let me read that file." },
            { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "test.js" } },
          ],
          stop_reason: "tool_use",
        }),
      }),
    });

    const response = await service.createResponse({
      input: [{ role: "user", content: "Read test.js" }],
      tools: sampleTools,
    });

    const msg = response.choices[0].message;
    assert.equal(msg.content, "Let me read that file.");
    assert.ok(msg.tool_calls);
    assert.equal(msg.tool_calls[0].function.name, "read_file");
    assert.equal(msg.tool_calls[0].id, "toolu_1");
    assert.equal(JSON.parse(msg.tool_calls[0].function.arguments).path, "test.js");
  });

  it("handles tool results in conversation", async () => {
    let capturedBody;
    const service = new AnthropicService({
      configLoader: mockConfigLoader,
      fetchFn: async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            content: [{ type: "text", text: "The file contains test code." }],
            stop_reason: "end_turn",
          }),
        };
      },
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
        { role: "tool", tool_call_id: "call_1", content: "console.log('hello');" },
      ],
      tools: sampleTools,
    });

    // Verify tool result was converted to Anthropic format
    const toolResultMsg = capturedBody.messages.find(
      (m) => Array.isArray(m.content) && m.content[0]?.type === "tool_result"
    );
    assert.ok(toolResultMsg, "should have tool_result message");
    assert.equal(toolResultMsg.content[0].tool_use_id, "call_1");
  });
});

// ─────────────────────────────────────────────────────────────────
// Gemini createResponse
// ─────────────────────────────────────────────────────────────────

describe("Gemini createResponse", () => {
  it("converts OpenAI tools to Gemini functionDeclarations", async () => {
    let capturedBody;
    const service = new GeminiService({
      configLoader: mockConfigLoader,
      fetchFn: async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "Done." }] } }],
          }),
        };
      },
    });

    await service.createResponse({
      input: [{ role: "user", content: "Hello" }],
      tools: sampleTools,
    });

    assert.ok(capturedBody.tools, "tools should be in payload");
    assert.ok(capturedBody.tools[0].functionDeclarations, "should use functionDeclarations");
    assert.equal(capturedBody.tools[0].functionDeclarations[0].name, "read_file");
  });

  it("converts Gemini functionCall response to OpenAI format", async () => {
    const service = new GeminiService({
      configLoader: mockConfigLoader,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [
                { functionCall: { name: "read_file", args: { path: "test.js" } } },
              ],
            },
          }],
        }),
      }),
    });

    const response = await service.createResponse({
      input: [{ role: "user", content: "Read test.js" }],
      tools: sampleTools,
    });

    const msg = response.choices[0].message;
    assert.ok(msg.tool_calls);
    assert.equal(msg.tool_calls[0].function.name, "read_file");
    assert.equal(JSON.parse(msg.tool_calls[0].function.arguments).path, "test.js");
    assert.equal(response.choices[0].finish_reason, "tool_calls");
  });
});

// ─────────────────────────────────────────────────────────────────
// Ollama createResponse
// ─────────────────────────────────────────────────────────────────

describe("Ollama createResponse", () => {
  it("sends tools in the request payload", async () => {
    let capturedBody;
    const service = new OllamaService({
      configLoader: mockConfigLoader,
      fetchFn: async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            message: { role: "assistant", content: "Done." },
          }),
        };
      },
    });

    await service.createResponse({
      input: [{ role: "user", content: "Hello" }],
      tools: sampleTools,
    });

    assert.ok(capturedBody.tools, "tools should be in payload");
    assert.equal(capturedBody.stream, false);
  });

  it("converts Ollama tool_calls to OpenAI format", async () => {
    const service = new OllamaService({
      configLoader: mockConfigLoader,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              function: { name: "read_file", arguments: { path: "test.js" } },
            }],
          },
        }),
      }),
    });

    const response = await service.createResponse({
      input: [{ role: "user", content: "Read test.js" }],
      tools: sampleTools,
    });

    const msg = response.choices[0].message;
    assert.ok(msg.tool_calls);
    assert.equal(msg.tool_calls[0].function.name, "read_file");
    assert.equal(response.choices[0].finish_reason, "tool_calls");
  });

  it("returns text-only when no tool_calls", async () => {
    const service = new OllamaService({
      configLoader: mockConfigLoader,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          message: { role: "assistant", content: "Hello there!" },
        }),
      }),
    });

    const response = await service.createResponse({
      input: [{ role: "user", content: "Hi" }],
    });

    assert.equal(response.choices[0].message.content, "Hello there!");
    assert.ok(!response.choices[0].message.tool_calls);
    assert.equal(response.choices[0].finish_reason, "stop");
  });
});
