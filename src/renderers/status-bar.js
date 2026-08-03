import { createAnsiStyle, visibleWidth, ANSI } from "./ansi-style.js";

/**
 * A persistent bottom-of-screen status bar for the chat session.
 *
 * Displays model info, token usage, git branch, and session metadata.
 * Writes to the last terminal row without disrupting scrollback.
 *
 * Layout:
 *   [model (provider)]  │  [cwd / branch]  │  ↑ 1.2k ↓ 3.4k  │  $0.03
 */
export class StatusBar {
  #isRendered = false;
  #lastContent = "";

  constructor({
    stdout = process.stdout,
    env = process.env,
  } = {}) {
    this.stdout = stdout;
    this.isTTY = Boolean(stdout && stdout.isTTY);
    this.chalk = createAnsiStyle({ env });

    this.model = "";
    this.provider = "";
    this.cwd = "";
    this.branch = "";
    this.sessionId = "";
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.estimatedCost = 0;
  }

  /**
   * Update status bar data. Call this after each turn.
   * @param {object} data
   */
  update(data = {}) {
    if (data.model !== undefined) this.model = data.model;
    if (data.provider !== undefined) this.provider = data.provider;
    if (data.cwd !== undefined) this.cwd = data.cwd;
    if (data.branch !== undefined) this.branch = data.branch;
    if (data.sessionId !== undefined) this.sessionId = data.sessionId;
    if (data.promptTokens !== undefined) this.promptTokens = data.promptTokens;
    if (data.completionTokens !== undefined) this.completionTokens = data.completionTokens;
    if (data.estimatedCost !== undefined) this.estimatedCost = data.estimatedCost;
  }

  /**
   * Add token usage from a single turn (accumulates).
   * @param {{ promptTokens?: number, completionTokens?: number, estimatedCost?: number }} usage
   */
  addUsage({ promptTokens = 0, completionTokens = 0, estimatedCost = 0 } = {}) {
    this.promptTokens += promptTokens;
    this.completionTokens += completionTokens;
    this.estimatedCost += estimatedCost;
  }

  /**
   * Render the status bar as an inline styled line (not pinned to bottom).
   * This approach is more portable than trying to pin to the last row,
   * and works well as a "turn footer" after each assistant response.
   * @returns {string} The rendered bar content
   */
  render() {
    if (!this.stdout || typeof this.stdout.write !== "function") return "";

    const cols = this.#getColumns();
    const bar = this.#buildBarContent(cols);

    this.stdout.write(`${bar}\n`);
    this.#isRendered = true;
    this.#lastContent = bar;
    return bar;
  }

  /**
   * Render a compact token summary line (used after each assistant turn).
   * @returns {string}
   */
  renderTurnSummary() {
    if (!this.stdout || typeof this.stdout.write !== "function") return "";

    const parts = [];

    if (this.promptTokens > 0 || this.completionTokens > 0) {
      parts.push(
        `${this.chalk.dim("↑")} ${this.chalk.cyan(this.#formatTokens(this.promptTokens))}`,
        `${this.chalk.dim("↓")} ${this.chalk.green(this.#formatTokens(this.completionTokens))}`
      );
    }

    if (this.estimatedCost > 0) {
      parts.push(this.chalk.yellow(`$${this.estimatedCost.toFixed(4)}`));
    }

    if (parts.length === 0) return "";

    const line = `  ${this.chalk.dim("│")} ${parts.join(this.chalk.dim("  │  "))} ${this.chalk.dim("│")}`;
    this.stdout.write(`${line}\n`);
    return line;
  }

  /**
   * Clear the status bar from the screen.
   */
  clear() {
    if (!this.#isRendered || !this.isTTY) return;
    // The inline approach doesn't need explicit clearing since it's in scrollback
    this.#isRendered = false;
    this.#lastContent = "";
  }

  /**
   * Reset all token/cost counters.
   */
  resetCounters() {
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.estimatedCost = 0;
  }

  #buildBarContent(cols) {
    const parts = [];

    // Left: model (provider)
    if (this.model) {
      const providerStr = this.provider ? ` (${this.provider})` : "";
      parts.push(this.chalk.bold(this.model) + this.chalk.dim(providerStr));
    }

    // Center: branch or cwd
    if (this.branch) {
      parts.push(this.chalk.dim("⎇ ") + this.chalk.cyan(this.branch));
    } else if (this.cwd) {
      const shortCwd = this.#shortenPath(this.cwd);
      parts.push(this.chalk.dim(shortCwd));
    }

    // Right: token usage
    if (this.promptTokens > 0 || this.completionTokens > 0) {
      const tokenStr = `↑ ${this.#formatTokens(this.promptTokens)} ↓ ${this.#formatTokens(this.completionTokens)}`;
      parts.push(this.chalk.dim(tokenStr));
    }

    // Cost
    if (this.estimatedCost > 0) {
      parts.push(this.chalk.yellow(`$${this.estimatedCost.toFixed(2)}`));
    }

    const separator = this.chalk.dim("  │  ");
    const content = parts.join(separator);

    // Build the full bar line
    const barBg = this.chalk.dim("─".repeat(cols));
    return `${barBg}\n  ${content}`;
  }

  #formatTokens(count) {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
    return String(count);
  }

  #shortenPath(fullPath) {
    if (!fullPath) return "";
    // Replace home directory with ~
    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (home && fullPath.startsWith(home)) {
      return "~" + fullPath.slice(home.length).replace(/\\/g, "/");
    }
    // Just show last 2 segments
    const parts = fullPath.replace(/\\/g, "/").split("/");
    if (parts.length <= 2) return fullPath;
    return "…/" + parts.slice(-2).join("/");
  }

  #getColumns() {
    if (this.stdout && Number.isFinite(this.stdout.columns) && this.stdout.columns > 0) {
      return Math.min(this.stdout.columns, 120);
    }
    return 80;
  }
}

/**
 * Create a StatusBar instance.
 * @param {object} [options]
 * @returns {StatusBar}
 */
export function createStatusBar(options) {
  return new StatusBar(options);
}
