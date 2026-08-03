import { createAnsiStyle, ANSI } from "./ansi-style.js";

/**
 * Tool type definitions with metadata.
 */
export const TOOL_TYPES = {
  read_file:        { name: "Read",   icon: "📄", verb: "Reading" },
  write_file:       { name: "Write",  icon: "📝", verb: "Writing" },
  edit_file:        { name: "Edit",   icon: "📝", verb: "Editing" },
  execute_command:  { name: "Run",    icon: "⚡", verb: "Running" },
  search_files:     { name: "Search", icon: "🔍", verb: "Searching" },
  list_directory:   { name: "List",   icon: "📁", verb: "Listing" },
  thinking:         { name: "Think",  icon: "🧠", verb: "Thinking" },
  web_search:       { name: "Search", icon: "🌐", verb: "Searching web" },
  custom:           { name: "Tool",   icon: "●",  verb: "Processing" },
};

/**
 * Card status enum.
 */
export const CARD_STATUS = {
  PENDING:  "pending",
  RUNNING:  "running",
  SUCCESS:  "success",
  ERROR:    "error",
  SKIPPED:  "skipped",
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DEFAULT_COLLAPSE_THRESHOLD = 10;

/**
 * A comprehensive tool-use card renderer that displays agentic tool calls inline.
 *
 * Features:
 * - Animated spinner during RUNNING state with in-place line updates
 * - Lifecycle transitions: pending → running → success/error
 * - Step counter badges [1/3]
 * - Duration tracking per card
 * - Collapsible content preview (auto-collapsed for long output)
 * - Nested indentation for sub-steps
 */
export class ToolUseCard {
  #spinnerTimer = null;
  #spinnerFrame = 0;
  #startTime = null;
  #linesWritten = 0;

  constructor({
    stdout = process.stdout,
    env = process.env,
    collapseThreshold = DEFAULT_COLLAPSE_THRESHOLD,
  } = {}) {
    this.stdout = stdout;
    this.isTTY = Boolean(stdout && stdout.isTTY);
    this.chalk = createAnsiStyle({ env });
    this.collapseThreshold = collapseThreshold;
  }

  /**
   * Render a tool card in a given status.
   *
   * @param {object} options
   * @param {string} options.type - Tool type key (from TOOL_TYPES)
   * @param {string} options.title - Main title text
   * @param {string} [options.metadata] - Additional metadata (e.g., "387 lines")
   * @param {string} [options.status] - Card status (from CARD_STATUS)
   * @param {number} [options.indent] - Indentation depth (default 1)
   * @param {string} [options.duration] - Duration string (e.g., "1.2s")
   * @param {number} [options.stepCurrent] - Current step number
   * @param {number} [options.stepTotal] - Total steps
   * @returns {string} The rendered card line
   */
  renderCard({
    type = "custom",
    title,
    metadata = "",
    status = CARD_STATUS.PENDING,
    indent = 1,
    duration = "",
    stepCurrent,
    stepTotal,
  }) {
    if (!this.#canWrite()) return "";

    const toolMeta = TOOL_TYPES[type] || TOOL_TYPES.custom;
    const indentStr = "  ".repeat(indent);
    const statusSymbol = this.#getStatusSymbol(status, toolMeta.icon);
    const titleStr = this.#stylizeTitle(title, status);
    const metaStr = metadata ? this.chalk.dim(` (${metadata})`) : "";
    const durationStr = duration ? this.chalk.dim(` (${duration})`) : "";
    const stepBadge = (stepCurrent && stepTotal)
      ? `${this.chalk.dim(`[${stepCurrent}/${stepTotal}]`)} `
      : "";

    const line = `${indentStr}${stepBadge}${statusSymbol} ${titleStr}${metaStr}${durationStr}\n`;
    this.stdout.write(line);
    this.#linesWritten++;

    return line;
  }

  /**
   * Start a tool card in RUNNING state with animated spinner.
   * Returns a controller object to update or complete the card.
   *
   * @param {object} options - Same as renderCard options
   * @returns {{ update: Function, succeed: Function, fail: Function, skip: Function, elapsed: Function }}
   */
  startCard({
    type = "custom",
    title,
    metadata = "",
    indent = 1,
    stepCurrent,
    stepTotal,
  }) {
    const toolMeta = TOOL_TYPES[type] || TOOL_TYPES.custom;
    this.#startTime = Date.now();

    // Render initial running state
    this.renderCard({
      type,
      title: `${toolMeta.verb} ${title}`,
      metadata,
      status: CARD_STATUS.RUNNING,
      indent,
      stepCurrent,
      stepTotal,
    });

    // Start spinner animation in TTY mode
    if (this.isTTY) {
      this.#spinnerFrame = 0;
      this.#spinnerTimer = setInterval(() => {
        this.#spinnerFrame = (this.#spinnerFrame + 1) % SPINNER_FRAMES.length;
        const elapsed = this.#formatElapsed();
        const indentStr = "  ".repeat(indent);
        const spinner = this.chalk.yellow(SPINNER_FRAMES[this.#spinnerFrame]);
        const metaStr = metadata ? this.chalk.dim(` (${metadata})`) : "";
        const elapsedStr = elapsed ? this.chalk.dim(` ${elapsed}`) : "";
        const stepBadge = (stepCurrent && stepTotal)
          ? `${this.chalk.dim(`[${stepCurrent}/${stepTotal}]`)} `
          : "";

        this.stdout.write(`${ANSI.cursorUp(1)}${ANSI.eraseLine}`);
        this.stdout.write(
          `${indentStr}${stepBadge}${spinner} ${this.chalk.cyan(`${toolMeta.verb} ${title}`)}${metaStr}${elapsedStr}\n`
        );
      }, 80);

      if (typeof this.#spinnerTimer.unref === "function") {
        this.#spinnerTimer.unref();
      }
    }

    // Return controller
    return {
      /**
       * Update the card's metadata while it's running.
       * @param {string} newMetadata
       */
      update: (newMetadata) => {
        metadata = newMetadata;
      },

      /**
       * Complete the card with success status.
       * @param {string} [completionTitle] - Override title for completion
       * @param {string} [completionMeta] - Override metadata for completion
       */
      succeed: (completionTitle, completionMeta) => {
        this.#stopSpinner();
        const elapsed = this.#formatElapsed();

        if (this.isTTY) {
          this.stdout.write(`${ANSI.cursorUp(1)}${ANSI.eraseLine}`);
        }

        this.#linesWritten--;
        this.renderCard({
          type,
          title: completionTitle || `${toolMeta.name} ${title}`,
          metadata: completionMeta || metadata,
          status: CARD_STATUS.SUCCESS,
          indent,
          duration: elapsed,
          stepCurrent,
          stepTotal,
        });
      },

      /**
       * Complete the card with error status.
       * @param {string} [errorMessage] - Error description
       */
      fail: (errorMessage) => {
        this.#stopSpinner();
        const elapsed = this.#formatElapsed();

        if (this.isTTY) {
          this.stdout.write(`${ANSI.cursorUp(1)}${ANSI.eraseLine}`);
        }

        this.#linesWritten--;
        this.renderCard({
          type,
          title: errorMessage || `Failed: ${title}`,
          metadata,
          status: CARD_STATUS.ERROR,
          indent,
          duration: elapsed,
          stepCurrent,
          stepTotal,
        });
      },

      /**
       * Skip the card.
       */
      skip: () => {
        this.#stopSpinner();

        if (this.isTTY) {
          this.stdout.write(`${ANSI.cursorUp(1)}${ANSI.eraseLine}`);
        }

        this.#linesWritten--;
        this.renderCard({
          type,
          title: `Skipped: ${title}`,
          metadata,
          status: CARD_STATUS.SKIPPED,
          indent,
          stepCurrent,
          stepTotal,
        });
      },

      /**
       * Get elapsed time in formatted string.
       */
      elapsed: () => this.#formatElapsed(),
    };
  }

  /**
   * Render a step progress header.
   *
   * @param {number} current - Current step (1-indexed)
   * @param {number} total - Total steps
   * @param {string} title - Step description
   * @returns {string}
   */
  renderStepHeader(current, total, title) {
    if (!this.#canWrite()) return "";

    const badge = this.chalk.dim(`[${current}/${total}]`);
    const line = `\n${badge} ${this.chalk.bold.cyan(title)}\n`;
    this.stdout.write(line);
    this.#linesWritten += 2;
    return line;
  }

  /**
   * Render a command execution card.
   *
   * @param {string} command - The command string
   * @param {object} [options]
   * @param {string} [options.cwd] - Working directory
   * @param {string} [options.status] - Card status
   * @param {number} [options.indent] - Indentation depth
   * @returns {string}
   */
  renderCommandCard(command, { cwd, status = CARD_STATUS.RUNNING, indent = 1 } = {}) {
    if (!this.#canWrite()) return "";

    const indentStr = "  ".repeat(indent);

    // Command cards use ⚡ for running status (backward-compatible with original behavior)
    let statusSymbol;
    if (status === CARD_STATUS.SUCCESS) {
      statusSymbol = this.chalk.green("✓");
    } else if (status === CARD_STATUS.ERROR) {
      statusSymbol = this.chalk.red("✖");
    } else {
      statusSymbol = this.chalk.yellow("⚡");
    }

    const cwdInfo = cwd ? this.chalk.dim(` in ${cwd}`) : "";
    const cmdStr = this.chalk.cyan(`\`${command}\``);

    const line = `${indentStr}${statusSymbol} ${this.chalk.bold("Run")} ${cmdStr}${cwdInfo}\n`;
    this.stdout.write(line);
    this.#linesWritten++;
    return line;
  }

  /**
   * Render collapsible content output (e.g., command output, file preview).
   * Auto-collapses when content exceeds threshold.
   *
   * @param {string|string[]} content - Content to display
   * @param {object} [options]
   * @param {number} [options.indent] - Indentation depth
   * @param {boolean} [options.forceExpand] - Show all lines regardless of threshold
   * @returns {string}
   */
  renderContent(content, { indent = 2, forceExpand = false } = {}) {
    if (!this.#canWrite()) return "";

    const lines = Array.isArray(content) ? content : (content || "").split("\n");
    if (lines.length === 0) return "";

    const indentStr = "  ".repeat(indent);
    const output = [];

    if (!forceExpand && lines.length > this.collapseThreshold) {
      // Show first few lines + collapsed indicator
      const previewCount = Math.min(5, Math.floor(this.collapseThreshold / 2));
      for (let i = 0; i < previewCount; i++) {
        output.push(`${indentStr}${this.chalk.dim(lines[i])}`);
      }
      const remaining = lines.length - previewCount;
      output.push(`${indentStr}${this.chalk.dim.italic(`... ${remaining} more lines`)}`);
    } else {
      for (const line of lines) {
        output.push(`${indentStr}${this.chalk.dim(line)}`);
      }
    }

    const result = output.join("\n") + "\n";
    this.stdout.write(result);
    this.#linesWritten += output.length;
    return result;
  }

  #getStatusSymbol(status, defaultIcon) {
    switch (status) {
      case CARD_STATUS.SUCCESS:
        return this.chalk.green("✓");
      case CARD_STATUS.ERROR:
        return this.chalk.red("✖");
      case CARD_STATUS.RUNNING:
        return this.chalk.yellow(SPINNER_FRAMES[this.#spinnerFrame]);
      case CARD_STATUS.SKIPPED:
        return this.chalk.dim("○");
      case CARD_STATUS.PENDING:
      default:
        return this.chalk.cyan(defaultIcon);
    }
  }

  #stylizeTitle(title, status) {
    switch (status) {
      case CARD_STATUS.SUCCESS:
        return this.chalk.bold(title);
      case CARD_STATUS.ERROR:
        return this.chalk.red(title);
      case CARD_STATUS.RUNNING:
        return this.chalk.cyan(title);
      case CARD_STATUS.SKIPPED:
        return this.chalk.dim(title);
      case CARD_STATUS.PENDING:
      default:
        return this.chalk.cyan(title);
    }
  }

  #formatElapsed() {
    if (!this.#startTime) return "";
    const ms = Date.now() - this.#startTime;
    if (ms < 1000) return `${ms}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m${secs}s`;
  }

  #stopSpinner() {
    if (this.#spinnerTimer) {
      clearInterval(this.#spinnerTimer);
      this.#spinnerTimer = null;
    }
    this.#startTime = null;
    this.#spinnerFrame = 0;
  }

  #canWrite() {
    return this.stdout && typeof this.stdout.write === "function";
  }
}

/**
 * Create a ToolUseCard instance.
 * @param {object} [options]
 * @returns {ToolUseCard}
 */
export function createToolUseCard(options) {
  return new ToolUseCard(options);
}
