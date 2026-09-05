import { appMetadata } from "../../config/app-metadata.js";
import { loadRuntimeConfig } from "../../config/index.js";
import { resolveModelChain } from "../../config/model-preferences.js";
import { parseApiErrorResponse } from "../../utils/api-error-parser.js";
import { withRetry } from "../../utils/retry.js";
import {
  OpenAIConfigurationError,
  OpenAITimeoutError,
  isModelFallbackEligibleError,
  isRetryableOpenAIError,
  normalizeOpenAIError,
} from "./openai-service-errors.js";

const DEFAULT_MODEL = "gpt-5.4";

export class OpenAIService {
  constructor({
    configLoader = loadRuntimeConfig,
    fetchFn = globalThis.fetch,
    clientFactory = null,
    timeoutMs = 60_000,
    maxRetries = 2,
    retryBaseDelayMs = 500,
    retryMaxDelayMs = 5_000,
    baseUrl = "https://api.openai.com/v1"
  } = {}) {
    this.configLoader = configLoader;
    this.fetchFn = fetchFn;
    this.clientFactory = clientFactory;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.retryBaseDelayMs = retryBaseDelayMs;
    this.retryMaxDelayMs = retryMaxDelayMs;
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
        headers: { Authorization: `Bearer ${apiKey}` }
      });

      if (!response.ok) return [];

      const data = await response.json();
      const rawModels = data?.data || [];
      const chatModels = rawModels
        .map((m) => m.id)
        .filter((id) => typeof id === "string" && (id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3")))
        .filter((id) => !id.includes("audio") && !id.includes("realtime") && !id.includes("transcription"));

      if (chatModels.length > 0) {
        this.cachedDiscoveredModels = chatModels;
        return chatModels;
      }
    } catch {
      // Ignore discovery network error
    }

    return [];
  }

  async generateResponse({
    input,
    model,
    instructions,
    maxOutputTokens,
    temperature,
    timeoutMs,
    maxRetries,
    metadata,
    signal,
    onModelFallback,
  }) {
    return this.#executeWithModelFallback(
      async (selectedModel) => {
        const requestPayload = await this.#buildRequestPayload({
          input,
          selectedModel,
          instructions,
          maxOutputTokens,
          temperature,
          metadata,
          stream: false,
        });

        const response = await this.#executeWithRetry(
          async (internalSignal) => {
            const activeSignal = internalSignal || signal;
            if (typeof this.clientFactory === "function") {
              const apiKey = await this.#loadApiKey();
              const client = this.clientFactory({
                apiKey,
                maxRetries: 0,
                timeout: timeoutMs ?? this.timeoutMs,
              });
              return client.responses.create(requestPayload, { signal: activeSignal });
            }

            return this.#rawFetchRequest(requestPayload, { timeoutMs, signal: activeSignal });
          },
          { timeoutMs, maxRetries, signal },
        );

        return {
          id: response.id || "res-1",
          model: response.model || selectedModel,
          outputText: response.output_text ?? response.choices?.[0]?.message?.content ?? "",
          response,
        };
      },
      { model, onModelFallback },
    );
  }

  /**
   * Create a response with tool-use support (for agentic loop).
   *
   * Returns the raw OpenAI chat completion response format:
   *   { choices: [{ message: { content, tool_calls } }] }
   *
   * @param {object} options
   * @param {string|object[]} options.input - Messages (OpenAI format)
   * @param {string} [options.model] - Model name
   * @param {object[]} [options.tools] - OpenAI function calling tools schema
   * @param {AbortSignal} [options.signal] - Abort signal
   * @returns {Promise<object>} OpenAI chat completion response
   */
  async createResponse({ input, model, tools, signal }) {
    return this.#executeWithModelFallback(
      async (selectedModel) => {
        const requestPayload = await this.#buildRequestPayload({
          input,
          selectedModel,
          stream: false,
          tools,
        });

        const response = await this.#executeWithRetry(
          async (internalSignal) => {
            const activeSignal = internalSignal || signal;
            if (typeof this.clientFactory === "function") {
              const apiKey = await this.#loadApiKey();
              const client = this.clientFactory({
                apiKey,
                maxRetries: 0,
                timeout: this.timeoutMs,
              });
              return client.chat.completions.create(requestPayload, { signal: activeSignal });
            }

            return this.#rawFetchRequest(requestPayload, { signal: activeSignal });
          },
          { signal },
        );

        // Guard against malformed responses — ensure consistent shape for agentic loop
        if (!response?.choices?.length || !response.choices[0]?.message) {
          return {
            choices: [{
              message: {
                role: "assistant",
                content: response?.choices?.[0]?.message?.content ?? null,
                tool_calls: undefined,
              },
              finish_reason: "stop",
            }],
          };
        }

        return response;
      },
      { model },
    );
  }

  async *streamResponse({
    input,
    model,
    instructions,
    maxOutputTokens,
    temperature,
    timeoutMs,
    maxRetries,
    metadata,
    signal,
    onModelFallback,
  }) {
    const modelChain = await this.#resolveModelChain(model);
    let lastError;

    for (let modelIndex = 0; modelIndex < modelChain.length; modelIndex += 1) {
      const selectedModel = modelChain[modelIndex];
      const modelStream = this.#streamForModel({
        input,
        selectedModel,
        instructions,
        maxOutputTokens,
        temperature,
        timeoutMs,
        maxRetries,
        metadata,
        signal,
      });
      const modelIterator = modelStream[Symbol.asyncIterator]();

      let chunksYielded = 0;
      try {
        while (true) {
          const { done, value } = await modelIterator.next();
          if (done) {
            break;
          }

          yield value;
          chunksYielded++;
        }

        return;
      } catch (error) {
        if (typeof modelIterator.return === "function") {
          try {
            await modelIterator.return();
          } catch {
            // Best-effort cleanup
          }
        }

        lastError = normalizeOpenAIError(error, { fallbackMessage: "Failed during OpenAI stream." });

        if (chunksYielded > 0) {
          throw lastError;
        }

        const nextModel = modelChain[modelIndex + 1];

        if (!nextModel || !isModelFallbackEligibleError(lastError)) {
          throw lastError;
        }

        onModelFallback?.({
          fromModel: selectedModel,
          toModel: nextModel,
          error: lastError,
        });
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
    timeoutMs,
    maxRetries,
    metadata,
    signal,
  }) {
    const requestPayload = await this.#buildRequestPayload({
      input,
      selectedModel,
      instructions,
      maxOutputTokens,
      temperature,
      metadata,
      stream: true,
    });

    if (typeof this.clientFactory === "function") {
      const stream = await this.#executeWithRetry(
        async (internalSignal) => {
          const activeSignal = internalSignal || signal;
          const apiKey = await this.#loadApiKey();
          const client = this.clientFactory({
            apiKey,
            maxRetries: 0,
            timeout: timeoutMs ?? this.timeoutMs,
          });
          return client.responses.create(requestPayload, { signal: activeSignal });
        },
        { timeoutMs, maxRetries, signal },
      );

      const requestTimeoutMs = timeoutMs ?? this.timeoutMs;
      for await (const event of this.#iterateStreamWithTimeout(stream, requestTimeoutMs, signal)) {
        if (event?.type === "error") {
          throw normalizeOpenAIError(event.error, { fallbackMessage: "OpenAI streaming failed." });
        }
        if (event?.type === "response.output_text.delta") {
          yield { type: "text_delta", delta: event.delta ?? "", event };
          continue;
        }
        if (event?.type === "response.output_text.done") {
          yield { type: "text_done", text: event.text ?? "", event };
          continue;
        }
        yield { type: "event", event };
      }
      return;
    }

    // Native SSE Streaming over node:fetch
    const apiKey = await this.#loadApiKey();
    const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestPayload),
      signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsedError;
      try { parsedError = JSON.parse(errorText); } catch {}
      const formattedMessage = parseApiErrorResponse(response.status, errorText, "OpenAI");
      const err = new Error(formattedMessage);
      err.status = response.status;
      err.error = parsedError?.error;
      throw normalizeOpenAIError(err);
    }

    if (!response.body) {
      throw new Error("OpenAI API returned empty response body.");
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
              const textChunk = data.choices?.[0]?.delta?.content;
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

      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data: ")) {
          const dataStr = trimmed.slice(6);
          if (dataStr !== "[DONE]") {
            try {
              const data = JSON.parse(dataStr);
              const textChunk = data.choices?.[0]?.delta?.content;
              if (textChunk) yield { type: "text_delta", delta: textChunk };
            } catch {}
          }
        }
      }
    } finally {
      reader.releaseLock?.();
    }
  }

  async #rawFetchRequest(requestPayload, { signal }) {
    const apiKey = await this.#loadApiKey();
    const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestPayload),
      signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsedError;
      try { parsedError = JSON.parse(errorText); } catch {}
      const err = new Error(parsedError?.error?.message || `OpenAI API error (${response.status}): ${errorText}`);
      err.status = response.status;
      err.error = parsedError?.error;
      throw normalizeOpenAIError(err);
    }

    return await response.json();
  }

  async #loadApiKey() {
    const config = await this.configLoader();
    const apiKey = config?.apiKeys?.openai?.trim();

    if (!apiKey) {
      throw new OpenAIConfigurationError(
        `OpenAI API key is missing. Run \`${appMetadata.cliName} auth\` before making requests.`,
      );
    }

    return apiKey;
  }

  async #resolveModelChain(explicitModel) {
    const config = await this.configLoader();
    const staticChain = resolveModelChain(config, explicitModel, DEFAULT_MODEL);
    let apiKey = "";
    try { apiKey = await this.#loadApiKey(); } catch {}
    if (apiKey && typeof this.clientFactory !== "function") {
      const discovered = await this.fetchAvailableModels(apiKey);
      if (discovered.length > 0) {
        return Array.from(new Set([...staticChain, ...discovered]));
      }
    }
    return staticChain;
  }

  async #executeWithModelFallback(operation, { model, onModelFallback } = {}) {
    const modelChain = await this.#resolveModelChain(model);
    let lastError;

    for (let modelIndex = 0; modelIndex < modelChain.length; modelIndex += 1) {
      const selectedModel = modelChain[modelIndex];

      try {
        return await operation(selectedModel);
      } catch (error) {
        lastError = normalizeOpenAIError(error);
        const nextModel = modelChain[modelIndex + 1];

        if (!nextModel || !isModelFallbackEligibleError(lastError)) {
          throw lastError;
        }

        onModelFallback?.({
          fromModel: selectedModel,
          toModel: nextModel,
          error: lastError,
        });
      }
    }

    throw lastError;
  }

  async #buildRequestPayload({
    input,
    selectedModel,
    instructions,
    maxOutputTokens,
    temperature,
    metadata,
    stream,
    tools,
  }) {
    if (!selectedModel) {
      throw new OpenAIConfigurationError(
        "A model is required for OpenAI responses.",
      );
    }

    if (!input) {
      throw new OpenAIConfigurationError(
        "`input` is required for OpenAI responses.",
      );
    }

    const messages = [];
    if (instructions) {
      messages.push({ role: "system", content: instructions });
    }

    if (Array.isArray(input)) {
      for (const msg of input) {
        messages.push(msg);
      }
    } else if (typeof input === "string") {
      messages.push({ role: "user", content: input });
    }

    const payload = {
      model: selectedModel.trim(),
      messages,
      stream,
    };

    if (instructions) {
      payload.instructions = instructions;
    }

    if (typeof maxOutputTokens === "number") {
      payload.max_tokens = maxOutputTokens;
      payload.max_output_tokens = maxOutputTokens;
    }

    if (typeof temperature === "number") {
      payload.temperature = temperature;
    }

    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      payload.metadata = metadata;
    }

    // Tool-use support for agentic loop
    if (Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = "auto";
    }

    return payload;
  }

  async #executeWithRetry(operation, { timeoutMs, maxRetries, signal } = {}) {
    const requestTimeoutMs = timeoutMs ?? this.timeoutMs;
    const retryLimit = maxRetries ?? this.maxRetries;

    return withRetry(
      async () => {
        if (signal?.aborted) {
          throw signal.reason ?? new Error("Request aborted.");
        }

        try {
          return await this.#runWithTimeout(
            operation,
            requestTimeoutMs,
            signal,
          );
        } catch (error) {
          if (this.#isAbortLikeError(error, signal)) {
            throw error;
          }

          throw normalizeOpenAIError(error);
        }
      },
      {
        maxRetries: retryLimit,
        baseDelayMs: this.retryBaseDelayMs,
        maxDelayMs: this.retryMaxDelayMs,
        shouldRetry: (error) =>
          !this.#isAbortLikeError(error, signal) &&
          isRetryableOpenAIError(error),
      },
    );
  }

  async #runWithTimeout(operation, timeoutMs, signal) {
    const timeoutError = new OpenAITimeoutError(
      `OpenAI request timed out after ${timeoutMs}ms.`,
    );

    const internalController = new AbortController();

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        internalController.abort(timeoutError);
        reject(timeoutError);
      }, timeoutMs);
    });

    const { promise: abortPromise, cleanup: cleanupAbortListener } =
      this.#createAbortPromise(signal);
      
    if (signal) {
      signal.addEventListener("abort", () => {
        internalController.abort(signal.reason);
      }, { once: true });
    }

    try {
      return await Promise.race([operation(internalController.signal), timeoutPromise, abortPromise]);
    } finally {
      clearTimeout(timeoutId);
      cleanupAbortListener();
    }
  }

  async *#iterateStreamWithTimeout(stream, timeoutMs, signal) {
    const iterator = stream[Symbol.asyncIterator]();

    try {
      while (true) {
        const { done, value } = await this.#runWithTimeout(
          () => iterator.next(),
          timeoutMs,
          signal,
        );
        if (done) {
          return;
        }

        yield value;
      }
    } finally {
      if (typeof iterator.return === "function") {
        await iterator.return();
      }
    }
  }

  #createAbortPromise(signal) {
    if (!signal) {
      return {
        promise: new Promise(() => {}),
        cleanup: () => {},
      };
    }

    if (signal.aborted) {
      return {
        promise: Promise.reject(signal.reason ?? new Error("Request aborted.")),
        cleanup: () => {},
      };
    }

    let abortListener;
    const promise = new Promise((_, reject) => {
      abortListener = () => {
        reject(signal.reason ?? new Error("Request aborted."));
      };

      signal.addEventListener("abort", abortListener, { once: true });
    });

    return {
      promise,
      cleanup: () => {
        signal.removeEventListener("abort", abortListener);
      },
    };
  }

  #isAbortLikeError(error, signal) {
    if (signal?.aborted) {
      return true;
    }

    if (error?.name === "AbortError" || error?.name === "APIUserAbortError") {
      return true;
    }

    if (error?.code === "ABORT_ERR") {
      return true;
    }

    return false;
  }
}
