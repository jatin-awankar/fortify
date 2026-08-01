import assert from "node:assert/strict";
import test from "node:test";
import { GeminiService, GeminiConfigurationError } from "../src/services/gemini/gemini-service.js";
import { ProviderFactory } from "../src/services/provider-factory.js";

test("GeminiService throws error when API key is missing", async () => {
  const service = new GeminiService({
    configLoader: async () => ({ apiKeys: { gemini: "" } })
  });

  const iterator = service.streamResponse({ input: "hello" });
  await assert.rejects(
    async () => {
      for await (const chunk of iterator) {
        void chunk;
      }
    },
    (err) => err instanceof GeminiConfigurationError
  );
});

test("GeminiService streams text deltas from Google Gemini SSE API", async () => {
  const sseChunk = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hello from Gemini!\"}]}}]}\n\n";

  const mockFetch = async (url, options) => {
    assert.equal(options.headers["x-goog-api-key"], "test-gemini-key");
    if (url.endsWith("/models")) {
      return {
        ok: true,
        json: async () => ({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] })
      };
    }
    return {
      ok: true,
      body: {
        getReader() {
          let readCount = 0;
          return {
            async read() {
              if (readCount === 0) {
                readCount++;
                return { done: false, value: new TextEncoder().encode(sseChunk) };
              }
              return { done: true, value: undefined };
            }
          };
        }
      }
    };
  };

  const service = new GeminiService({
    configLoader: async () => ({ apiKeys: { gemini: "test-gemini-key" } }),
    fetchFn: mockFetch
  });

  const chunks = [];
  for await (const chunk of service.streamResponse({ input: "Hi" })) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].delta, "Hello from Gemini!");
});

test("ProviderFactory resolves GeminiService for gemini or google provider name", async () => {
  const mockGemini = { name: "gemini" };
  const factory = new ProviderFactory({
    configLoader: async () => ({ provider: "openai" }),
    geminiService: mockGemini
  });

  assert.equal(await factory.getProvider("gemini"), mockGemini);
  assert.equal(await factory.getProvider("google"), mockGemini);
});
