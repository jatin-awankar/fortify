import { createTerminalUI } from "./terminal-ui.js";
import { renderBox } from "./ansi-box.js";

/** File extension → icon mapping. */
const FILE_ICONS = {
  ".js": "📜", ".mjs": "📜", ".cjs": "📜",
  ".ts": "📘", ".tsx": "📘",
  ".jsx": "⚛️",
  ".json": "📋", ".yaml": "📋", ".yml": "📋", ".toml": "📋",
  ".md": "📝", ".mdx": "📝",
  ".css": "🎨", ".scss": "🎨", ".less": "🎨",
  ".html": "🌐", ".htm": "🌐",
  ".py": "🐍",
  ".go": "🔵",
  ".rs": "🦀",
  ".sh": "🐚", ".bash": "🐚", ".zsh": "🐚",
  ".env": "🔐",
  ".sql": "🗄️",
  ".svg": "🖼️", ".png": "🖼️", ".jpg": "🖼️",
};

function getFileIcon(filepath) {
  if (!filepath) return "📄";
  const ext = filepath.match(/\.[a-zA-Z0-9]+$/)?.[0]?.toLowerCase();
  return FILE_ICONS[ext] || "📄";
}

export class DiffRenderer {
  constructor({ terminalUI = createTerminalUI() } = {}) {
    this.terminalUI = terminalUI;
    this.stdout = terminalUI.stdout;
    this.chalk = terminalUI.chalk;
  }

  /**
   * Render a diff card with file icon, stats, and collapsible content.
   *
   * @param {string} filepath - The file path being modified
   * @param {string} diffContent - The unified diff content
   * @param {object} [options]
   * @param {number} [options.additions] - Number of additions (auto-counted if not provided)
   * @param {number} [options.deletions] - Number of deletions (auto-counted if not provided)
   * @param {number} [options.collapseThreshold] - Max lines before auto-collapsing (default 25)
   * @param {boolean} [options.forceExpand] - Force show all lines
   * @returns {string}
   */
  renderDiffCard(filepath, diffContent, {
    additions = 0,
    deletions = 0,
    collapseThreshold = 25,
    forceExpand = false,
  } = {}) {
    if (!this.stdout || typeof this.stdout.write !== "function") return "";

    const lines = typeof diffContent === "string" ? diffContent.split("\n") : [];

    // Count additions & deletions if not provided
    if (!additions && !deletions) {
      for (const line of lines) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }
    }

    // File icon
    const icon = getFileIcon(filepath);

    // Stats badge
    const statsStr = ` ${this.chalk.green(`+${additions}`)} ${this.chalk.red(`-${deletions}`)}`;

    // Header with icon and stats
    const headerTitle = `╭─ ${icon} ${this.chalk.bold.cyan(filepath)}${statsStr} `;

    // Determine box inner width
    const maxLineLen = Math.max(filepath.length + 14, ...lines.map((l) => l.length), 35);
    const boxWidth = Math.min(maxLineLen + 4, 100);

    const topBorder = `${headerTitle}${"─".repeat(Math.max(0, boxWidth - filepath.length - 16))}╮\n`;
    const bottomBorder = `╰${"─".repeat(boxWidth)}╯\n`;

    // Determine lines to render (collapse if needed)
    let displayLines;
    let collapsedNotice = "";

    if (!forceExpand && lines.length > collapseThreshold) {
      const previewCount = Math.min(15, collapseThreshold);
      displayLines = lines.slice(0, previewCount);
      const remaining = lines.length - previewCount;
      collapsedNotice = `│ ${this.chalk.dim.italic(`... ${remaining} more lines (${additions} additions, ${deletions} deletions)`).padEnd(boxWidth - 2)} │\n`;
    } else {
      displayLines = lines;
    }

    // Render lines
    let body = "";
    for (const line of displayLines) {
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

    const output = `${topBorder}${body}${collapsedNotice}${bottomBorder}`;
    this.stdout.write(output);
    return output;
  }

  /**
   * Render a compact diff summary (inline, no box).
   *
   * @param {string} filepath
   * @param {{ additions?: number, deletions?: number }} [stats]
   * @returns {string}
   */
  renderDiffSummary(filepath, { additions = 0, deletions = 0 } = {}) {
    if (!this.stdout || typeof this.stdout.write !== "function") return "";

    const icon = getFileIcon(filepath);
    const addStr = additions > 0 ? this.chalk.green(`+${additions}`) : "";
    const delStr = deletions > 0 ? this.chalk.red(`-${deletions}`) : "";
    const stats = [addStr, delStr].filter(Boolean).join(" ");
    const line = `  ${icon} ${this.chalk.bold(filepath)}  ${stats}\n`;

    this.stdout.write(line);
    return line;
  }
}

export function createDiffRenderer(options) {
  return new DiffRenderer(options);
}
