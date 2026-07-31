import OpenAI from "openai";
import { appMetadata } from "../../config/app-metadata.js";
import { loadRuntimeConfig } from "../../config/index.js";
import { resolveModelChain } from "../../config/model-preferences.js";
import { withRetry } from "../../utils/retry.js";
import {
  OpenAIConfigurationError,
  OpenAITimeoutError,
  isModelFallbackEligibleError,
  isRetryableOpenAIError,
  normalizeOpenAIError,
} from "./openai-service-errors.js";

const DEFAULT_MODEL = "gpt-5.1";

export class OpenAIService {
  constructor({
    configLoader = loadRuntimeConfig,
    clientFactory = (options) => new OpenAI(options),
    timeoutMs = 60_000,
    maxRetries = 2,
    retryBaseDelayMs = 500,
    retryMaxDelayMs = 5_000,
  } = {}) {
    this.configLoader = configLoader;
    this.clientFactory = clientFactory;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.retryBaseDelayMs = retryBaseDelayMs;
    this.retryMaxDelayMs = retryMaxDelayMs;
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
          async () => {
            const client = await this.#createClient(timeoutMs);
            return client.responses.create(requestPayload, { signal });
          },
          { timeoutMs, maxRetries, signal },
        );

        return {
          id: response.id,
          model: response.model,
          outputText: response.output_text ?? "",
          response,
        };
      },
      { model, onModelFallback },
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

      try {
        while (true) {
          const { done, value } = await modelIterator.next();
          if (done) {
            break;
          }

          yield value;
        }

        return;
      } catch (error) {
        if (typeof modelIterator.return === "function") {
          try {
            await modelIterator.return();
          } catch {
            // Best-effort cleanup between model attempts.
          }
        }

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

    const stream = await this.#executeWithRetry(
      async () => {
        const client = await this.#createClient(timeoutMs);
        return client.responses.create(requestPayload, { signal });
      },
      { timeoutMs, maxRetries, signal },
    );

    const requestTimeoutMs = timeoutMs ?? this.timeoutMs;

    for await (const event of this.#iterateStreamWithTimeout(
      stream,
      requestTimeoutMs,
      signal,
    )) {
      if (event?.type === "error") {
        throw normalizeOpenAIError(event.error, {
          fallbackMessage: "OpenAI streaming failed.",
        });
      }

      if (event?.type === "response.output_text.delta") {
        yield {
          type: "text_delta",
          delta: event.delta ?? "",
          event,
        };
        continue;
      }

      if (event?.type === "response.output_text.done") {
        yield {
          type: "text_done",
          text: event.text ?? "",
          event,
        };
        continue;
      }

      yield {
        type: "event",
        event,
      };
    }
  }

  async #createClient(timeoutMs) {
    const apiKey = await this.#loadApiKey();
    return this.clientFactory({
      apiKey,
      maxRetries: 0,
      timeout: timeoutMs ?? this.timeoutMs,
    });
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
    return resolveModelChain(config, explicitModel, DEFAULT_MODEL);
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

    const payload = {
      model: selectedModel.trim(),
      input,
      stream,
    };

    if (instructions) {
      payload.instructions = instructions;
    }

    if (typeof maxOutputTokens === "number") {
      payload.max_output_tokens = maxOutputTokens;
    }

    if (typeof temperature === "number") {
      payload.temperature = temperature;
    }

    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      payload.metadata = metadata;
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

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(timeoutError), timeoutMs);
    });

    const { promise: abortPromise, cleanup: cleanupAbortListener } =
      this.#createAbortPromise(signal);

    try {
      return await Promise.race([operation(), timeoutPromise, abortPromise]);
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
