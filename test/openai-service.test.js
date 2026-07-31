import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIService } from "../src/services/openai/openai-service.js";
import { OpenAIConfigurationError } from "../src/services/openai/openai-service-errors.js";

test("generateResponse builds request payload and uses configured API key", async () => {
  let clientOptions;
  let requestPayload;

  const service = new OpenAIService({
    configLoader: async () => ({
      apiKeys: { openai: "sk-test" },
      modelPreferences: { defaultModel: "gpt-test", fallbackModels: [] },
    }),
    clientFactory: (options) => {
      clientOptions = options;
      return {
        responses: {
          create: async (payload) => {
            requestPayload = payload;
            return { id: "response-1", model: payload.model, output_text: "done" };
          },
        },
      };
    },
  });

  const response = await service.generateResponse({
    input: "hello",
    instructions: "be concise",
    temperature: 0.2,
    maxOutputTokens: 10,
  });

  assert.equal(clientOptions.apiKey, "sk-test");
  assert.equal(requestPayload.model, "gpt-test");
  assert.equal(requestPayload.instructions, "be concise");
  assert.equal(requestPayload.max_output_tokens, 10);
  assert.equal(requestPayload.stream, false);
  assert.equal(response.outputText, "done");
});

test("generateResponse throws a normalized missing key error", async () => {
  const service = new OpenAIService({
    configLoader: async () => ({
      apiKeys: { openai: "" },
      modelPreferences: { defaultModel: "gpt-test", fallbackModels: [] },
    }),
  });

  await assert.rejects(
    () => service.generateResponse({ input: "hello" }),
    OpenAIConfigurationError,
  );
});

test("generateResponse falls back to the next configured model", async () => {
  const attemptedModels = [];

  const service = new OpenAIService({
    maxRetries: 0,
    configLoader: async () => ({
      apiKeys: { openai: "sk-test" },
      modelPreferences: { defaultModel: "missing-model", fallbackModels: ["working-model"] },
    }),
    clientFactory: () => ({
      responses: {
        create: async (payload) => {
          attemptedModels.push(payload.model);
          if (payload.model === "missing-model") {
            const error = new Error("model not found");
            error.status = 404;
            error.error = { code: "model_not_found" };
            throw error;
          }

          return { id: "response-2", model: payload.model, output_text: "fallback ok" };
        },
      },
    }),
  });

  const fallbacks = [];
  const response = await service.generateResponse({
    input: "hello",
    onModelFallback: (event) => fallbacks.push(event),
  });

  assert.deepEqual(attemptedModels, ["missing-model", "working-model"]);
  assert.equal(fallbacks[0].fromModel, "missing-model");
  assert.equal(fallbacks[0].toModel, "working-model");
  assert.equal(response.outputText, "fallback ok");
});
