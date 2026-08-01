import { createAnsiStyle } from "./ansi-style.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class NativeSpinner {
  constructor({
    text = "",
    stdout = process.stdout,
    stderr = process.stderr,
    env = process.env,
    intervalMs = 80
  } = {}) {
    this.text = text;
    this.stdout = stdout;
    this.stderr = stderr;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.frameIndex = 0;
    this.isSpinning = false;
    this.ansi = createAnsiStyle({ env });
    this.isTTY = Boolean(stdout && stdout.isTTY);
  }

  start(newText) {
    if (newText) this.text = newText;
    if (this.isSpinning) return this;

    this.isSpinning = true;

    if (!this.isTTY) {
      if (this.text) {
        this.stdout.write(`- ${this.text}\n`);
      }
      return this;
    }

    this.#render();
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
      this.#render();
    }, this.intervalMs);

    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }

    return this;
  }

  #render() {
    if (!this.isSpinning || !this.isTTY) return;
    const frame = this.ansi.cyan(SPINNER_FRAMES[this.frameIndex]);
    this.stdout.write(`\r\x1b[K${frame} ${this.text}`);
  }

  stop() {
    if (!this.isSpinning) return this;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.isTTY) {
      this.stdout.write("\r\x1b[K");
    }
    this.isSpinning = false;
    return this;
  }

  succeed(text) {
    this.stop();
    const message = text || this.text;
    if (message) {
      this.stdout.write(`${this.ansi.green("✔")} ${message}\n`);
    }
    return this;
  }

  fail(text) {
    this.stop();
    const message = text || this.text;
    if (message) {
      this.stderr.write(`${this.ansi.red("✖")} ${message}\n`);
    }
    return this;
  }

  warn(text) {
    this.stop();
    const message = text || this.text;
    if (message) {
      this.stdout.write(`${this.ansi.yellow("⚠")} ${message}\n`);
    }
    return this;
  }

  info(text) {
    this.stop();
    const message = text || this.text;
    if (message) {
      this.stdout.write(`${this.ansi.cyan("ℹ")} ${message}\n`);
    }
    return this;
  }
}
