import { loadRuntimeConfig } from "../../config/index.js";

const DEFAULT_OLLAMA_MODEL = "llama3";
const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";

export class OllamaService {
  constructor({
    configLoader = loadRuntimeConfig,
    fetchFn = globalThis.fetch
  } = {}) {
    this.configLoader = configLoader;
    this.fetchFn = fetchFn;
    this.cachedInstalledModels = null;
  }

  async fetchInstalledModels(endpoint) {
    if (this.cachedInstalledModels && this.cachedInstalledModels.length > 0) {
      return this.cachedInstalledModels;
    }

    try {
      const response = await this.fetchFn(`${endpoint}/api/tags`, { method: "GET" });
      if (!response.ok) return [];
      const data = await response.json();
      const models = (data?.models || []).map((m) => m.name || m.model).filter(Boolean);
      if (models.length > 0) {
        this.cachedInstalledModels = models;
        return models;
      }
    } catch {
      // Ignore network error during discovery
    }
    return [];
  }

  async *streamResponse({
    input,
    model,
    instructions,
    signal
  }) {
    const config = await this.configLoader();
    const endpoint = config?.endpoints?.ollama || DEFAULT_OLLAMA_ENDPOINT;

    const installedModels = await this.fetchInstalledModels(endpoint);
    const primaryModel = model || config?.modelPreferences?.ollamaModel || (installedModels[0] || DEFAULT_OLLAMA_MODEL);

    const modelChain = Array.from(new Set([primaryModel, ...installedModels, DEFAULT_OLLAMA_MODEL]));

    const messages = [];
    if (instructions) {
      messages.push({ role: "system", content: instructions });
    }

    if (Array.isArray(input)) {
      for (const msg of input) {
        messages.push({
          role: msg.role === "assistant" ? "assistant" : msg.role === "system" ? "system" : "user",
          content: msg.content
        });
      }
    } else if (typeof input === "string") {
      messages.push({ role: "user", content: input });
    }

    let lastError;
    for (const selectedModel of modelChain) {
      try {
        const stream = this.#streamForModel({
          endpoint,
          selectedModel,
          messages,
          signal
        });

        for await (const chunk of stream) {
          yield chunk;
        }

        return; // Success
      } catch (err) {
        lastError = err;
        // Try next installed model if model not found error
        if (!err.message?.includes("not found") && !err.message?.includes("404")) {
          throw err;
        }
      }
    }

    throw lastError;
  }

  async *#streamForModel({
    endpoint,
    selectedModel,
    messages,
    signal
  }) {
    const bodyPayload = {
      model: selectedModel,
      messages,
      stream: true
    };

    let response;
    try {
      response = await this.fetchFn(`${endpoint}/api/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(bodyPayload),
        signal
      });
    } catch (err) {
      throw new Error(`Failed to connect to Ollama server at ${endpoint}. Is Ollama running? (${err.message})`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error("Ollama API returned empty response body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const data = JSON.parse(trimmed);
            if (data.message?.content) {
              yield {
                type: "text_delta",
                delta: data.message.content
              };
            }
          } catch {
            // ignore invalid JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock?.();
    }
  }
}
