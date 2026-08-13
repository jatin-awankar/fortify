/**
 * Tool Handler Registry — maps tool names to their handler functions.
 *
 * This is the central wiring module that connects:
 *   Tool Registry (definitions) ↔ Tool Handlers (implementations)
 *
 * Used by ToolExecutor to resolve handlers during agentic loop execution.
 */

import { readFileHandler } from "./read-file-handler.js";
import { writeFileHandler } from "./write-file-handler.js";
import { editFileHandler } from "./edit-file-handler.js";
import { executeCommandHandler } from "./execute-command-handler.js";
import { searchFilesHandler } from "./search-files-handler.js";
import { listDirectoryHandler } from "./list-directory-handler.js";

/**
 * Handler function signature.
 * @typedef {(params: object, context: object) => Promise<{ output: string }>} ToolHandler
 */

/**
 * Map of tool names → handler functions.
 *
 * Tool names MUST match the names in `tool-registry.js` BUILTIN_TOOLS.
 * Handler signatures: async (params, context) => { output: string }
 *
 * @type {Record<string, ToolHandler>}
 */
export const TOOL_HANDLERS = {
  read_file: readFileHandler,
  write_file: writeFileHandler,
  edit_file: editFileHandler,
  execute_command: executeCommandHandler,
  search_files: searchFilesHandler,
  list_directory: listDirectoryHandler,
};

/**
 * Register all tool handlers on a ToolExecutor instance.
 *
 * @param {import("../services/tool-executor.js").ToolExecutor} toolExecutor
 * @param {object} [options]
 * @param {string[]} [options.only] - If provided, only register these tool names
 * @param {string[]} [options.exclude] - If provided, skip these tool names
 */
export function registerAllHandlers(toolExecutor, { only, exclude } = {}) {
  for (const [name, handler] of Object.entries(TOOL_HANDLERS)) {
    if (only && !only.includes(name)) continue;
    if (exclude && exclude.includes(name)) continue;

    try {
      toolExecutor.registerHandler(name, handler);
    } catch (error) {
      // Tool not in registry — skip silently (could be a restricted environment)
      if (!error.message?.includes("not found in registry")) {
        throw error;
      }
    }
  }
}

/**
 * Get the list of registered tool handler names.
 * @returns {string[]}
 */
export function getRegisteredToolNames() {
  return Object.keys(TOOL_HANDLERS);
}
