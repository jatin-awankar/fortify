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
      let chunksYielded = 0;
      try {
        const stream = this.#streamForModel({
          input,
          selectedModel,
          instructions,
          maxOutputTokens,
          apiKey,
          signal
        });

        for await (const chunk of stream) {
          yield chunk;
          chunksYielded++;
        }

        return; // Success
      } catch (err) {
        lastError = err;
        
        if (chunksYielded > 0) {
          throw err;
        }

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
          const role = msg.role === "assistant" ? "assistant" : "user";
          const lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.role === role) {
            lastMsg.content = `${lastMsg.content}\n\n${msg.content}`;
          } else {
            messages.push({ role, content: msg.content });
          }
        }
      }
    } else if (typeof input === "string") {
      messages.push({ role: "user", content: input });
    }

    if (messages.length > 0 && messages[0].role !== "user") {
      messages.unshift({ role: "user", content: "[System initiated conversation]" });
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

  /**
   * Create a response with tool-use support (for agentic loop).
   * Converts between OpenAI and Anthropic tool formats.
   * Includes model fallback chain for resilience.
   */
  async createResponse({ input, model, tools, signal }) {
    const config = await this.configLoader();
    const apiKey = config?.apiKeys?.anthropic || process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new AnthropicConfigurationError(
        "Anthropic API key is missing."
      );
    }

    const primaryModel = model || config?.modelPreferences?.anthropicModel || DEFAULT_ANTHROPIC_MODEL;
    const discoveredModels = await this.fetchAvailableModels(apiKey);
    const modelChain = Array.from(new Set([
      primaryModel,
      ...discoveredModels,
      ...STATIC_ANTHROPIC_FALLBACKS,
    ]));

    let lastError;
    for (const selectedModel of modelChain) {
      try {
        return await this.#createResponseForModel({
          input,
          selectedModel,
          tools,
          apiKey,
          signal,
        });
      } catch (err) {
        lastError = err;
        const msg = (err?.message || "").toLowerCase();
        const shouldFallback = msg.includes("429") || msg.includes("rate_limit") ||
          msg.includes("not_found") || msg.includes("overloaded") ||
          msg.includes("529");

        if (!shouldFallback) {
          throw err;
        }
        // Try next model in chain
      }
    }

    throw lastError;
  }

  /**
   * Internal: create a tool-use response for a specific model.
   * @private
   */
  async #createResponseForModel({ input, selectedModel, tools, apiKey, signal }) {
    const messages = [];
    let systemPrompt = "";

    if (Array.isArray(input)) {
      for (const msg of input) {
        if (msg.role === "system") {
          systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
        } else if (msg.role === "tool") {
          const toolResultBlock = {
            type: "tool_result",
            tool_use_id: msg.tool_call_id,
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
          };

          // Merge consecutive tool_result messages into a single user message
          // Anthropic requires alternating user/assistant roles
          const lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.role === "user" && Array.isArray(lastMsg.content) &&
              lastMsg.content.length > 0 && lastMsg.content[0]?.type === "tool_result") {
            lastMsg.content.push(toolResultBlock);
          } else {
            messages.push({
              role: "user",
              content: [toolResultBlock],
            });
          }
        } else if (msg.role === "assistant" && msg.tool_calls) {
          const content = [];
          // Guard against empty text blocks — Anthropic API rejects { type: "text", text: "" }
          if (msg.content && typeof msg.content === "string" && msg.content.trim()) {
            content.push({ type: "text", text: msg.content });
          }
          for (const tc of msg.tool_calls) {
            let parsedInput = {};
            if (typeof tc.function?.arguments === "string") {
              try {
                parsedInput = JSON.parse(tc.function.arguments);
              } catch {
                // If arguments is malformed JSON, pass as-is in a wrapper
                parsedInput = { _raw: tc.function.arguments };
              }
            } else {
              parsedInput = tc.function?.arguments || tc.arguments || {};
            }

            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function?.name || tc.name,
              input: parsedInput,
            });
          }
          messages.push({ role: "assistant", content });
        } else {
          const role = msg.role === "assistant" ? "assistant" : "user";
          const lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.role === role && typeof lastMsg.content === "string") {
            lastMsg.content = `${lastMsg.content}\n\n${msg.content}`;
          } else {
            messages.push({ role, content: msg.content });
          }
        }
      }
    }

    if (messages.length > 0 && messages[0].role !== "user") {
      messages.unshift({ role: "user", content: "[System initiated conversation]" });
    }

    const bodyPayload = {
      model: selectedModel,
      max_tokens: 4096,
      messages,
    };

    if (systemPrompt) bodyPayload.system = systemPrompt;

    if (Array.isArray(tools) && tools.length > 0) {
      bodyPayload.tools = tools.map((t) => ({
        name: t.function?.name || t.name,
        description: t.function?.description || t.description || "",
        input_schema: t.function?.parameters || t.parameters || { type: "object", properties: {} },
      }));
    }

    const response = await this.fetchFn(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(bodyPayload),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(parseApiErrorResponse(response.status, errorText, `Anthropic Claude (${selectedModel})`));
    }

    const data = await response.json();

    const textBlocks = (data.content || []).filter((b) => b.type === "text");
    const toolBlocks = (data.content || []).filter((b) => b.type === "tool_use");

    const openaiToolCalls = toolBlocks.map((tb) => ({
      id: tb.id,
      type: "function",
      function: {
        name: tb.name,
        arguments: JSON.stringify(tb.input || {}),
      },
    }));

    return {
      choices: [{
        message: {
          role: "assistant",
          content: textBlocks.map((b) => b.text).join("\n") || null,
          tool_calls: openaiToolCalls.length > 0 ? openaiToolCalls : undefined,
        },
        finish_reason: data.stop_reason === "tool_use" ? "tool_calls" : "stop",
      }],
    };
  }
}

