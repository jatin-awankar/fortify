import { createAnsiStyle, ANSI } from "./ansi-style.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DOT_FRAMES = ["   ", ".  ", ".. ", "..."];
const DEFAULT_INTERVAL_MS = 80;

/**
 * A dedicated "thinking" indicator that mimics Claude Code's thinking display.
 *
 * Features:
 * - Animated braille spinner with elapsed time counter
 * - Extended thinking mode with pulsing dots
 * - Graceful fade-out when streaming begins
 * - Non-TTY fallback: simple static text
 */
export class ThinkingIndicator {
  #timer = null;
  #frameIndex = 0;
  #dotIndex = 0;
  #isActive = false;
  #startTime = null;
  #mode = "default";

  constructor({
    stdout = process.stdout,
    env = process.env,
    intervalMs = DEFAULT_INTERVAL_MS,
    label = "Thinking",
  } = {}) {
    this.stdout = stdout;
    this.intervalMs = intervalMs;
    this.label = label;
    this.isTTY = Boolean(stdout && stdout.isTTY);
    this.chalk = createAnsiStyle({ env });
  }

  /** Whether the indicator is currently running. */
  get isActive() {
    return this.#isActive;
  }

  /** Elapsed time in seconds since start. */
  get elapsedSeconds() {
    if (!this.#startTime) return 0;
    return (Date.now() - this.#startTime) / 1000;
  }

  /**
   * Start the thinking indicator.
   * @param {"default"|"extended"} [mode="default"] - "default" for simple spinner, "extended" for 🧠 with dots
   * @returns {ThinkingIndicator}
   */
  start(mode = "default") {
    if (this.#isActive) return this;

    this.#mode = mode;
    this.#isActive = true;
    this.#startTime = Date.now();
    this.#frameIndex = 0;
    this.#dotIndex = 0;

    if (!this.isTTY) {
      const icon = mode === "extended" ? "🧠 " : "";
      this.stdout.write(`${icon}${this.label}...\n`);
      return this;
    }

    // Hide cursor while animating
    this.stdout.write(ANSI.cursorHide);
    this.#render();

    this.#timer = setInterval(() => {
      this.#frameIndex = (this.#frameIndex + 1) % SPINNER_FRAMES.length;
      this.#dotIndex = (this.#dotIndex + 1) % DOT_FRAMES.length;
      this.#render();
    }, this.intervalMs);

    if (typeof this.#timer.unref === "function") {
      this.#timer.unref();
    }

    return this;
  }

  /**
   * Stop the thinking indicator and clear the line.
   * @returns {ThinkingIndicator}
   */
  stop() {
    if (!this.#isActive) return this;

    this.#clearTimer();

    if (this.isTTY) {
      // Clear the spinner line and restore cursor
      this.stdout.write(`\r${ANSI.eraseLine}${ANSI.cursorShow}`);
    }

    this.#isActive = false;
    return this;
  }

  /**
   * Stop with a success message replacing the spinner.
   * @param {string} [text] - Completion message
   * @returns {ThinkingIndicator}
   */
  complete(text) {
    if (!this.#isActive) return this;

    const elapsed = this.#formatElapsed();
    this.#clearTimer();

    if (this.isTTY) {
      this.stdout.write(`\r${ANSI.eraseLine}`);
    }

    const message = text || `${this.label} complete`;
    const elapsedStr = elapsed ? this.chalk.dim(` (${elapsed})`) : "";
    this.stdout.write(`${this.chalk.green("✓")} ${this.chalk.dim(message)}${elapsedStr}\n`);

    if (this.isTTY) {
      this.stdout.write(ANSI.cursorShow);
    }

    this.#isActive = false;
    return this;
  }

  #render() {
    if (!this.#isActive || !this.isTTY) return;

    const elapsed = this.#formatElapsed();
    const elapsedStr = elapsed ? this.chalk.dim(` (${elapsed})`) : "";

    let line;
    if (this.#mode === "extended") {
      const dots = DOT_FRAMES[this.#dotIndex];
      line = `  🧠 ${this.chalk.cyan(this.label)}${this.chalk.dim(dots)}${elapsedStr}`;
    } else {
      const frame = this.chalk.cyan(SPINNER_FRAMES[this.#frameIndex]);
      line = `  ${frame} ${this.chalk.dim(this.label)}${elapsedStr}`;
    }

    this.stdout.write(`\r${ANSI.eraseLine}${line}`);
  }

  #formatElapsed() {
    const seconds = this.elapsedSeconds;
    if (seconds < 1) return "";
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m${secs}s`;
  }

  #clearTimer() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#startTime = null;
  }
}

/**
 * Create a ThinkingIndicator instance.
 * @param {object} [options]
 * @returns {ThinkingIndicator}
 */
export function createThinkingIndicator(options) {
  return new ThinkingIndicator(options);
}
