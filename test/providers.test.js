import assert from "node:assert/strict";
import test from "node:test";
import { ProviderFactory } from "../src/services/provider-factory.js";
import { AnthropicService, AnthropicConfigurationError } from "../src/services/anthropic/anthropic-service.js";
import { OllamaService } from "../src/services/ollama/ollama-service.js";

test("ProviderFactory selects correct provider based on name or config", async () => {
  const mockOpenAI = { name: "openai" };
  const mockAnthropic = { name: "anthropic" };
  const mockOllama = { name: "ollama" };

  const factory = new ProviderFactory({
    configLoader: async () => ({ provider: "openai" }),
    openAIService: mockOpenAI,
    anthropicService: mockAnthropic,
    ollamaService: mockOllama
  });

  assert.equal(await factory.getProvider(), mockOpenAI);
  assert.equal(await factory.getProvider("anthropic"), mockAnthropic);
  assert.equal(await factory.getProvider("claude"), mockAnthropic);
  assert.equal(await factory.getProvider("ollama"), mockOllama);
  assert.equal(await factory.getProvider("local"), mockOllama);
});

test("AnthropicService throws error when API key is missing", async () => {
  const service = new AnthropicService({
    configLoader: async () => ({ apiKeys: { anthropic: "" } })
  });

  const iterator = service.streamResponse({ input: "hello" });
  await assert.rejects(
    async () => {
      for await (const chunk of iterator) {
        void chunk;
      }
    },
    (err) => err instanceof AnthropicConfigurationError
  );
});

test("AnthropicService streams text deltas when API key is present", async () => {
  const sseData = "data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"Hello from Claude\"}}\n\n";
  const mockFetch = async () => ({
    ok: true,
    body: {
      getReader() {
        let readCount = 0;
        return {
          async read() {
            if (readCount === 0) {
              readCount++;
              return { done: false, value: new TextEncoder().encode(sseData) };
            }
            return { done: true, value: undefined };
          }
        };
      }
    }
  });

  const service = new AnthropicService({
    configLoader: async () => ({ apiKeys: { anthropic: "test-key" } }),
    fetchFn: mockFetch
  });

  const chunks = [];
  for await (const chunk of service.streamResponse({ input: "hi" })) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].delta, "Hello from Claude");
});

test("OllamaService streams text deltas from local endpoint", async () => {
  const jsonLine = JSON.stringify({ message: { content: "Hello from Ollama" } }) + "\n";
  const mockFetch = async () => ({
    ok: true,
    body: {
      getReader() {
        let readCount = 0;
        return {
          async read() {
            if (readCount === 0) {
              readCount++;
              return { done: false, value: new TextEncoder().encode(jsonLine) };
            }
            return { done: true, value: undefined };
          }
        };
      }
    }
  });

  const service = new OllamaService({
    configLoader: async () => ({ endpoints: { ollama: "http://localhost:11434" } }),
    fetchFn: mockFetch
  });

  const chunks = [];
  for await (const chunk of service.streamResponse({ input: "hi" })) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].delta, "Hello from Ollama");
});
