import { createTerminalUI } from "./terminal-ui.js";

export const ACTION_TYPES = {
  READ_FILE: "read_file",
  WRITE_FILE: "write_file",
  EXECUTE_COMMAND: "execute_command",
  THINKING: "thinking",
  SEARCH: "search",
  CUSTOM: "custom"
};

const TYPE_ICONS = {
  read_file: "📄",
  write_file: "📝",
  execute_command: "⚡",
  thinking: "🧠",
  search: "🔍",
  custom: "●"
};

export class ActionCardRenderer {
  constructor({ terminalUI = createTerminalUI() } = {}) {
    this.terminalUI = terminalUI;
    this.stdout = terminalUI.stdout;
    this.chalk = terminalUI.chalk;
    this.capabilities = terminalUI.capabilities;
    this.lastCardWritten = false;
  }

  renderCard({ type = ACTION_TYPES.CUSTOM, title, metadata = "", status = "pending" }) {
    if (this.#shouldSuppress()) return "";

    const icon = TYPE_ICONS[type] || TYPE_ICONS.custom;
    const metaStr = metadata ? this.chalk.dim(` (${metadata})`) : "";
    let statusSymbol = this.chalk.cyan(icon);

    if (status === "success") {
      statusSymbol = this.chalk.green("✓");
    } else if (status === "error") {
      statusSymbol = this.chalk.red("✖");
    } else if (status === "running") {
      statusSymbol = this.chalk.yellow("⠋");
    }

    const titleStr = status === "error" 
      ? this.chalk.red(title) 
      : status === "success"
        ? this.chalk.bold(title)
        : this.chalk.cyan(title);

    const formatted = `  ${statusSymbol} ${titleStr}${metaStr}\n`;
    if (this.stdout && typeof this.stdout.write === "function") {
      this.stdout.write(formatted);
      this.lastCardWritten = true;
    }
    return formatted;
  }

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

  renderStepProgress(current, total, title) {
    if (this.#shouldSuppress()) return "";

    const badge = this.chalk.dim(`[${current}/${total}]`);
    const formatted = `\n${badge} ${this.chalk.bold.cyan(title)}\n`;
    if (this.stdout && typeof this.stdout.write === "function") {
      this.stdout.write(formatted);
      this.lastCardWritten = false;
    }
    return formatted;
  }

  renderCommandCard(command, { cwd, status = "running" } = {}) {
    if (this.#shouldSuppress()) return "";

    const statusBadge = status === "success" 
      ? this.chalk.green("✓")
      : status === "error"
        ? this.chalk.red("✖")
        : this.chalk.yellow("⚡");

    const cwdInfo = cwd ? this.chalk.dim(` in ${cwd}`) : "";
    const formatted = `  ${statusBadge} ${this.chalk.bold("Run")} ${this.chalk.cyan(`\`${command}\``)}${cwdInfo}\n`;
    if (this.stdout && typeof this.stdout.write === "function") {
      this.stdout.write(formatted);
      this.lastCardWritten = true;
    }
    return formatted;
  }

  #shouldSuppress() {
    return !this.stdout;
  }
}

export function createActionCardRenderer(options) {
  return new ActionCardRenderer(options);
}
