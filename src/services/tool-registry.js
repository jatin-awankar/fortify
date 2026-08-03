/**
 * Tool definitions registry.
 *
 * Each tool has:
 * - name: Unique tool identifier (matches TOOL_TYPES keys)
 * - description: Human-readable description
 * - parameters: JSON-schema-like parameter definitions
 * - requiresPermission: Whether the tool needs user approval before execution
 * - permissionLevel: "read" | "write" | "execute" (for permission granularity)
 * - handler: The async function that performs the tool action (wired in Phase 6)
 */

/**
 * Permission levels for tools.
 */
export const PERMISSION_LEVEL = {
  READ: "read",
  WRITE: "write",
  EXECUTE: "execute",
};

/**
 * Built-in tool definitions for the agentic scaffold.
 * Handlers are stubs — real execution is wired in a follow-up release.
 */
const BUILTIN_TOOLS = [
  {
    name: "read_file",
    description: "Read the contents of a file from the workspace",
    parameters: {
      path: { type: "string", required: true, description: "Relative file path" },
    },
    requiresPermission: false,
    permissionLevel: PERMISSION_LEVEL.READ,
  },
  {
    name: "write_file",
    description: "Create or overwrite a file in the workspace",
    parameters: {
      path: { type: "string", required: true, description: "Relative file path" },
      content: { type: "string", required: true, description: "Full file content" },
    },
    requiresPermission: true,
    permissionLevel: PERMISSION_LEVEL.WRITE,
  },
  {
    name: "edit_file",
    description: "Apply targeted edits to an existing file",
    parameters: {
      path: { type: "string", required: true, description: "Relative file path" },
      search: { type: "string", required: true, description: "Text to search for" },
      replace: { type: "string", required: true, description: "Replacement text" },
    },
    requiresPermission: true,
    permissionLevel: PERMISSION_LEVEL.WRITE,
  },
  {
    name: "execute_command",
    description: "Run a shell command in the workspace",
    parameters: {
      command: { type: "string", required: true, description: "Shell command to run" },
      cwd: { type: "string", required: false, description: "Working directory" },
    },
    requiresPermission: true,
    permissionLevel: PERMISSION_LEVEL.EXECUTE,
  },
  {
    name: "search_files",
    description: "Search for text patterns across workspace files",
    parameters: {
      query: { type: "string", required: true, description: "Search pattern" },
      path: { type: "string", required: false, description: "Directory to search in" },
      regex: { type: "boolean", required: false, description: "Treat query as regex" },
    },
    requiresPermission: false,
    permissionLevel: PERMISSION_LEVEL.READ,
  },
  {
    name: "list_directory",
    description: "List files and directories at a given path",
    parameters: {
      path: { type: "string", required: true, description: "Directory path" },
    },
    requiresPermission: false,
    permissionLevel: PERMISSION_LEVEL.READ,
  },
];

/**
 * Tool registry — manages available tools and their definitions.
 *
 * Provides:
 * - Tool lookup by name
 * - Tool listing for system prompts
 * - Schema generation for LLM function-calling
 * - Permission level checks
 */
export class ToolRegistry {
  #tools = new Map();

  constructor({ customTools = [] } = {}) {
    // Register built-in tools
    for (const tool of BUILTIN_TOOLS) {
      this.register(tool);
    }

    // Register custom tools (can override built-ins)
    for (const tool of customTools) {
      this.register(tool);
    }
  }

  /**
   * Register a tool definition.
   * @param {object} tool
   */
  register(tool) {
    if (!tool || !tool.name) {
      throw new Error("Tool must have a 'name' property.");
    }
    this.#tools.set(tool.name, { ...tool });
  }

  /**
   * Get a tool definition by name.
   * @param {string} name
   * @returns {object|null}
   */
  get(name) {
    return this.#tools.get(name) || null;
  }

  /**
   * Check if a tool exists.
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this.#tools.has(name);
  }

  /**
   * Get all registered tool definitions.
   * @returns {object[]}
   */
  getAll() {
    return Array.from(this.#tools.values());
  }

  /**
   * Get tool names.
   * @returns {string[]}
   */
  getNames() {
    return Array.from(this.#tools.keys());
  }

  /**
   * Check if a tool requires user permission.
   * @param {string} name
   * @returns {boolean}
   */
  requiresPermission(name) {
    const tool = this.#tools.get(name);
    return tool?.requiresPermission ?? true;
  }

  /**
   * Get the permission level for a tool.
   * @param {string} name
   * @returns {string}
   */
  getPermissionLevel(name) {
    const tool = this.#tools.get(name);
    return tool?.permissionLevel ?? PERMISSION_LEVEL.EXECUTE;
  }

  /**
   * Generate an OpenAI-compatible function calling schema for all registered tools.
   * Used to send tool definitions to the LLM.
   * @returns {object[]}
   */
  toFunctionCallingSchema() {
    const schemas = [];
    for (const tool of this.#tools.values()) {
      const properties = {};
      const required = [];

      for (const [paramName, paramDef] of Object.entries(tool.parameters || {})) {
        properties[paramName] = {
          type: paramDef.type || "string",
          description: paramDef.description || "",
        };
        if (paramDef.required) {
          required.push(paramName);
        }
      }

      schemas.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "object",
            properties,
            required,
          },
        },
      });
    }
    return schemas;
  }

  /**
   * Generate a human-readable summary of all tools (for system prompts).
   * @returns {string}
   */
  toSystemPromptSummary() {
    const lines = ["Available tools:"];
    for (const tool of this.#tools.values()) {
      const params = Object.entries(tool.parameters || {})
        .map(([name, def]) => `${name}${def.required ? "*" : ""}`)
        .join(", ");
      const perm = tool.requiresPermission ? " [requires permission]" : "";
      lines.push(`  - ${tool.name}(${params}): ${tool.description}${perm}`);
    }
    return lines.join("\n");
  }
}

/**
 * Create a ToolRegistry instance.
 * @param {object} [options]
 * @returns {ToolRegistry}
 */
export function createToolRegistry(options) {
  return new ToolRegistry(options);
}
