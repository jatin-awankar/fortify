import { loadRuntimeConfig } from "../../config/index.js";

const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

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

    const selectedModel = model || config?.modelPreferences?.geminiModel || DEFAULT_GEMINI_MODEL;

    // Convert input to Gemini contents format (roles: "user" | "model")
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

    const url = `${this.baseUrl}/models/${selectedModel}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(bodyPayload),
      signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Gemini API error (${response.status}): ${errorText}`);
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
