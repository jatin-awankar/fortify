import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OpenAIService } from "../src/services/openai/openai-service.js";

const MOCK_CONFIG = {
  apiKeys: { openai: "sk-test-key" },
};

function mockConfigLoader() {
  return Promise.resolve(MOCK_CONFIG);
}

describe("OpenAI createResponse — response validation", () => {
  it("handles empty choices array gracefully", async () => {
    const service = new OpenAIService({
      configLoader: mockConfigLoader,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          choices: [],
        }),
      }),
    });

    const response = await service.createResponse({
      input: [{ role: "user", content: "Hello" }],
      model: "gpt-4",
    });

    assert.ok(response.choices, "should have choices");
    assert.equal(response.choices.length, 1, "should synthesize a choice");
    assert.equal(response.choices[0].message.role, "assistant");
    assert.equal(response.choices[0].message.content, null);
    assert.equal(response.choices[0].finish_reason, "stop");
  });

  it("handles null message in choices gracefully", async () => {
    const service = new OpenAIService({
      configLoader: mockConfigLoader,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: null, finish_reason: "stop" }],
        }),
      }),
    });

    const response = await service.createResponse({
      input: [{ role: "user", content: "Hello" }],
      model: "gpt-4",
    });

    assert.ok(response.choices[0].message, "should synthesize a message");
    assert.equal(response.choices[0].message.role, "assistant");
    assert.equal(response.choices[0].message.tool_calls, undefined);
  });

  it("passes through well-formed responses unchanged", async () => {
    const service = new OpenAIService({
      configLoader: mockConfigLoader,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              role: "assistant",
              content: "Hello!",
              tool_calls: undefined,
            },
            finish_reason: "stop",
          }],
        }),
      }),
    });

    const response = await service.createResponse({
      input: [{ role: "user", content: "Hello" }],
      model: "gpt-4",
    });

    assert.equal(response.choices[0].message.content, "Hello!");
    assert.equal(response.choices[0].finish_reason, "stop");
  });
});
