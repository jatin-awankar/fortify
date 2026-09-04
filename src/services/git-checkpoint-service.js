/**
 * Git Checkpoint Service — stash-based save points for agentic changes.
 *
 * Creates named git stash entries before each agentic turn so that
 * changes can be rolled back if tests fail or the user runs `/undo`.
 *
 * Checkpoint naming convention:
 *   `fortify/checkpoint/{timestamp}/{label}`
 *
 * Example stash list output:
 *   stash@{0}: On main: fortify/checkpoint/2026-08-27T16:30:00/pre-edit
 *   stash@{1}: On main: fortify/checkpoint/2026-08-27T16:25:00/pre-edit
 *   stash@{2}: WIP on main: 3abc123 my manual stash
 *
 * Only entries matching the `fortify/checkpoint/` prefix are managed
 * by this service — user stashes are never touched.
 *
 * Zero external dependencies — uses GitService for all git operations.
 */

import { GitService } from "./git-service.js";

/**
 * Prefix used to identify Fortify-managed stash entries.
 */
const CHECKPOINT_PREFIX = "fortify/checkpoint/";

/**
 * Default label for checkpoints.
 */
const DEFAULT_LABEL = "pre-edit";

export class GitCheckpointService {
  /**
   * @param {object} [options]
   * @param {GitService} [options.gitService] - GitService instance
   * @param {string} [options.cwd] - Default working directory
   */
  constructor({ gitService, cwd = process.cwd() } = {}) {
    this.gitService = gitService || new GitService({ cwd });
    this.cwd = cwd;
  }

  /**
   * Create a checkpoint by staging all changes and stashing them.
   *
   * If there are no uncommitted changes, no checkpoint is created
   * (nothing to save/restore).
   *
   * @param {object} [options]
   * @param {string} [options.cwd] - Working directory
   * @param {string} [options.label] - Human-readable label
   * @param {Date} [options.date] - Timestamp (injectable for testing)
   * @returns {Promise<{ created: boolean, message?: string, timestamp?: string }>}
   */
  async createCheckpoint({ cwd = this.cwd, label = DEFAULT_LABEL, date } = {}) {
    const isRepo = await this.gitService.isGitRepository({ cwd });
    if (!isRepo) {
      return { created: false, message: "Not a git repository." };
    }

    const hasChanges = await this.hasUncommittedChanges({ cwd });
    if (!hasChanges) {
      return { created: false, message: "No uncommitted changes to checkpoint." };
    }

    const timestamp = this.#formatTimestamp(date || new Date());
    const stashMessage = `${CHECKPOINT_PREFIX}${timestamp}/${label}`;

    // Stage all changes (including untracked files) before stashing
    await this.#runGit(["add", "-A"], { cwd });
    await this.#runGit(["stash", "push", "-m", stashMessage], { cwd });

    return {
      created: true,
      message: stashMessage,
      timestamp,
    };
  }

  /**
   * List all Fortify checkpoints from the stash.
   *
   * @param {object} [options]
   * @param {string} [options.cwd] - Working directory
   * @returns {Promise<Array<{ index: number, timestamp: string, label: string, raw: string }>>}
   */
  async listCheckpoints({ cwd = this.cwd } = {}) {
    const isRepo = await this.gitService.isGitRepository({ cwd });
    if (!isRepo) {
      return [];
    }

    const result = await this.#runGit(["stash", "list"], { cwd });
    if (!result.ok || !result.stdout.trim()) {
      return [];
    }

    const checkpoints = [];
    const lines = result.stdout.split("\n").filter(Boolean);

    for (const line of lines) {
      // Format: "stash@{N}: On branch: message"
      const indexMatch = line.match(/^stash@\{(\d+)\}/);
      if (!indexMatch) continue;

      const index = parseInt(indexMatch[1], 10);

      // Find the fortify checkpoint message
      const messageStart = line.indexOf(CHECKPOINT_PREFIX);
      if (messageStart === -1) continue;

      const message = line.slice(messageStart);
      const parts = message.slice(CHECKPOINT_PREFIX.length).split("/");
      const timestamp = parts[0] || "";
      const label = parts.slice(1).join("/") || DEFAULT_LABEL;

      checkpoints.push({
        index,
        timestamp,
        label,
        raw: line.trim(),
      });
    }

    return checkpoints;
  }

  /**
   * Restore a checkpoint by popping the stash entry.
   *
   * @param {object} [options]
   * @param {string} [options.cwd] - Working directory
   * @param {number} [options.index] - Stash index to restore (default: latest fortify checkpoint)
   * @returns {Promise<{ restored: boolean, message?: string, error?: string }>}
   */
  async restoreCheckpoint({ cwd = this.cwd, index } = {}) {
    const isRepo = await this.gitService.isGitRepository({ cwd });
    if (!isRepo) {
      return { restored: false, error: "Not a git repository." };
    }

    // If no index specified, find the latest Fortify checkpoint
    let targetIndex = index;
    if (targetIndex === undefined || targetIndex === null) {
      const checkpoints = await this.listCheckpoints({ cwd });
      if (checkpoints.length === 0) {
        return { restored: false, error: "No Fortify checkpoints found." };
      }
      targetIndex = checkpoints[0].index;
    }

    // First, reset any current changes to avoid conflicts
    await this.#runGit(["checkout", "--", "."], { cwd });
    // Clean untracked files that might conflict
    await this.#runGit(["clean", "-fd"], { cwd });

    const result = await this.#runGit(["stash", "pop", `stash@{${targetIndex}}`], { cwd });

    if (!result.ok) {
      return {
        restored: false,
        error: `Failed to restore checkpoint: ${result.stderr.trim() || "unknown error"}`,
      };
    }

    return {
      restored: true,
      message: `Restored checkpoint at stash@{${targetIndex}}.`,
    };
  }

  /**
   * Drop (discard) a checkpoint without restoring it.
   *
   * @param {object} [options]
   * @param {string} [options.cwd] - Working directory
   * @param {number} [options.index] - Stash index to drop
   * @returns {Promise<{ dropped: boolean, error?: string }>}
   */
  async dropCheckpoint({ cwd = this.cwd, index } = {}) {
    const isRepo = await this.gitService.isGitRepository({ cwd });
    if (!isRepo) {
      return { dropped: false, error: "Not a git repository." };
    }

    if (index === undefined || index === null) {
      const checkpoints = await this.listCheckpoints({ cwd });
      if (checkpoints.length === 0) {
        return { dropped: false, error: "No Fortify checkpoints found." };
      }
      index = checkpoints[0].index;
    }

    const result = await this.#runGit(["stash", "drop", `stash@{${index}}`], { cwd });

    if (!result.ok) {
      return {
        dropped: false,
        error: `Failed to drop checkpoint: ${result.stderr.trim() || "unknown error"}`,
      };
    }

    return { dropped: true };
  }

  /**
   * Check if there are any uncommitted changes (staged, unstaged, or untracked).
   *
   * @param {object} [options]
   * @param {string} [options.cwd] - Working directory
   * @returns {Promise<boolean>}
   */
  async hasUncommittedChanges({ cwd = this.cwd } = {}) {
    const isRepo = await this.gitService.isGitRepository({ cwd });
    if (!isRepo) {
      return false;
    }

    const result = await this.#runGit(["status", "--porcelain"], { cwd });
    if (!result.ok) {
      return false;
    }

    return result.stdout.trim().length > 0;
  }

  /**
   * Get the full diff of all uncommitted changes (staged + unstaged).
   *
   * @param {object} [options]
   * @param {string} [options.cwd] - Working directory
   * @returns {Promise<string>} Combined diff output
   */
  async getCurrentDiff({ cwd = this.cwd } = {}) {
    const isRepo = await this.gitService.isGitRepository({ cwd });
    if (!isRepo) {
      return "";
    }

    // Get unstaged changes
    const unstaged = await this.#runGit(["diff"], { cwd });
    // Get staged changes
    const staged = await this.#runGit(["diff", "--cached"], { cwd });

    const parts = [];
    if (unstaged.ok && unstaged.stdout.trim()) {
      parts.push(unstaged.stdout.trim());
    }
    if (staged.ok && staged.stdout.trim()) {
      parts.push(staged.stdout.trim());
    }

    return parts.join("\n");
  }

  /**
   * Get a compact diff summary (like `git diff --stat`).
   *
   * @param {object} [options]
   * @param {string} [options.cwd] - Working directory
   * @returns {Promise<string>} Diff stat output
   */
  async getDiffSummary({ cwd = this.cwd } = {}) {
    const isRepo = await this.gitService.isGitRepository({ cwd });
    if (!isRepo) {
      return "";
    }

    const unstaged = await this.#runGit(["diff", "--stat"], { cwd });
    const staged = await this.#runGit(["diff", "--cached", "--stat"], { cwd });

    const parts = [];
    if (unstaged.ok && unstaged.stdout.trim()) {
      parts.push(unstaged.stdout.trim());
    }
    if (staged.ok && staged.stdout.trim()) {
      if (parts.length > 0) {
        parts.push("--- Staged ---");
      }
      parts.push(staged.stdout.trim());
    }

    return parts.join("\n");
  }

  /**
   * Get per-file diff output for rendering individual diff cards.
   *
   * @param {object} [options]
   * @param {string} [options.cwd] - Working directory
   * @param {string} [options.filePath] - Specific file to diff (optional)
   * @returns {Promise<Array<{ file: string, diff: string, additions: number, deletions: number }>>}
   */
  async getPerFileDiffs({ cwd = this.cwd, filePath } = {}) {
    const isRepo = await this.gitService.isGitRepository({ cwd });
    if (!isRepo) {
      return [];
    }

    const diffArgs = filePath
      ? ["diff", "HEAD", "--", filePath]
      : ["diff", "HEAD"];

    const result = await this.#runGit(diffArgs, { cwd });
    if (!result.ok || !result.stdout.trim()) {
      // Also try without HEAD for repos with no commits
      const altResult = await this.#runGit(
        filePath ? ["diff", "--", filePath] : ["diff"],
        { cwd }
      );
      if (!altResult.ok || !altResult.stdout.trim()) {
        return [];
      }
      return this.#parseDiffOutput(altResult.stdout);
    }

    return this.#parseDiffOutput(result.stdout);
  }

  /**
   * Parse unified diff output into per-file chunks.
   *
   * @param {string} diffOutput - Raw `git diff` output
   * @returns {Array<{ file: string, diff: string, additions: number, deletions: number }>}
   */
  #parseDiffOutput(diffOutput) {
    if (!diffOutput || !diffOutput.trim()) return [];

    const files = [];
    // Split on "diff --git" boundaries
    const chunks = diffOutput.split(/(?=^diff --git )/gm).filter(Boolean);

    for (const chunk of chunks) {
      // Extract filename from "diff --git a/path b/path"
      const fileMatch = chunk.match(/^diff --git a\/(.+?) b\/(.+)/m);
      if (!fileMatch) continue;

      const file = fileMatch[2];
      let additions = 0;
      let deletions = 0;

      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }

      files.push({ file, diff: chunk, additions, deletions });
    }

    return files;
  }

  /**
   * Format a timestamp for checkpoint names.
   *
   * @param {Date} date
   * @returns {string} ISO-like timestamp safe for stash messages
   */
  #formatTimestamp(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  }

  /**
   * Run a raw git command via the underlying commandRunner or spawn.
   *
   * @param {string[]} args - git arguments
   * @param {object} options
   * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, exitCode: number }>}
   */
  async #runGit(args, { cwd } = {}) {
    // Use GitService's commandRunner if available, otherwise delegate
    if (this.gitService.commandRunner) {
      return this.gitService.commandRunner(args, { cwd });
    }

    // Direct spawn for operations GitService doesn't expose
    const { spawn } = await import("node:child_process");

    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });

      child.on("error", (error) => {
        resolve({ ok: false, stdout: "", stderr: error.message, exitCode: 1 });
      });

      child.on("close", (exitCode) => {
        resolve({ ok: exitCode === 0, stdout, stderr, exitCode: exitCode ?? 1 });
      });
    });
  }
}

/**
 * Create a GitCheckpointService instance.
 * @param {object} [options]
 * @returns {GitCheckpointService}
 */
export function createGitCheckpointService(options) {
  return new GitCheckpointService(options);
}

export { CHECKPOINT_PREFIX, DEFAULT_LABEL };
