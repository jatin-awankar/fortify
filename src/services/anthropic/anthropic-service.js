import { loadRuntimeConfig } from "../../config/index.js";

const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-20241022";

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

    const selectedModel = model || config?.modelPreferences?.anthropicModel || DEFAULT_ANTHROPIC_MODEL;

    // Separate system message if present in input
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
      throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
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
    } finally {
      reader.releaseLock?.();
    }
  }
}
