import { createTerminalUI } from "./terminal-ui.js";
import { ToolUseCard, TOOL_TYPES, CARD_STATUS } from "./tool-use-card.js";

/**
 * Legacy action type constants — preserved for backward compatibility.
 * Consumers should prefer TOOL_TYPES from tool-use-card.js for new code.
 */
export const ACTION_TYPES = {
  READ_FILE: "read_file",
  WRITE_FILE: "write_file",
  EDIT_FILE: "edit_file",
  EXECUTE_COMMAND: "execute_command",
  THINKING: "thinking",
  SEARCH: "search",
  CUSTOM: "custom"
};

const LEGACY_TYPE_ICONS = {
  read_file: "📄",
  write_file: "📝",
  edit_file: "📝",
  execute_command: "⚡",
  thinking: "🧠",
  search: "🔍",
  custom: "●"
};

/**
 * ActionCardRenderer — backward-compatible wrapper around ToolUseCard.
 *
 * Preserves the original renderCard / updateLastCard / renderStepProgress /
 * renderCommandCard API so existing call sites (ChatSessionRenderer, etc.)
 * continue working without changes.
 *
 * New code should use ToolUseCard directly for richer lifecycle management.
 */
export class ActionCardRenderer {
  constructor({ terminalUI = createTerminalUI() } = {}) {
    this.terminalUI = terminalUI;
    this.stdout = terminalUI.stdout;
    this.chalk = terminalUI.chalk;
    this.capabilities = terminalUI.capabilities;
    this.lastCardWritten = false;

    // Delegate to the new ToolUseCard
    this.toolCard = new ToolUseCard({
      stdout: terminalUI.stdout,
      env: terminalUI.capabilities?.shouldUseColor ? { FORCE_COLOR: "1" } : { NO_COLOR: "1" },
    });
  }

  /**
   * Render a tool action card (backward-compatible API).
   */
  renderCard({ type = ACTION_TYPES.CUSTOM, title, metadata = "", status = "pending" }) {
    if (this.#shouldSuppress()) return "";

    const result = this.toolCard.renderCard({
      type,
      title,
      metadata,
      status,
      indent: 1,
    });

    this.lastCardWritten = true;
    return result;
  }

  /**
   * Update the last rendered card with a new status (in-place transition).
   */
  updateLastCard({ type = ACTION_TYPES.CUSTOM, title, metadata = "", status = "success" }) {
    if (this.#shouldSuppress() || !this.lastCardWritten) {
      return this.renderCard({ type, title, metadata, status });
    }

    // In TTY mode, move cursor up 1 line and clear line for seamless inline transition
    if (this.stdout.isTTY && typeof this.stdout.write === "function") {
      this.stdout.write("\x1b[1A\x1b[2K");
    }

    return this.renderCard({ type, title, metadata, status });
  }

  /**
   * Render a step progress header (e.g., [1/3] Analyzing...).
   */
  renderStepProgress(current, total, title) {
    if (this.#shouldSuppress()) return "";

    const result = this.toolCard.renderStepHeader(current, total, title);
    this.lastCardWritten = false;
    return result;
  }

  /**
   * Render a command execution card.
   */
  renderCommandCard(command, { cwd, status = "running" } = {}) {
    if (this.#shouldSuppress()) return "";

    const result = this.toolCard.renderCommandCard(command, { cwd, status });
    this.lastCardWritten = true;
    return result;
  }

  /**
   * Start an animated tool card (new API — delegates to ToolUseCard.startCard).
   * Returns a controller with succeed/fail/skip/update methods.
   */
  startAnimatedCard(options) {
    return this.toolCard.startCard(options);
  }

  /**
   * Render collapsible content output (new API).
   */
  renderContent(content, options) {
    return this.toolCard.renderContent(content, options);
  }

  #shouldSuppress() {
    return !this.stdout;
  }
}

export function createActionCardRenderer(options) {
  return new ActionCardRenderer(options);
}
