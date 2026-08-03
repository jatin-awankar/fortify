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
  "/history",
  "/status",
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

/**
 * Input history manager with persistence-ready design.
 *
 * Tracks user input history with deduplication, max size, and
 * up/down navigation support.
 */
export class InputHistory {
  #entries = [];
  #cursor = -1;
  #maxSize;
  #currentDraft = "";

  constructor({ maxSize = 200 } = {}) {
    this.#maxSize = maxSize;
  }

  /**
   * Add an entry to history (if not duplicate of last).
   * @param {string} entry
   */
  push(entry) {
    const trimmed = (entry || "").trim();
    if (!trimmed) return;

    // Remove duplicate if it's the last entry
    if (this.#entries.length > 0 && this.#entries[this.#entries.length - 1] === trimmed) {
      // Already the most recent — skip
    } else {
      this.#entries.push(trimmed);
    }

    // Enforce max size
    if (this.#entries.length > this.#maxSize) {
      this.#entries.shift();
    }

    this.resetCursor();
  }

  /**
   * Navigate backward in history (older).
   * @param {string} [currentInput] - The current line content (saved as draft)
   * @returns {string|null} Previous entry, or null if at beginning
   */
  previous(currentInput = "") {
    if (this.#entries.length === 0) return null;

    // Save current input as draft on first navigation
    if (this.#cursor === -1) {
      this.#currentDraft = currentInput;
      this.#cursor = this.#entries.length;
    }

    if (this.#cursor > 0) {
      this.#cursor--;
      return this.#entries[this.#cursor];
    }

    return this.#entries[0] ?? null;
  }

  /**
   * Navigate forward in history (newer).
   * @returns {string|null} Next entry, or the draft if at the end
   */
  next() {
    if (this.#cursor === -1) return null;

    this.#cursor++;

    if (this.#cursor >= this.#entries.length) {
      this.#cursor = -1;
      return this.#currentDraft;
    }

    return this.#entries[this.#cursor];
  }

  /**
   * Reset the cursor to the end (for new input).
   */
  resetCursor() {
    this.#cursor = -1;
    this.#currentDraft = "";
  }

  /**
   * Get all history entries.
   * @returns {string[]}
   */
  getEntries() {
    return [...this.#entries];
  }

  /**
   * Get the number of entries.
   * @returns {number}
   */
  get size() {
    return this.#entries.length;
  }

  /**
   * Load entries from a serialized array (for persistence).
   * @param {string[]} entries
   */
  load(entries) {
    if (Array.isArray(entries)) {
      this.#entries = entries.slice(-this.#maxSize);
      this.resetCursor();
    }
  }

  /**
   * Clear all history.
   */
  clear() {
    this.#entries = [];
    this.resetCursor();
  }
}

export class PromptEditor {
  constructor({
    stdin = process.stdin,
    stdout = process.stdout,
    commands = DEFAULT_SLASH_COMMANDS,
    getFiles = findWorkspaceFiles,
    history,
  } = {}) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.commands = commands;
    this.completer = createCompleter({ commands, getFiles });
    this.history = history || new InputHistory();
  }

  /**
   * Create a readline interface with tab completion and history.
   * @returns {readline.Interface}
   */
  createInterface() {
    return readline.createInterface({
      input: this.stdin,
      output: this.stdout,
      completer: this.completer,
      history: this.history.getEntries(),
      historySize: 200,
      removeHistoryDuplicates: true,
    });
  }

  /**
   * Record a user input to history.
   * @param {string} input
   */
  recordInput(input) {
    this.history.push(input);
  }

  /**
   * Get the current slash command list (for dynamic registration).
   * @returns {string[]}
   */
  getCommands() {
    return [...this.commands];
  }

  /**
   * Update the command list (e.g., when custom commands are registered).
   * @param {string[]} commands
   */
  setCommands(commands) {
    this.commands = commands;
    this.completer = createCompleter({ commands, getFiles: findWorkspaceFiles });
  }
}
