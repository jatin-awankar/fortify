import { ToolRegistry } from "./tool-registry.js";
import { ToolExecutor } from "./tool-executor.js";

/**
 * Maximum number of agentic loop iterations before forcibly stopping.
 * Prevents infinite tool-call loops.
 */
const MAX_ITERATIONS = 25;

/**
 * Agentic loop controller.
 *
 * Orchestrates the multi-turn tool-use cycle:
 * 1. Send user message + conversation to LLM (with tool schemas)
 * 2. If LLM responds with tool_calls → execute them via ToolExecutor
 * 3. Append tool results to conversation
 * 4. Re-send to LLM (continue loop)
 * 5. If LLM responds with text (no tool_calls) → done
 *
 * This is the "scaffold" implementation — it demonstrates the loop flow
 * and renders the correct tool cards, but uses stub handlers.
 */
export class AgenticLoop {
  constructor({
    toolRegistry,
    toolExecutor,
    maxIterations = MAX_ITERATIONS,
    onIteration,
    onToolResults,
    onComplete,
  } = {}) {
    this.registry = toolRegistry || new ToolRegistry();
    this.executor = toolExecutor || new ToolExecutor({ toolRegistry: this.registry });
    this.maxIterations = maxIterations;

    // Lifecycle hooks (optional)
    this.onIteration = onIteration || (() => {});
    this.onToolResults = onToolResults || (() => {});
    this.onComplete = onComplete || (() => {});
  }

  /**
   * Run the agentic loop.
   *
   * @param {object} options
   * @param {object[]} options.messages - Conversation messages (OpenAI format)
   * @param {Function} options.sendToLLM - async (messages, tools) => LLMResponse
   * @param {object} [options.context] - Additional context for tool execution
   * @param {AbortSignal} [options.signal] - Abort signal for cancellation
   * @returns {Promise<AgenticLoopResult>}
   *
   * @typedef {{ text: string, toolResults: ToolResult[], iterations: number, aborted: boolean }} AgenticLoopResult
   */
  async run({ messages, sendToLLM, context = {}, signal } = {}) {
    const toolSchemas = this.registry.toFunctionCallingSchema();
    const allToolResults = [];
    let iterations = 0;
    let finalText = "";

    // Copy messages to avoid mutating the original
    const conversationMessages = [...messages];

    while (iterations < this.maxIterations) {
      // Check for abort
      if (signal?.aborted) {
        return {
          text: finalText,
          toolResults: allToolResults,
          iterations,
          aborted: true,
        };
      }

      iterations++;
      this.onIteration(iterations);

      // Send to LLM
      let response;
      try {
        response = await sendToLLM(conversationMessages, toolSchemas);
      } catch (error) {
        // LLM call failed — break the loop
        return {
          text: `Error calling LLM: ${error instanceof Error ? error.message : String(error)}`,
          toolResults: allToolResults,
          iterations,
          aborted: false,
        };
      }

      // If no tool calls — we have a final text response
      if (!response.toolCalls || response.toolCalls.length === 0) {
        finalText = response.text || "";
        break;
      }

      // Add the assistant message (with tool calls) to conversation
      conversationMessages.push({
        role: "assistant",
        content: response.text || null,
        tool_calls: response.toolCalls.map((tc) => ({
          id: tc.id || `call_${Date.now()}_${tc.name}`,
          type: "function",
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === "string"
              ? tc.arguments
              : JSON.stringify(tc.arguments || {}),
          },
        })),
      });

      // Execute tool calls
      const toolCalls = response.toolCalls.map((tc) => ({
        name: tc.name,
        arguments: typeof tc.arguments === "string"
          ? JSON.parse(tc.arguments)
          : (tc.arguments || {}),
        id: tc.id || `call_${Date.now()}_${tc.name}`,
      }));

      const results = await this.executor.executeAll(toolCalls, context);
      allToolResults.push(...results);

      // Notify hook
      this.onToolResults(results, iterations);

      // Append tool results to conversation (for next LLM call)
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const toolCallId = toolCalls[i].id;

        conversationMessages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: result.success
            ? result.output
            : `Error: ${result.error}`,
        });
      }
    }

    // Warn if we hit max iterations
    if (iterations >= this.maxIterations && !finalText) {
      finalText = `[Agentic loop stopped after ${this.maxIterations} iterations]`;
    }

    this.onComplete({
      text: finalText,
      toolResults: allToolResults,
      iterations,
    });

    return {
      text: finalText,
      toolResults: allToolResults,
      iterations,
      aborted: false,
    };
  }

  /**
   * Check if a response from the LLM contains tool calls.
   * @param {object} response
   * @returns {boolean}
   */
  static hasToolCalls(response) {
    return Array.isArray(response?.toolCalls) && response.toolCalls.length > 0;
  }

  /**
   * Parse tool calls from an OpenAI-format response.
   * @param {object} response - OpenAI completion response
   * @returns {{ text: string, toolCalls: object[] }}
   */
  static parseResponse(response) {
    const message = response?.choices?.[0]?.message;
    if (!message) {
      return { text: "", toolCalls: [] };
    }

    const text = message.content || "";
    const toolCalls = (message.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function?.name,
      arguments: tc.function?.arguments
        ? (() => {
            try { return JSON.parse(tc.function.arguments); }
            catch { return {}; }
          })()
        : {},
    }));

    return { text, toolCalls };
  }
}

/**
 * Create an AgenticLoop instance.
 * @param {object} [options]
 * @returns {AgenticLoop}
 */
export function createAgenticLoop(options) {
  return new AgenticLoop(options);
}
