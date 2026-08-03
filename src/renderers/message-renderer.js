import { createTerminalUI } from "./terminal-ui.js";
import { MarkdownTerminalRenderer } from "./markdown-terminal-renderer.js";
import { StreamRenderCancelledError } from "./streaming-terminal-renderer.js";
import { ToolUseCard } from "./tool-use-card.js";
import { ThinkingIndicator } from "./thinking-indicator.js";

/**
 * Unified message renderer for the chat session.
 *
 * Handles rendering of:
 * - User messages with styled prompt and file attachment indicators
 * - Assistant messages with markdown rendering and interleaved tool cards
 * - Tool-use card lifecycle during agentic execution
 * - Thinking indicator before response streaming
 * - Error and warning messages
 */
export class MessageRenderer {
  constructor({
    terminalUI = createTerminalUI(),
    markdownRenderer,
    toolUseCard,
    thinkingIndicator,
  } = {}) {
    this.terminalUI = terminalUI;
    this.stdout = terminalUI.stdout;
    this.chalk = terminalUI.chalk;

    this.markdownRenderer = markdownRenderer ||
      new MarkdownTerminalRenderer({ terminalUI, stdout: terminalUI.stdout });

    this.toolUseCard = toolUseCard ||
      new ToolUseCard({ stdout: terminalUI.stdout, env: { NO_COLOR: "1" } });

    this.thinkingIndicator = thinkingIndicator ||
      new ThinkingIndicator({ stdout: terminalUI.stdout });
  }

  // ────────────────────────────── User Messages ──────────────────────────────

  /**
   * Get the styled user prompt string (for readline).
   * @returns {string}
   */
  getUserPrompt() {
    return `${this.chalk.bold.cyan("❯")} `;
  }

  /**
   * Render a user message (after submission).
   * @param {string} message - The user's input text
   * @param {{ attachments?: Array<{ path: string, size: number }> }} [options]
   */
  renderUserMessage(message, { attachments = [] } = {}) {
    if (!this.#canWrite()) return;

    const formattedMessage = message.trim();
    this.stdout.write(`\n${this.chalk.bold.cyan("❯")} ${this.chalk.bold(formattedMessage)}\n`);

    // Show file attachment indicators
    for (const att of attachments) {
      const sizeLabel = att.size > 1024
        ? `${(att.size / 1024).toFixed(1)}KB`
        : `${att.size}B`;
      this.stdout.write(`  ${this.chalk.dim("📎")} ${this.chalk.dim(`Attached: ${att.path} (${sizeLabel})`)}\n`);
    }

    if (attachments.length > 0 || formattedMessage) {
      this.stdout.write("\n");
    }
  }

  // ──────────────────────────── Assistant Messages ────────────────────────────

  /**
   * Show the thinking indicator before a response starts streaming.
   * @param {"default"|"extended"} [mode="default"]
   * @returns {ThinkingIndicator} The indicator (call .stop() or .complete() when done)
   */
  showThinking(mode = "default") {
    this.thinkingIndicator.start(mode);
    return this.thinkingIndicator;
  }

  /**
   * Stop the thinking indicator (called when streaming begins).
   */
  stopThinking() {
    if (this.thinkingIndicator.isActive) {
      this.thinkingIndicator.complete();
    }
  }

  /**
   * Render the assistant label before streaming content.
   */
  renderAssistantLabel() {
    if (!this.#canWrite()) return;
    this.stdout.write(`  ${this.chalk.bold.green("Assistant")}\n\n`);
  }

  /**
   * Render a streaming assistant response with markdown formatting.
   * @param {AsyncIterable} stream - The response stream
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<string>} The raw assistant text
   */
  async renderAssistantStream(stream, { signal } = {}) {
    if (!this.#canWrite()) return "";

    // Stop thinking indicator if still active
    this.stopThinking();

    this.renderAssistantLabel();

    try {
      const assistantText = await this.markdownRenderer.renderMarkdownStream(stream, {
        signal,
        handleCtrlC: false,
        ensureTrailingNewline: true,
      });

      this.stdout.write("\n");
      return assistantText.trimEnd();
    } catch (error) {
      if (error instanceof StreamRenderCancelledError) {
        this.terminalUI.warning("Generation cancelled.");
        return "";
      }
      throw error;
    }
  }

  /**
   * Render a complete (non-streamed) assistant message with markdown.
   * @param {string} text - The assistant's response text
   */
  async renderAssistantMessage(text) {
    if (!this.#canWrite() || !text) return;

    this.stopThinking();
    this.renderAssistantLabel();

    await this.markdownRenderer.renderMarkdown(text, {
      ensureTrailingNewline: true,
    });

    this.stdout.write("\n");
  }

  // ──────────────────────────── Tool Use Cards ───────────────────────────────

  /**
   * Start an animated tool card (returns a controller).
   * @param {object} options - Same as ToolUseCard.startCard options
   * @returns {{ succeed: Function, fail: Function, skip: Function, update: Function, elapsed: Function }}
   */
  startToolCard(options) {
    return this.toolUseCard.startCard(options);
  }

  /**
   * Render a static tool card.
   * @param {object} options - Same as ToolUseCard.renderCard options
   */
  renderToolCard(options) {
    return this.toolUseCard.renderCard(options);
  }

  /**
   * Render collapsible content output for a tool result.
   * @param {string|string[]} content
   * @param {object} [options]
   */
  renderToolContent(content, options) {
    return this.toolUseCard.renderContent(content, options);
  }

  /**
   * Render a step progress header.
   * @param {number} current
   * @param {number} total
   * @param {string} title
   */
  renderStepProgress(current, total, title) {
    return this.toolUseCard.renderStepHeader(current, total, title);
  }

  // ──────────────────────────── Status Messages ──────────────────────────────

  /**
   * Render an error message in a styled box.
   * @param {string} message
   */
  renderError(message) {
    if (!this.#canWrite()) return;
    this.stdout.write(`\n  ${this.chalk.red("✖")} ${this.chalk.red(message)}\n\n`);
  }

  /**
   * Render a warning message.
   * @param {string} message
   */
  renderWarning(message) {
    if (!this.#canWrite()) return;
    this.stdout.write(`  ${this.chalk.yellow("⚠")} ${this.chalk.yellow(message)}\n`);
  }

  /**
   * Render an info/success message.
   * @param {string} message
   */
  renderInfo(message) {
    if (!this.#canWrite()) return;
    this.stdout.write(`  ${this.chalk.green("✓")} ${message}\n`);
  }

  /**
   * Render a model fallback notice.
   * @param {{ fromModel: string, toModel: string }} options
   */
  renderModelFallback({ fromModel, toModel }) {
    this.renderWarning(`Model limit reached for ${fromModel}. Retrying with ${toModel}.`);
  }

  #canWrite() {
    return this.stdout && typeof this.stdout.write === "function";
  }
}

/**
 * Create a MessageRenderer instance.
 * @param {object} [options]
 * @returns {MessageRenderer}
 */
export function createMessageRenderer(options) {
  return new MessageRenderer(options);
}
