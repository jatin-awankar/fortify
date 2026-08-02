import { createTerminalUI } from "./terminal-ui.js";
import { appMetadata } from "../config/app-metadata.js";

export class TUISession {
  constructor({ terminalUI = createTerminalUI() } = {}) {
    this.terminalUI = terminalUI;
    this.stdout = terminalUI.stdout;
    this.stdin = terminalUI.stdin;
    this.chalk = terminalUI.chalk;
  }

  renderHeader({ model = "default", provider = "openai", cwd = process.cwd(), sessionId = "default" } = {}) {
    if (!this.stdout || typeof this.stdout.write !== "function") return "";

    const title = `${appMetadata.displayName} v${appMetadata.version}`;
    const cols = Math.min(this.stdout.columns || 80, 100);
    
    const line1 = ` ${this.chalk.bold.cyan(title)} │ ${this.chalk.bold(`Model:`)} ${model} (${provider})`;
    const line2 = ` ${this.chalk.dim(`CWD:`)} ${cwd} │ ${this.chalk.dim(`Session:`)} ${sessionId}`;

    const topBorder = `┌${"─".repeat(cols - 2)}┐\n`;
    const midBorder = `├${"─".repeat(cols - 2)}┤\n`;
    const bottomBorder = `└${"─".repeat(cols - 2)}┘\n`;

    const formattedLine1 = `│${line1.padEnd(cols + 15)}│\n`; // Account for ANSI sequences
    const formattedLine2 = `│${line2.padEnd(cols + 23)}│\n`;

    const banner = `${topBorder}│ ${this.chalk.bold.cyan(title)} | ${this.chalk.dim(`Model: ${model}`)} | ${this.chalk.dim(`Session: ${sessionId}`)}\n${bottomBorder}`;
    
    this.stdout.write(banner);
    return banner;
  }

  renderHelpFooter() {
    if (!this.stdout || typeof this.stdout.write !== "function") return "";

    const tips = `${this.chalk.dim("Commands:")} ${this.chalk.cyan("/help")}, ${this.chalk.cyan("/clear")}, ${this.chalk.cyan("/diff")}, ${this.chalk.cyan("/commit")}, ${this.chalk.cyan("/exit")} │ ${this.chalk.dim("Files:")} ${this.chalk.cyan("@filename")}\n`;
    this.stdout.write(tips);
    return tips;
  }

  async confirmAction(question, defaultYes = false) {
    if (!this.stdin || !this.stdout || !process.stdin.isTTY) {
      return defaultYes;
    }

    const promptSuffix = defaultYes ? "[Y/n]" : "[y/N]";
    this.stdout.write(`\n  ${this.chalk.yellow("?")} ${question} ${this.chalk.dim(promptSuffix)} `);

    return new Promise((resolve) => {
      const onData = (data) => {
        const input = data.toString().trim().toLowerCase();
        this.stdin.removeListener("data", onData);
        if (this.stdin.isRaw) {
          this.stdin.setRawMode(false);
        }

        if (input === "y" || input === "yes") {
          resolve(true);
        } else if (input === "n" || input === "no") {
          resolve(false);
        } else {
          resolve(defaultYes);
        }
      };

      if (typeof this.stdin.setRawMode === "function") {
        this.stdin.setRawMode(true);
      }
      this.stdin.resume();
      this.stdin.once("data", onData);
    });
  }
}

export function createTUISession(options) {
  return new TUISession(options);
}
