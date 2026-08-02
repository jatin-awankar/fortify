import readline from "node:readline";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const DEFAULT_SLASH_COMMANDS = [
  "/commit",
  "/explain",
  "/summary",
  "/clear",
  "/model",
  "/diff",
  "/help",
  "/exit"
];

export function findWorkspaceFiles(dir = process.cwd(), maxDepth = 3, currentDepth = 0) {
  const fileList = [];
  if (currentDepth > maxDepth) return fileList;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        fileList.push(...findWorkspaceFiles(fullPath, maxDepth, currentDepth + 1));
      } else if (entry.isFile()) {
        fileList.push(relative(process.cwd(), fullPath).replace(/\\/g, "/"));
      }
    }
  } catch {
    // Ignore unreadable directories
  }

  return fileList;
}

export function createCompleter({
  commands = DEFAULT_SLASH_COMMANDS,
  getFiles = findWorkspaceFiles
} = {}) {
  return function completer(line) {
    const trimmed = line.trimStart();

    // Slash command completions
    if (trimmed.startsWith("/")) {
      const hits = commands.filter((c) => c.startsWith(trimmed));
      return [hits.length ? hits : commands, line];
    }

    // @file path completions
    const atMatch = line.match(/@([^\s]*)$/);
    if (atMatch) {
      const prefix = atMatch[1];
      const files = getFiles();
      const hits = files
        .filter((f) => f.toLowerCase().startsWith(prefix.toLowerCase()))
        .map((f) => `@${f}`);

      const baseLine = line.slice(0, line.lastIndexOf("@"));
      const completions = hits.map((h) => `${baseLine}${h}`);
      return [completions.length ? completions : hits, line];
    }

    return [[], line];
  };
}

export class PromptEditor {
  constructor({
    stdin = process.stdin,
    stdout = process.stdout,
    commands = DEFAULT_SLASH_COMMANDS,
    getFiles = findWorkspaceFiles
  } = {}) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.completer = createCompleter({ commands, getFiles });
  }

  createInterface() {
    return readline.createInterface({
      input: this.stdin,
      output: this.stdout,
      completer: this.completer
    });
  }
}
