/**
 * Memory Service — persistent, per-project LLM memory.
 *
 * Manages `.fortify/memory.md` — a markdown file that stores project conventions,
 * user preferences, and agent-learned patterns that persist across sessions.
 *
 * The memory file uses timestamped entries for traceability:
 * ```markdown
 * ## 2026-08-20 09:30
 * Always use `const` over `let`. Prefer arrow functions for callbacks.
 *
 * ## 2026-08-20 10:15
 * Test files go in `test/` with the pattern `{module}.test.js`.
 * ```
 *
 * The LLM can also write to this file via the `write_file` tool autonomously.
 *
 * Zero external dependencies — pure Node.js built-in modules.
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Default memory file name within the .fortify directory.
 */
const MEMORY_FILENAME = "memory.md";

/**
 * Default max token budget for memory in the system prompt.
 */
const DEFAULT_MAX_MEMORY_TOKENS = 1500;

/**
 * MemoryService — read/write/append persistent project memory.
 *
 * Usage:
 * ```js
 * const memory = new MemoryService();
 * await memory.appendMemory("/project", "Always use const");
 * const content = await memory.loadMemory("/project");
 * ```
 */
export class MemoryService {
  /**
   * @param {object} [options]
   * @param {object} [options.fsPromises] - Filesystem module (for testing)
   */
  constructor({
    fsPromises = { access, mkdir, readFile, writeFile },
  } = {}) {
    this.fs = fsPromises;
  }

  /**
   * Get the path to the memory file.
   *
   * @param {string} cwd - Project root directory
   * @returns {string} Absolute path to `.fortify/memory.md`
   */
  getMemoryPath(cwd) {
    if (!cwd || typeof cwd !== "string") {
      throw new Error("MemoryService requires a valid cwd (project root directory).");
    }
    return path.join(cwd, ".fortify", MEMORY_FILENAME);
  }

  /**
   * Load the memory file contents.
   *
   * @param {string} cwd - Project root directory
   * @returns {Promise<string>} Memory content (empty string if file doesn't exist)
   */
  async loadMemory(cwd) {
    const memoryPath = this.getMemoryPath(cwd);

    try {
      const content = await this.fs.readFile(memoryPath, "utf8");
      return content;
    } catch (error) {
      if (error?.code === "ENOENT") {
        return "";
      }
      // Propagate real errors (EACCES, EIO, etc.) — don't silently swallow them
      throw error;
    }
  }

  /**
   * Save full memory content, replacing any existing content.
   * Creates the `.fortify/` directory if it doesn't exist.
   *
   * @param {string} cwd - Project root directory
   * @param {string} content - Full memory content to write
   * @returns {Promise<void>}
   */
  async saveMemory(cwd, content) {
    const memoryPath = this.getMemoryPath(cwd);
    const dirPath = path.dirname(memoryPath);

    await this.fs.mkdir(dirPath, { recursive: true });
    await this.fs.writeFile(memoryPath, content, "utf8");
  }

  /**
   * Append a timestamped entry to the memory file.
   *
   * Format:
   * ```
   * ## YYYY-MM-DD HH:MM
   * {entry text}
   * ```
   *
   * @param {string} cwd - Project root directory
   * @param {string} entry - Memory entry text
   * @param {Date} [date] - Timestamp (defaults to now, injectable for testing)
   * @returns {Promise<void>}
   */
  async appendMemory(cwd, entry, date) {
    if (!entry || typeof entry !== "string" || !entry.trim()) {
      return;
    }

    const existing = await this.loadMemory(cwd);
    const timestamp = this.#formatTimestamp(date || new Date());
    const newEntry = `\n## ${timestamp}\n${entry.trim()}\n`;

    const updated = existing ? existing.trimEnd() + "\n" + newEntry : newEntry.trimStart();
    await this.saveMemory(cwd, updated);
  }

  /**
   * Clear all memory entries.
   *
   * @param {string} cwd - Project root directory
   * @returns {Promise<void>}
   */
  async clearMemory(cwd) {
    const memoryPath = this.getMemoryPath(cwd);

    try {
      await this.fs.writeFile(memoryPath, "", "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        return; // Nothing to clear — file and/or directory doesn't exist
      }
      throw error;
    }
  }

  /**
   * Check if a memory file exists.
   *
   * @param {string} cwd - Project root directory
   * @returns {Promise<boolean>}
   */
  async hasMemory(cwd) {
    try {
      await this.fs.access(this.getMemoryPath(cwd));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Count the number of memory entries.
   *
   * @param {string} cwd - Project root directory
   * @returns {Promise<number>}
   */
  async countEntries(cwd) {
    const content = await this.loadMemory(cwd);
    if (!content.trim()) return 0;

    // Count ## headings
    const matches = content.match(/^## /gm);
    return matches ? matches.length : 0;
  }

  /**
   * Format memory content for system prompt injection.
   *
   * Applies token budget: truncates from the top (oldest entries removed first)
   * to keep the most recent entries within budget.
   *
   * @param {string} content - Raw memory file content
   * @param {object} [options]
   * @param {number} [options.maxTokens=1500] - Token budget
   * @returns {string} Formatted and potentially truncated memory
   */
  formatForPrompt(content, { maxTokens = DEFAULT_MAX_MEMORY_TOKENS } = {}) {
    if (!content || !content.trim()) {
      return "";
    }

    const trimmed = content.trim();
    const estimatedTokens = Math.ceil(trimmed.length / 4);

    if (estimatedTokens <= maxTokens) {
      return trimmed;
    }

    // Split into entries and keep most recent (from the bottom)
    const entries = trimmed.split(/(?=^## )/gm).filter((e) => e.trim());

    if (entries.length === 0) {
      return trimmed.slice(-(maxTokens * 4));
    }

    // Build from the end, keeping most recent entries
    const kept = [];
    let tokenCount = 0;
    const truncationNotice = "[Earlier entries truncated for token budget]\n\n";
    const noticeTokens = Math.ceil(truncationNotice.length / 4);

    for (let i = entries.length - 1; i >= 0; i--) {
      const entryTokens = Math.ceil(entries[i].length / 4);

      if (tokenCount + entryTokens + (i > 0 ? noticeTokens : 0) > maxTokens) {
        break;
      }

      kept.unshift(entries[i]);
      tokenCount += entryTokens;
    }

    if (kept.length === 0) {
      // Even a single entry exceeds budget — hard truncate the last entry
      // Subtract notice overhead so total output stays within budget
      const lastEntry = entries[entries.length - 1];
      const availableChars = Math.max(0, (maxTokens * 4) - truncationNotice.length);
      return truncationNotice + lastEntry.slice(0, availableChars);
    }

    if (kept.length < entries.length) {
      return truncationNotice + kept.join("").trim();
    }

    return kept.join("").trim();
  }

  /**
   * Format a timestamp for memory entries.
   *
   * @param {Date} date
   * @returns {string} "YYYY-MM-DD HH:MM"
   */
  #formatTimestamp(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }
}

/**
 * Create a MemoryService instance.
 * @param {object} [options]
 * @returns {MemoryService}
 */
export function createMemoryService(options) {
  return new MemoryService(options);
}
