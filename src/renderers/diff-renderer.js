import { createTerminalUI } from "./terminal-ui.js";

export class DiffRenderer {
  constructor({ terminalUI = createTerminalUI() } = {}) {
    this.terminalUI = terminalUI;
    this.stdout = terminalUI.stdout;
    this.chalk = terminalUI.chalk;
  }

  renderDiffCard(filepath, diffContent, { additions = 0, deletions = 0 } = {}) {
    if (!this.stdout || typeof this.stdout.write !== "function") return "";

    const lines = typeof diffContent === "string" ? diffContent.split("\n") : [];
    
    // Count additions & deletions if not provided
    if (!additions && !deletions) {
      for (const line of lines) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }
    }

    const statsStr = ` ${this.chalk.green(`+${additions}`)} ${this.chalk.red(`-${deletions}`)}`;
    const headerTitle = `╭─ ${this.chalk.bold.cyan(filepath)}${statsStr} `;
    
    // Determine box inner width
    const maxLineLen = Math.max(filepath.length + 10, ...lines.map((l) => l.length), 35);
    const boxWidth = Math.min(maxLineLen + 4, 100);

    const topBorder = `${headerTitle}${"─".repeat(Math.max(0, boxWidth - filepath.length - 12))}╮\n`;
    const bottomBorder = `╰${"─".repeat(boxWidth)}╯\n`;

    let body = "";
    for (const line of lines) {
      const truncatedLine = line.slice(0, boxWidth - 2);
      if (line.startsWith("+") && !line.startsWith("+++")) {
        body += `│ ${this.chalk.green(truncatedLine.padEnd(boxWidth - 2))} │\n`;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        body += `│ ${this.chalk.red(truncatedLine.padEnd(boxWidth - 2))} │\n`;
      } else if (line.startsWith("@@")) {
        body += `│ ${this.chalk.cyan(truncatedLine.padEnd(boxWidth - 2))} │\n`;
      } else {
        body += `│ ${this.chalk.dim(truncatedLine.padEnd(boxWidth - 2))} │\n`;
      }
    }

    const output = `${topBorder}${body}${bottomBorder}`;
    this.stdout.write(output);
    return output;
  }
}

export function createDiffRenderer(options) {
  return new DiffRenderer(options);
}
