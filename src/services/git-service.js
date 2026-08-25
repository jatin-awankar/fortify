import { spawn } from "node:child_process";

const NON_GIT_EXIT_CODE = 128;

export class GitServiceError extends Error {
  constructor(message, { code = "GIT_SERVICE_ERROR", cause } = {}) {
    super(message, { cause });
    this.name = "GitServiceError";
    this.code = code;
  }
}

export class GitBinaryNotFoundError extends GitServiceError {
  constructor(message = "Git is not installed or not available in PATH.", options = {}) {
    super(message, { code: "GIT_BINARY_NOT_FOUND", ...options });
    this.name = "GitBinaryNotFoundError";
  }
}

export class GitService {
  constructor({ cwd = process.cwd(), commandRunner } = {}) {
    this.cwd = cwd;
    this.commandRunner = commandRunner;
  }

  async isGitRepository({ cwd = this.cwd } = {}) {
    const result = await this.#runGitCommand(["rev-parse", "--is-inside-work-tree"], { cwd });

    if (!result.ok && result.exitCode === NON_GIT_EXIT_CODE) {
      return false;
    }

    if (!result.ok) {
      throw new GitServiceError("Failed to detect git repository.", {
        cause: this.#buildCommandError(result)
      });
    }

    return result.stdout.trim() === "true";
  }

  async getCurrentBranchName({ cwd = this.cwd } = {}) {
    const isRepository = await this.isGitRepository({ cwd });
    if (!isRepository) {
      return null;
    }

    const result = await this.#runGitCommand(["branch", "--show-current"], { cwd });
    if (!result.ok) {
      throw new GitServiceError("Failed to read current branch name.", {
        cause: this.#buildCommandError(result)
      });
    }

    const branchName = result.stdout.trim();
    return branchName || null;
  }

  async getStagedDiff({ cwd = this.cwd } = {}) {
    const isRepository = await this.isGitRepository({ cwd });
    if (!isRepository) {
      return "";
    }

    const result = await this.#runGitCommand(["diff", "--cached"], { cwd });
    if (!result.ok) {
      throw new GitServiceError("Failed to read staged git diff.", {
        cause: this.#buildCommandError(result)
      });
    }

    return result.stdout;
  }

  async getStagedDiffSummary({ cwd = this.cwd } = {}) {
    const isRepository = await this.isGitRepository({ cwd });
    if (!isRepository) {
      return "";
    }

    const result = await this.#runGitCommand(["diff", "--cached", "--stat"], { cwd });
    if (!result.ok) {
      throw new GitServiceError("Failed to read staged git diff summary.", {
        cause: this.#buildCommandError(result)
      });
    }

    return result.stdout;
  }

  async getRecentCommits({ count = 3, cwd = this.cwd } = {}) {
    const isRepository = await this.isGitRepository({ cwd });
    if (!isRepository) {
      return [];
    }

    const safeCount = Math.max(1, parseInt(count, 10)) || 3;
    const result = await this.#runGitCommand(
      ["log", "-n", String(safeCount), "--oneline"],
      { cwd }
    );
    if (!result.ok) {
      if (result.exitCode === NON_GIT_EXIT_CODE) {
        return [];
      }
      throw new GitServiceError("Failed to read recent git commits.", {
        cause: this.#buildCommandError(result)
      });
    }

    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async getRemoteUrl({ cwd = this.cwd } = {}) {
    const isRepository = await this.isGitRepository({ cwd });
    if (!isRepository) {
      return null;
    }

    const result = await this.#runGitCommand(["config", "--get", "remote.origin.url"], { cwd });
    if (!result.ok) {
      return null;
    }

    return result.stdout.trim() || null;
  }

  /**
   * Get all tracked files in the repository via `git ls-files`.
   *
   * @param {object} [options]
   * @param {string} [options.cwd] - Working directory
   * @returns {Promise<string[]>} Array of relative file paths (forward slashes)
   */
  async getTrackedFiles({ cwd = this.cwd } = {}) {
    const isRepository = await this.isGitRepository({ cwd });
    if (!isRepository) {
      return [];
    }

    const result = await this.#runGitCommand(["ls-files"], { cwd });
    if (!result.ok) {
      return [];
    }

    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  /**
   * Get file status (modified, added, untracked) via `git status --porcelain`.
   *
   * Returns a map of relative paths → status codes:
   *  - "M"  = modified (staged or unstaged)
   *  - "A"  = added (staged)
   *  - "D"  = deleted
   *  - "?"  = untracked
   *  - "R"  = renamed
   *
   * @param {object} [options]
   * @param {string} [options.cwd] - Working directory
   * @returns {Promise<Map<string, string>>} Map of path → status code
   */
  async getFileStatus({ cwd = this.cwd } = {}) {
    const isRepository = await this.isGitRepository({ cwd });
    if (!isRepository) {
      return new Map();
    }

    const result = await this.#runGitCommand(["status", "--porcelain"], { cwd });
    if (!result.ok) {
      return new Map();
    }

    const statusMap = new Map();
    const lines = result.stdout.split("\n").filter(Boolean);

    for (const line of lines) {
      // Porcelain v1 format: "XY filename" — minimum 4 chars (XY + space + 1 char path)
      if (line.length < 4) continue;

      // X = index status, Y = worktree status
      const indexStatus = line[0];
      const worktreeStatus = line[1];
      let filePath = line.slice(3).trim();

      // Git wraps paths with special characters (spaces, non-ASCII) in double quotes
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.slice(1, -1);
      }

      // Handle renamed files — porcelain v1 uses "old -> new" arrow format
      if (filePath.includes(" -> ")) {
        filePath = filePath.split(" -> ").pop().trim();
      }

      if (!filePath) continue;

      // Determine the most relevant status
      if (indexStatus === "?" || worktreeStatus === "?") {
        statusMap.set(filePath, "?");
      } else if (indexStatus === "A") {
        statusMap.set(filePath, "A");
      } else if (indexStatus === "D" || worktreeStatus === "D") {
        statusMap.set(filePath, "D");
      } else if (indexStatus === "R") {
        statusMap.set(filePath, "R");
      } else if (indexStatus === "M" || worktreeStatus === "M") {
        statusMap.set(filePath, "M");
      } else if (indexStatus !== " " || worktreeStatus !== " ") {
        statusMap.set(filePath, indexStatus !== " " ? indexStatus : worktreeStatus);
      }
    }

    return statusMap;
  }

  async commitWithMessage({ message, cwd = this.cwd } = {}) {
    const normalizedMessage = typeof message === "string" ? message.trim() : "";

    if (!normalizedMessage) {
      throw new GitServiceError("Commit message cannot be empty.", {
        code: "GIT_INVALID_COMMIT_MESSAGE"
      });
    }

    const isRepository = await this.isGitRepository({ cwd });
    if (!isRepository) {
      throw new GitServiceError("Current directory is not a git repository.", {
        code: "GIT_NOT_REPOSITORY"
      });
    }

    const gitArgs = ["commit", "-m", normalizedMessage];

    const result = await this.#runGitCommand(gitArgs, { cwd });
    if (!result.ok) {
      throw new GitServiceError("Failed to execute git commit.", {
        code: "GIT_COMMIT_FAILED",
        cause: this.#buildCommandError(result)
      });
    }

    return {
      output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
    };
  }

  async #runGitCommand(args, { cwd } = {}) {
    if (this.commandRunner) {
      return this.commandRunner(args, { cwd });
    }

    return new Promise((resolve, reject) => {
      const childProcess = spawn("git", args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });

      let stdout = "";
      let stderr = "";

      childProcess.stdout.setEncoding("utf8");
      childProcess.stderr.setEncoding("utf8");

      childProcess.stdout.on("data", (chunk) => {
        stdout += chunk;
      });

      childProcess.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      childProcess.on("error", (error) => {
        if (error?.code === "ENOENT") {
          reject(new GitBinaryNotFoundError(undefined, { cause: error }));
          return;
        }

        reject(
          new GitServiceError("Failed to spawn git command.", {
            cause: error
          })
        );
      });

      childProcess.on("close", (exitCode) => {
        resolve({
          ok: exitCode === 0,
          exitCode: exitCode ?? 1,
          stdout,
          stderr,
          args,
          cwd
        });
      });
    });
  }

  #buildCommandError(result) {
    return new Error(
      `git ${result.args.join(" ")} failed with exit code ${result.exitCode}: ${result.stderr.trim()}`
    );
  }
}
