import { loadRuntimeConfig } from "../../config/index.js";
import { parseApiErrorResponse } from "../../utils/api-error-parser.js";

const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";
const STATIC_FALLBACK_MODELS = [
  "gemini-1.5-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash",
  "gemini-1.5-pro",
  "gemini-2.5-flash-lite"
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
      let chunksYielded = 0;
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
          chunksYielded++;
        }

        return; // Success
      } catch (err) {
        lastError = err;
        
        if (chunksYielded > 0) {
          throw err;
        }

        const msg = (err?.message || "").toLowerCase();
        const shouldFallback = msg.includes("429") || msg.includes("404") || msg.includes("503") || msg.includes("quota") || msg.includes("resource_exhausted") || msg.includes("no longer available") || msg.includes("not_found") || msg.includes("high demand") || msg.includes("unavailable") || msg.includes("overloaded");
        
        if (!shouldFallback) {
          throw err;
        }
        // If 404 (deprecated), 429 (quota), or 503 (high demand), automatically try next model in chain
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
          const role = msg.role === "assistant" ? "model" : "user";
          const lastMsg = contents[contents.length - 1];
          if (lastMsg && lastMsg.role === role) {
            lastMsg.parts[0].text = `${lastMsg.parts[0].text}\n\n${msg.content}`;
          } else {
            contents.push({ role, parts: [{ text: msg.content }] });
          }
        }
      }
    } else if (typeof input === "string") {
      contents.push({
        role: "user",
        parts: [{ text: input }]
      });
    }

    if (contents.length > 0 && contents[0].role !== "user") {
      contents.unshift({ role: "user", parts: [{ text: "[System initiated conversation]" }] });
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
              const finishReason = data.candidates?.[0]?.finishReason;
              if (finishReason === "SAFETY" || finishReason === "RECITATION") {
                throw new Error(`Google Gemini API blocked the response due to safety filter (${finishReason}).`);
              }
              const textChunk = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (textChunk) {
                yield {
                  type: "text_delta",
                  delta: textChunk
                };
              }
            } catch (err) {
              if (err.message.includes("safety filter")) throw err;
              // ignore invalid JSON chunks
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
              const finishReason = data.candidates?.[0]?.finishReason;
              if (finishReason === "SAFETY" || finishReason === "RECITATION") {
                throw new Error(`Google Gemini API blocked the response due to safety filter (${finishReason}).`);
              }
              const textChunk = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (textChunk) yield { type: "text_delta", delta: textChunk };
            } catch (err) {
              if (err.message.includes("safety filter")) throw err;
            }
          }
        }
      }
    } finally {
      reader.releaseLock?.();
    }
  }

  /**
   * Build a mapping from tool_call_id → tool name from an array of messages.
   * Used to correlate tool results with their originating function calls,
   * which Gemini requires for functionResponse.
   * @param {object[]} messages - OpenAI-format messages
   * @returns {Map<string, string>}
   */
  #buildToolCallIdMap(messages) {
    const map = new Map();
    if (!Array.isArray(messages)) return map;

    for (const msg of messages) {
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const id = tc.id;
          const name = tc.function?.name || tc.name;
          if (id && name) {
            map.set(id, name);
          }
        }
      }
    }
    return map;
  }

  /**
   * Create a response with tool-use support (for agentic loop).
   * Converts between OpenAI and Gemini function-calling formats.
   * Includes model fallback chain for resilience.
   */
  async createResponse({ input, model, tools, signal }) {
    const config = await this.configLoader();
    const apiKey = config?.apiKeys?.gemini || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new GeminiConfigurationError("Google Gemini API key is missing.");
    }

    const primaryModel = model || config?.modelPreferences?.geminiModel || DEFAULT_GEMINI_MODEL;
    const discoveredModels = await this.fetchAvailableModels(apiKey);
    const modelChain = Array.from(new Set([
      primaryModel,
      ...discoveredModels,
      ...STATIC_FALLBACK_MODELS,
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
        const shouldFallback = msg.includes("429") || msg.includes("404") ||
          msg.includes("503") || msg.includes("quota") ||
          msg.includes("resource_exhausted") || msg.includes("not_found") ||
          msg.includes("unavailable") || msg.includes("overloaded");

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
    // Build tool_call_id → name mapping for functionResponse correlation
    const toolCallIdMap = this.#buildToolCallIdMap(input);

    const contents = [];
    let systemText = "";

    if (Array.isArray(input)) {
      // Collect consecutive tool results to batch into a single function message
      let pendingToolParts = [];

      const flushToolParts = () => {
        if (pendingToolParts.length > 0) {
          contents.push({
            role: "function",
            parts: [...pendingToolParts],
          });
          pendingToolParts = [];
        }
      };

      for (const msg of input) {
        if (msg.role === "system") {
          flushToolParts();
          systemText = systemText ? `${systemText}\n\n${msg.content}` : msg.content;
        } else if (msg.role === "tool") {
          // Resolve the tool name from the tool_call_id via our mapping
          const resolvedName = toolCallIdMap.get(msg.tool_call_id) || msg.name || "tool_result";
          pendingToolParts.push({
            functionResponse: {
              name: resolvedName,
              response: { content: msg.content },
            },
          });
        } else if (msg.role === "assistant" && msg.tool_calls) {
          flushToolParts();
          const parts = [];
          if (msg.content) parts.push({ text: msg.content });
          for (const tc of msg.tool_calls) {
            parts.push({
              functionCall: {
                name: tc.function?.name || tc.name,
                args: typeof tc.function?.arguments === "string"
                  ? JSON.parse(tc.function.arguments)
                  : (tc.function?.arguments || tc.arguments || {}),
              },
            });
          }
          contents.push({ role: "model", parts });
        } else {
          flushToolParts();
          const role = msg.role === "assistant" ? "model" : "user";
          const lastMsg = contents[contents.length - 1];
          if (lastMsg && lastMsg.role === role && typeof lastMsg.parts?.[0]?.text === "string") {
            lastMsg.parts[0].text = `${lastMsg.parts[0].text}\n\n${msg.content}`;
          } else {
            contents.push({ role, parts: [{ text: msg.content }] });
          }
        }
      }

      // Flush any remaining tool parts
      flushToolParts();
    }

    if (contents.length > 0 && contents[0].role !== "user") {
      contents.unshift({ role: "user", parts: [{ text: "[System initiated conversation]" }] });
    }

    const bodyPayload = {
      contents,
      generationConfig: { maxOutputTokens: 4096 },
    };

    if (systemText) {
      bodyPayload.systemInstruction = { parts: [{ text: systemText }] };
    }

    if (Array.isArray(tools) && tools.length > 0) {
      bodyPayload.tools = [{
        functionDeclarations: tools.map((t) => ({
          name: t.function?.name || t.name,
          description: t.function?.description || t.description || "",
          parameters: t.function?.parameters || t.parameters || { type: "object", properties: {} },
        })),
      }];
    }

    const url = `${this.baseUrl}/models/${selectedModel}:generateContent`;
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(bodyPayload),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(parseApiErrorResponse(response.status, errorText, `Google Gemini (${selectedModel})`));
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];

    // Handle safety blocks and content filters
    const finishReason = candidate?.finishReason;
    if (finishReason === "SAFETY" || finishReason === "RECITATION" || finishReason === "BLOCKED") {
      throw new Error(`Google Gemini API blocked the response due to content filter (${finishReason}).`);
    }

    const parts = candidate?.content?.parts || [];

    const textParts = parts.filter((p) => p.text);
    const fnParts = parts.filter((p) => p.functionCall);

    const openaiToolCalls = fnParts.map((fp, i) => ({
      id: `call_gemini_${Date.now()}_${i}`,
      type: "function",
      function: {
        name: fp.functionCall.name,
        arguments: JSON.stringify(fp.functionCall.args || {}),
      },
    }));

    return {
      choices: [{
        message: {
          role: "assistant",
          content: textParts.map((p) => p.text).join("\n") || null,
          tool_calls: openaiToolCalls.length > 0 ? openaiToolCalls : undefined,
        },
        finish_reason: fnParts.length > 0 ? "tool_calls" : "stop",
      }],
    };
  }
}
