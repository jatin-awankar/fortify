import { loadRuntimeConfig } from "../../config/index.js";
import { parseApiErrorResponse } from "../../utils/api-error-parser.js";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const STATIC_FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-3.1-flash-lite"
];

export class GeminiConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "GeminiConfigurationError";
  }
}

export class GeminiService {
  constructor({
    configLoader = loadRuntimeConfig,
    fetchFn = globalThis.fetch,
    baseUrl = "https://generativelanguage.googleapis.com/v1beta"
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
        headers: { "x-goog-api-key": apiKey }
      });

      if (!response.ok) {
        return STATIC_FALLBACK_MODELS;
      }

      const data = await response.json();
      const rawModels = data?.models || [];
      const textModels = rawModels
        .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""))
        .filter((name) => !name.includes("embedding") && !name.includes("imagen") && !name.includes("veo") && !name.includes("audio") && !name.includes("tts"));

      if (textModels.length > 0) {
        this.cachedDiscoveredModels = textModels;
        return textModels;
      }
    } catch {
      // Fall back to static models if network error during discovery
    }

    return STATIC_FALLBACK_MODELS;
  }

  async *streamResponse({
    input,
    model,
    instructions,
    maxOutputTokens = 2048,
    temperature = 0.2,
    signal
  }) {
    const config = await this.configLoader();
    const apiKey = config?.apiKeys?.gemini || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new GeminiConfigurationError(
        "Google Gemini API key is missing. Run `fortify auth --provider gemini` or set GEMINI_API_KEY env var."
      );
    }

    const primaryModel = model || config?.modelPreferences?.geminiModel || DEFAULT_GEMINI_MODEL;
    const discoveredModels = await this.fetchAvailableModels(apiKey);

    const modelChain = Array.from(new Set([
      primaryModel,
      ...discoveredModels,
      ...STATIC_FALLBACK_MODELS
    ]));

    let lastError;
    for (const selectedModel of modelChain) {
      try {
        const stream = this.#streamForModel({
          input,
          selectedModel,
          instructions,
          maxOutputTokens,
          temperature,
          apiKey,
          signal
        });

        for await (const chunk of stream) {
          yield chunk;
        }

        return; // Success
      } catch (err) {
        lastError = err;
        const isQuotaErr = err?.message?.includes("429") || err?.message?.includes("quota") || err?.message?.includes("RESOURCE_EXHAUSTED");
        if (!isQuotaErr) {
          throw err;
        }
        // If quota error (429), try next model in dynamic fallback chain
      }
    }

    throw lastError;
  }

  async *#streamForModel({
    input,
    selectedModel,
    instructions,
    maxOutputTokens,
    temperature,
    apiKey,
    signal
  }) {
    const contents = [];
    let systemText = instructions || "";

    if (Array.isArray(input)) {
      for (const msg of input) {
        if (msg.role === "system") {
          systemText = systemText ? `${systemText}\n\n${msg.content}` : msg.content;
        } else {
          contents.push({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: msg.content }]
          });
        }
      }
    } else if (typeof input === "string") {
      contents.push({
        role: "user",
        parts: [{ text: input }]
      });
    }

    const bodyPayload = {
      contents,
      generationConfig: {
        maxOutputTokens,
        temperature
      }
    };

    if (systemText) {
      bodyPayload.systemInstruction = {
        parts: [{ text: systemText }]
      };
    }

    const url = `${this.baseUrl}/models/${selectedModel}:streamGenerateContent?alt=sse`;

    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(bodyPayload),
      signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(parseApiErrorResponse(response.status, errorText, `Google Gemini (${selectedModel})`));
    }

    if (!response.body) {
      throw new Error("Google Gemini API returned empty response body.");
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
              const textChunk = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (textChunk) {
                yield {
                  type: "text_delta",
                  delta: textChunk
                };
              }
            } catch {
              // ignore invalid JSON chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock?.();
    }
  }
}
