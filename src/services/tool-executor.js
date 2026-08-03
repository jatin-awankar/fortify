import { ToolRegistry, PERMISSION_LEVEL } from "./tool-registry.js";
import { ToolUseCard, CARD_STATUS } from "../renderers/tool-use-card.js";
import { PermissionPrompt, PERMISSION_RESPONSE } from "../renderers/permission-prompt.js";
import { createAnsiStyle } from "../renderers/ansi-style.js";

/**
 * Tool execution result.
 * @typedef {{ success: boolean, output: string, error?: string, toolName: string, durationMs: number }} ToolResult
 */

/**
 * Tool executor — orchestrates tool calls with permission checks,
 * animated card rendering, and result capture.
 *
 * Flow for each tool call:
 * 1. Validate tool exists in registry
 * 2. Check permission (prompt user if required)
 * 3. Render animated "running" card
 * 4. Execute the tool handler (or stub)
 * 5. Render success/error card
 * 6. Return structured result
 */
export class ToolExecutor {
  #handlers = new Map();

  constructor({
    toolRegistry,
    permissionPrompt,
    toolUseCard,
    stdout = process.stdout,
    env = process.env,
  } = {}) {
    this.registry = toolRegistry || new ToolRegistry();
    this.permissionPrompt = permissionPrompt || new PermissionPrompt({
      stdout,
      env,
      autoApprove: false,
    });
    this.toolUseCard = toolUseCard || new ToolUseCard({ stdout, env });
    this.chalk = createAnsiStyle({ env });

    // Track execution statistics
    this.stats = {
      totalCalls: 0,
      successCount: 0,
      errorCount: 0,
      deniedCount: 0,
    };
  }

  /**
   * Register a handler function for a tool.
   *
   * @param {string} toolName - Must match a registered tool in the registry
   * @param {Function} handler - async (params, context) => { output: string }
   */
  registerHandler(toolName, handler) {
    if (!this.registry.has(toolName)) {
      throw new Error(`Cannot register handler: tool '${toolName}' not found in registry.`);
    }
    this.#handlers.set(toolName, handler);
  }

  /**
   * Execute a tool call.
   *
   * @param {object} toolCall - The tool call from the LLM
   * @param {string} toolCall.name - Tool name
   * @param {object} toolCall.arguments - Tool parameters
   * @param {string} [toolCall.id] - Tool call ID (for response correlation)
   * @param {object} [context] - Additional context (cwd, session, etc.)
   * @returns {Promise<ToolResult>}
   */
  async execute(toolCall, context = {}) {
    const { name, arguments: params = {}, id } = toolCall;
    const startTime = Date.now();

    this.stats.totalCalls++;

    // 1. Validate tool exists
    const toolDef = this.registry.get(name);
    if (!toolDef) {
      this.stats.errorCount++;
      this.toolUseCard.renderCard({
        type: "custom",
        title: `Unknown tool: ${name}`,
        status: CARD_STATUS.ERROR,
      });
      return {
        success: false,
        output: "",
        error: `Unknown tool: '${name}'`,
        toolName: name,
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Build the display title
    const displayTitle = this.#buildDisplayTitle(name, params);

    // 3. Check permission if required
    if (toolDef.requiresPermission) {
      const permResult = await this.permissionPrompt.requestPermission({
        toolType: name,
        description: `Fortify wants to ${toolDef.description.toLowerCase()}`,
        detail: this.#buildPermissionDetail(name, params),
        defaultAllow: toolDef.permissionLevel === PERMISSION_LEVEL.READ,
      });

      if (permResult === PERMISSION_RESPONSE.DENY) {
        this.stats.deniedCount++;
        this.toolUseCard.renderCard({
          type: name,
          title: `Denied: ${displayTitle}`,
          status: CARD_STATUS.SKIPPED,
        });
        return {
          success: false,
          output: "",
          error: "Permission denied by user.",
          toolName: name,
          durationMs: Date.now() - startTime,
        };
      }

      if (permResult === PERMISSION_RESPONSE.EXPLAIN) {
        // Show explanation then re-prompt (simplified: just show info)
        this.toolUseCard.renderCard({
          type: name,
          title: `${toolDef.description}: ${displayTitle}`,
          metadata: `Permission: ${toolDef.permissionLevel}`,
          status: CARD_STATUS.PENDING,
        });
        // In a full implementation, we'd re-prompt here
      }
    }

    // 4. Start animated card
    const cardController = this.toolUseCard.startCard({
      type: name,
      title: displayTitle,
      metadata: this.#buildMetadata(name, params),
    });

    // 5. Execute handler
    const handler = this.#handlers.get(name);
    if (!handler) {
      // Stub mode — no real handler registered yet
      cardController.succeed(`${displayTitle}`, "scaffold — no handler");
      this.stats.successCount++;
      return {
        success: true,
        output: `[Scaffold] Tool '${name}' would execute with params: ${JSON.stringify(params)}`,
        toolName: name,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const result = await handler(params, {
        ...context,
        toolDef,
        toolCallId: id,
      });

      const output = typeof result === "string" ? result : (result?.output || "");
      cardController.succeed(displayTitle, this.#truncateOutput(output));
      this.stats.successCount++;

      // Show content preview if output is non-trivial
      if (output && output.length > 0) {
        this.toolUseCard.renderContent(output);
      }

      return {
        success: true,
        output,
        toolName: name,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      cardController.fail(errorMsg);
      this.stats.errorCount++;

      return {
        success: false,
        output: "",
        error: errorMsg,
        toolName: name,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute multiple tool calls sequentially.
   *
   * @param {object[]} toolCalls - Array of tool calls
   * @param {object} [context]
   * @returns {Promise<ToolResult[]>}
   */
  async executeAll(toolCalls, context = {}) {
    const results = [];
    const total = toolCalls.length;

    for (let i = 0; i < total; i++) {
      if (total > 1) {
        this.toolUseCard.renderStepHeader(i + 1, total, `Tool: ${toolCalls[i].name}`);
      }
      const result = await this.execute(toolCalls[i], context);
      results.push(result);
    }

    return results;
  }

  /**
   * Get execution statistics.
   * @returns {{ totalCalls: number, successCount: number, errorCount: number, deniedCount: number }}
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset execution statistics.
   */
  resetStats() {
    this.stats = {
      totalCalls: 0,
      successCount: 0,
      errorCount: 0,
      deniedCount: 0,
    };
  }

  #buildDisplayTitle(toolName, params) {
    switch (toolName) {
      case "read_file":
        return params.path || "file";
      case "write_file":
      case "edit_file":
        return params.path || "file";
      case "execute_command":
        return params.command || "command";
      case "search_files":
        return `"${params.query || ""}"`;
      case "list_directory":
        return params.path || ".";
      default:
        return toolName;
    }
  }

  #buildMetadata(toolName, params) {
    switch (toolName) {
      case "write_file":
        return params.content ? `${params.content.split("\n").length} lines` : "";
      case "edit_file":
        return params.search ? `replacing ${params.search.length} chars` : "";
      case "execute_command":
        return params.cwd ? `in ${params.cwd}` : "";
      default:
        return "";
    }
  }

  #buildPermissionDetail(toolName, params) {
    switch (toolName) {
      case "write_file":
        return `File: ${params.path || "unknown"} (${params.content?.split("\n").length || 0} lines)`;
      case "edit_file":
        return `File: ${params.path || "unknown"}\nSearch: "${(params.search || "").slice(0, 50)}..."`;
      case "execute_command":
        return `Command: ${params.command || "unknown"}`;
      default:
        return "";
    }
  }

  #truncateOutput(output) {
    if (!output) return "";
    const lines = output.split("\n");
    if (lines.length <= 3) return `${lines.length} line${lines.length === 1 ? "" : "s"}`;
    return `${lines.length} lines`;
  }
}

/**
 * Create a ToolExecutor instance.
 * @param {object} [options]
 * @returns {ToolExecutor}
 */
export function createToolExecutor(options) {
  return new ToolExecutor(options);
}
