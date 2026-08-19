import { appMetadata } from "../config/app-metadata.js";
import { createTerminalUI } from "./terminal-ui.js";
import { StreamRenderCancelledError } from "./streaming-terminal-renderer.js";
import { MarkdownTerminalRenderer } from "./markdown-terminal-renderer.js";
import { createTUISession } from "./tui-session.js";
import { createActionCardRenderer } from "./action-card-renderer.js";
import { createDiffRenderer } from "./diff-renderer.js";
import { MessageRenderer } from "./message-renderer.js";
import { StatusBar } from "./status-bar.js";
import { ThinkingIndicator } from "./thinking-indicator.js";
import { renderBox, renderDivider } from "./ansi-box.js";

export class ChatSessionRenderer {
  constructor({
    terminalUI = createTerminalUI(),
    markdownRenderer = new MarkdownTerminalRenderer({ terminalUI }),
    tuiSession = createTUISession({ terminalUI }),
    actionCardRenderer = createActionCardRenderer({ terminalUI }),
    diffRenderer = createDiffRenderer({ terminalUI }),
    messageRenderer,
    statusBar,
  } = {}) {
    this.terminalUI = terminalUI;
    this.markdownRenderer = markdownRenderer;
    this.tuiSession = tuiSession;
    this.actionCardRenderer = actionCardRenderer;
    this.diffRenderer = diffRenderer;

    // Phase 3: New components
    this.messageRenderer = messageRenderer ||
      new MessageRenderer({ terminalUI, markdownRenderer });

    this.statusBar = statusBar || new StatusBar({
      stdout: terminalUI.stdout,
    });
  }

  /**
   * Show the session start header — Claude Code style.
   *
   * Renders:
   * ```
   * ╭─ Fortify v0.9.0 ──────────────────────────────────────────╮
   * │ Model: gpt-4o (openai)  │  Session: sess-8f92a            │
   * │ CWD: ~/projects/app     │  Branch: main                   │
   * ╰──────────────────────────────────────────────────────────-─╯
   * Tips: /help /clear /diff /commit /model /exit  │  Files: @path
   * ────────────────────────────────────────────────────────────────
   * ```
   */
  showSessionStart({ mode, sessionId, model, provider, cwd, branch } = {}) {
    const chalk = this.terminalUI.chalk;
    const stdout = this.terminalUI.stdout;
    if (!stdout || typeof stdout.write !== "function") return;

    const displayModel = model || mode || "default";
    const providerStr = provider ? ` (${provider})` : "";

    // Build content lines for the header box
    const contentLines = [];
    contentLines.push(
      `${chalk.bold("Model:")} ${chalk.cyan(displayModel)}${chalk.dim(providerStr)}  ${chalk.dim("│")}  ${chalk.bold("Session:")} ${chalk.dim(sessionId || "default")}`
    );

    if (cwd || branch) {
      const cwdStr = cwd ? `${chalk.bold("CWD:")} ${chalk.dim(this.#shortenPath(cwd))}` : "";
      const branchStr = branch ? `${chalk.bold("Branch:")} ${chalk.cyan(branch)}` : "";
      const separator = (cwdStr && branchStr) ? `  ${chalk.dim("│")}  ` : "";
      contentLines.push(`${cwdStr}${separator}${branchStr}`);
    }

    const title = `${appMetadata.displayName} v${appMetadata.version}`;
    const cols = this.#getColumns();

    const box = renderBox({
      title,
      content: contentLines,
      borderStyle: "rounded",
      chalk,
      maxWidth: cols,
      minWidth: 50,
    });

    stdout.write(`\n${box}\n`);

    // Help tips line
    const tips = [
      chalk.cyan("/help"),
      chalk.cyan("/clear"),
      chalk.cyan("/diff"),
      chalk.cyan("/commit"),
      chalk.cyan("/model"),
      chalk.cyan("/exit"),
    ].join("  ");

    const tipsLine = `${chalk.dim("Tips:")} ${tips}  ${chalk.dim("│")}  ${chalk.dim("Files:")} ${chalk.cyan("@path")}`;
    stdout.write(`${tipsLine}\n`);

    // Divider
    const divider = renderDivider({ width: Math.min(cols, 80), chalk });
    stdout.write(`${divider}\n\n`);

    // Initialize status bar
    this.statusBar.update({
      model: displayModel,
      provider: provider || "",
      cwd: cwd || process.cwd(),
      branch: branch || "",
      sessionId: sessionId || "default",
    });
  }

  showSessionEnd() {
    const chalk = this.terminalUI.chalk;
    const stdout = this.terminalUI.stdout;
    if (!stdout || typeof stdout.write !== "function") return;

    // Show final token usage
    this.statusBar.render();

    const divider = renderDivider({ width: Math.min(this.#getColumns(), 80), chalk });
    stdout.write(`\n${divider}\n`);
    this.terminalUI.info("Chat session ended.");
  }

  /**
   * Get the styled user prompt (new ❯ style).
   */
  showUserPrompt() {
    return this.messageRenderer.getUserPrompt();
  }

  /**
   * Render a user message.
   */
  showUserMessage(message, options) {
    this.messageRenderer.renderUserMessage(message, options);
  }

  /**
   * Show the thinking indicator.
   * @param {"default"|"extended"} [mode]
   * @returns {ThinkingIndicator}
   */
  showThinking(mode) {
    return this.messageRenderer.showThinking(mode);
  }

  /**
   * Stop the thinking indicator.
   */
  stopThinking() {
    this.messageRenderer.stopThinking();
  }

  // ──── Backward-compatible methods ────

  renderActionCard(options) {
    return this.actionCardRenderer.renderCard(options);
  }

  renderDiffCard(filepath, diffContent, options) {
    return this.diffRenderer.renderDiffCard(filepath, diffContent, options);
  }

  /**
   * Render a streaming assistant response.
   */
  async renderAssistantStream(stream, { signal } = {}) {
    return this.messageRenderer.renderAssistantStream(stream, { signal });
  }

  /**
   * Render token usage summary after a turn.
   * @param {{ promptTokens?: number, completionTokens?: number, estimatedCost?: number }} usage
   */
  renderTurnUsage(usage) {
    if (usage) {
      this.statusBar.addUsage(usage);
      this.statusBar.renderTurnSummary();
    }
  }

  // ──── Tool card lifecycle (new Phase 3 API) ────

  /**
   * Start an animated tool card.
   */
  startToolCard(options) {
    return this.messageRenderer.startToolCard(options);
  }

  /**
   * Render a static tool card.
   */
  renderToolCard(options) {
    return this.messageRenderer.renderToolCard(options);
  }

  /**
   * Render collapsible tool content.
   */
  renderToolContent(content, options) {
    return this.messageRenderer.renderToolContent(content, options);
  }

  /**
   * Render step progress.
   */
  renderStepProgress(current, total, title) {
    return this.messageRenderer.renderStepProgress(current, total, title);
  }

  showModelFallback({ fromModel, toModel }) {
    this.messageRenderer.renderModelFallback({ fromModel, toModel });
  }

  showWarning(message) {
    this.messageRenderer.renderWarning(message);
  }

  showError(errorMessage) {
    this.messageRenderer.renderError(errorMessage);
  }

  #shortenPath(fullPath) {
    if (!fullPath) return "";
    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (home && fullPath.startsWith(home)) {
      return "~" + fullPath.slice(home.length).replace(/\\/g, "/");
    }
    const parts = fullPath.replace(/\\/g, "/").split("/");
    if (parts.length <= 3) return fullPath.replace(/\\/g, "/");
    return "…/" + parts.slice(-2).join("/");
  }

  #getColumns() {
    const stdout = this.terminalUI.stdout;
    if (stdout && Number.isFinite(stdout.columns) && stdout.columns > 0) {
      return Math.min(stdout.columns, 120);
    }
    return 80;
  }
}
