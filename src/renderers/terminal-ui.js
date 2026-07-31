import { Chalk } from "chalk";
import ora from "ora";
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
    this.chalk = new Chalk({ level: this.capabilities.shouldUseColor ? 1 : 0 });
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
    const width = Math.max(20, Math.min(this.stdout.columns ?? DEFAULT_DIVIDER_WIDTH, 120));
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
    return ora({
      text,
      stream: this.stderr,
      isEnabled: this.capabilities.shouldUseSpinner,
      isSilent: !this.capabilities.shouldUseSpinner || this.#shouldSuppressNonErrorOutput(),
      discardStdin: false,
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
      return task();
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
