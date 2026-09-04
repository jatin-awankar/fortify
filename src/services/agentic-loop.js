import { ToolRegistry } from "./tool-registry.js";
import { ToolExecutor } from "./tool-executor.js";

/**
 * Tool names that mutate the filesystem.
 * Used by the self-heal service to decide when to run tests.
 */
export const MUTATION_TOOLS = ["write_file", "edit_file"];

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
 * This is the production implementation — handlers are registered via
 * the tool registry index and execute real file/command operations.
 */
export class AgenticLoop {
  constructor({
    toolRegistry,
    toolExecutor,
    maxIterations = MAX_ITERATIONS,
    onIteration,
    onToolResults,
    onComplete,
    onBeforeToolExecution,
    onAfterIteration,
  } = {}) {
    this.registry = toolRegistry || new ToolRegistry();
    this.executor = toolExecutor || new ToolExecutor({ toolRegistry: this.registry });
    this.maxIterations = maxIterations;

    // Lifecycle hooks (optional)
    this.onIteration = onIteration || (() => {});
    this.onToolResults = onToolResults || (() => {});
    this.onComplete = onComplete || (() => {});
    /** Called before each tool is executed — receives the tool call object. */
    this.onBeforeToolExecution = onBeforeToolExecution || (() => {});
    /** Called after each complete iteration — receives { iteration, toolResults, hasMutations }. */
    this.onAfterIteration = onAfterIteration || (() => {});
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
        this.onComplete({
          text: finalText,
          toolResults: allToolResults,
          iterations,
        });
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
        if (signal?.aborted || (error instanceof Error && (error.name === "AbortError" || error.code === "ABORT_ERR" || error.name === "APIUserAbortError"))) {
          this.onComplete({
            text: finalText,
            toolResults: allToolResults,
            iterations,
          });
          return {
            text: finalText,
            toolResults: allToolResults,
            iterations,
            aborted: true,
          };
        }

        // LLM call failed — break the loop
        finalText = `Error calling LLM: ${error instanceof Error ? error.message : String(error)}`;
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
      const toolCalls = response.toolCalls.map((tc) => {
        let parsedArgs = tc.arguments || {};
        let parseError = false;
        
        if (typeof tc.arguments === "string") {
          try {
            parsedArgs = JSON.parse(tc.arguments);
          } catch (e) {
            parseError = true;
            parsedArgs = { _fortify_parse_error: true, raw: tc.arguments };
          }
        }
        
        return {
          name: tc.name,
          arguments: parsedArgs,
          id: tc.id || `call_${Date.now()}_${tc.name}`,
          _parseError: parseError
        };
      });

      // Notify before each tool execution
      for (const tc of toolCalls) {
        this.onBeforeToolExecution(tc);
      }

      const results = await this.executor.executeAll(toolCalls, context);
      allToolResults.push(...results);

      // Notify hook
      this.onToolResults(results, iterations);

      // Check if any mutations occurred in this iteration
      const hasMutations = toolCalls.some((tc) => MUTATION_TOOLS.includes(tc.name));

      // Notify after iteration completes
      this.onAfterIteration({ iteration: iterations, toolResults: results, hasMutations });

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
            catch { return tc.function.arguments; }
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
