import { loadRuntimeConfig } from "../../config/index.js";
import { parseApiErrorResponse } from "../../utils/api-error-parser.js";

const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-20241022";
const STATIC_ANTHROPIC_FALLBACKS = [
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229"
];

export class AnthropicConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnthropicConfigurationError";
  }
}

export class AnthropicService {
  constructor({
    configLoader = loadRuntimeConfig,
    fetchFn = globalThis.fetch,
    baseUrl = "https://api.anthropic.com/v1"
  } = {}) {
    this.configLoader = configLoader;
    this.fetchFn = fetchFn;
    this.baseUrl = baseUrl;
    this.cachedDiscoveredModels = null;
  }

  async fetchAvailableModels(apiKey) {
    if (this.cachedDiscoveredModels && this.cachedDiscoveredModels.length > 0) {
      return this.cachedDiscoveredModels;
    }

    try {
      const response = await this.fetchFn(`${this.baseUrl}/models`, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        }
      });

      if (!response.ok) return STATIC_ANTHROPIC_FALLBACKS;

      const data = await response.json();
      const rawModels = data?.data || [];
      const modelNames = rawModels.map((m) => m.id).filter(Boolean);

      if (modelNames.length > 0) {
        this.cachedDiscoveredModels = modelNames;
        return modelNames;
      }
    } catch {
      // Fall back if network error during discovery
    }

    return STATIC_ANTHROPIC_FALLBACKS;
  }

  async *streamResponse({
    input,
    model,
    instructions,
    maxOutputTokens = 1024,
    signal
  }) {
    const config = await this.configLoader();
    const apiKey = config?.apiKeys?.anthropic || process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new AnthropicConfigurationError(
        "Anthropic API key is missing. Run `fortify config set apiKeys.anthropic <key>` or set ANTHROPIC_API_KEY env var."
      );
    }

    const primaryModel = model || config?.modelPreferences?.anthropicModel || DEFAULT_ANTHROPIC_MODEL;
    const discoveredModels = await this.fetchAvailableModels(apiKey);

    const modelChain = Array.from(new Set([
      primaryModel,
      ...discoveredModels,
      ...STATIC_ANTHROPIC_FALLBACKS
    ]));

    let lastError;
    for (const selectedModel of modelChain) {
      try {
        const stream = this.#streamForModel({
          apiKey,
          selectedModel,
          input,
          instructions,
          maxOutputTokens,
          signal
        });

        for await (const chunk of stream) {
          yield chunk;
        }

        return; // Success
      } catch (err) {
        lastError = err;
        const isQuotaOrModelErr = err?.message?.includes("429") || err?.message?.includes("rate_limit") || err?.message?.includes("not_found");
        if (!isQuotaOrModelErr) {
          throw err;
        }
        // Try next model if quota or model error
      }
    }

    throw lastError;
  }

  async *#streamForModel({
    apiKey,
    selectedModel,
    input,
    instructions,
    maxOutputTokens,
    signal
  }) {
    const messages = [];
    let systemPrompt = instructions || "";

    if (Array.isArray(input)) {
      for (const msg of input) {
        if (msg.role === "system") {
          systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
        } else {
          messages.push({
            role: msg.role === "assistant" ? "assistant" : "user",
            content: msg.content
          });
        }
      }
    } else if (typeof input === "string") {
      messages.push({ role: "user", content: input });
    }

    const bodyPayload = {
      model: selectedModel,
      max_tokens: maxOutputTokens,
      messages,
      stream: true
    };

    if (systemPrompt) {
      bodyPayload.system = systemPrompt;
    }

    const response = await this.fetchFn(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(bodyPayload),
      signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(parseApiErrorResponse(response.status, errorText, `Anthropic Claude (${selectedModel})`));
    }

    if (!response.body) {
      throw new Error("Anthropic API returned empty response body.");
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
          if (trimmed.startsWith("data: ")) {
            const dataStr = trimmed.slice(6);
            if (dataStr === "[DONE]") continue;

            try {
              const data = JSON.parse(dataStr);
              if (data.type === "content_block_delta" && data.delta?.text) {
                yield {
                  type: "text_delta",
                  delta: data.delta.text
                };
              }
            } catch {
              // ignore parse errors for partial chunks
            }
          }
        }
      }

      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data: ")) {
          const dataStr = trimmed.slice(6);
          if (dataStr !== "[DONE]") {
            try {
              const data = JSON.parse(dataStr);
              if (data.type === "content_block_delta" && data.delta?.text) {
                yield { type: "text_delta", delta: data.delta.text };
              }
            } catch {}
          }
        }
      }
    } finally {
      reader.releaseLock?.();
    }
  }
}
