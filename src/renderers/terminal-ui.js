import { createAnsiStyle } from "./ansi-style.js";
import { NativeSpinner } from "./native-spinner.js";
import { detectTerminalCapabilities } from "../utils/terminal-capabilities.js";
import { getRuntimeOptions } from "../utils/runtime-options.js";

const DEFAULT_DIVIDER_WIDTH = 80;
const STATUS_LABELS = {
  success: "[SUCCESS]",
  error: "[ERROR]",
  warning: "[WARNING]",
  info: "[INFO]"
};

export class TerminalUI {
  constructor({
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    env = process.env
  } = {}) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.stderr = stderr;
    this.capabilities = detectTerminalCapabilities({ stdin, stdout, stderr, env });
    this.chalk = createAnsiStyle({ env, forceColor: this.capabilities.shouldUseColor });
  }

  success(message) {
    if (this.#shouldSuppressNonErrorOutput()) {
      return;
    }
    this.#writeLine(this.stdout, this.chalk.green(STATUS_LABELS.success), message);
  }

  error(message) {
    if (getRuntimeOptions().json) {
      return;
    }
    this.#writeLine(this.stderr, this.chalk.red(STATUS_LABELS.error), message);
  }

  warning(message) {
    if (this.#shouldSuppressNonErrorOutput()) {
      return;
    }
    this.#writeLine(this.stderr, this.chalk.yellow(STATUS_LABELS.warning), message);
  }

  info(message) {
    if (this.#shouldSuppressNonErrorOutput()) {
      return;
    }
    this.#writeLine(this.stdout, this.chalk.blue(STATUS_LABELS.info), message);
  }

  divider(label = "") {
    if (this.#shouldSuppressNonErrorOutput()) {
      return;
    }
    const cols = Number.isFinite(this.stdout?.columns) && this.stdout.columns > 0 ? this.stdout.columns : DEFAULT_DIVIDER_WIDTH;
    const width = Math.max(20, Math.min(cols, 120));
    const content = label ? ` ${label.trim()} ` : "";
    const base = width - content.length;

    if (base <= 0) {
      this.stdout.write(`${this.chalk.dim(content.trim())}\n`);
      return;
    }

    const left = Math.floor(base / 2);
    const right = base - left;
    const line = `${"-".repeat(left)}${content}${"-".repeat(right)}`;
    this.stdout.write(`${this.chalk.dim(line)}\n`);
  }

  createSpinner(text, options = {}) {
    return new NativeSpinner({
      text,
      stream: this.stderr,
      isEnabled: this.capabilities.shouldUseSpinner && !this.#shouldSuppressNonErrorOutput(),
      ...options
    });
  }

  startSpinner(text, options = {}) {
    const spinner = this.createSpinner(text, options);
    spinner.start();
    return spinner;
  }

  stopSpinner(spinner, { status = "stop", text } = {}) {
    if (!spinner) {
      return;
    }

    if (text) {
      spinner.text = text;
    }

    if (typeof spinner[status] === "function") {
      spinner[status](text);
      return;
    }

    spinner.stop();
  }

  async withSpinner(text, task, options = {}) {
    if (!this.capabilities.shouldUseSpinner) {
      return task({ text, succeed: () => {}, fail: () => {}, stop: () => {} });
    }

    const spinner = this.startSpinner(text, options);

    try {
      const result = await task(spinner);
      spinner.succeed(text);
      return result;
    } catch (error) {
      spinner.fail(text);
      throw error;
    }
  }

  box(title = "", content = "") {
    if (this.#shouldSuppressNonErrorOutput()) return;

    const lines = typeof content === "string" ? content.split("\n") : [];
    const maxLineLength = Math.max(title.length + 4, ...lines.map((l) => l.length), 30);
    const innerWidth = maxLineLength + 2;

    const topBorder = `┌─ ${this.chalk.bold.cyan(title)} ${"─".repeat(Math.max(0, innerWidth - title.length - 4))}┐`;
    const bottomBorder = `└${"─".repeat(innerWidth)}┘`;

    this.stdout.write(`${topBorder}\n`);
    for (const line of lines) {
      const paddedLine = line.padEnd(maxLineLength, " ");
      this.stdout.write(`│ ${paddedLine} │\n`);
    }
    this.stdout.write(`${bottomBorder}\n`);
  }

  table(headers = [], rows = []) {
    if (this.#shouldSuppressNonErrorOutput()) return;

    const colWidths = headers.map((h, i) => {
      const maxRowLen = Math.max(...rows.map((r) => String(r[i] ?? "").length), 0);
      return Math.max(h.length, maxRowLen);
    });

    const headerStr = headers.map((h, i) => this.chalk.bold(h.padEnd(colWidths[i]))).join(" │ ");
    const separatorStr = colWidths.map((w) => "─".repeat(w)).join("─┼─");

    this.stdout.write(`\n${headerStr}\n${separatorStr}\n`);
    for (const row of rows) {
      const rowStr = row
        .slice(0, headers.length)
        .map((cell, i) => String(cell ?? "").padEnd(colWidths[i]))
        .join(" │ ");
      this.stdout.write(`${rowStr}\n`);
    }
    this.stdout.write("\n");
  }

  #writeLine(stream, label, message) {
    stream.write(`${label} ${message}\n`);
  }

  #shouldSuppressNonErrorOutput() {
    const options = getRuntimeOptions();
    return options.quiet || options.json;
  }
}

export function createTerminalUI(options) {
  return new TerminalUI(options);
}
