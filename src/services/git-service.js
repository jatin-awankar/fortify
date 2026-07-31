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

    const messageParts = normalizedMessage
      .split(/\n\s*\n/g)
      .map((part) => part.trim())
      .filter(Boolean);

    const gitArgs = ["commit"];
    for (const messagePart of messageParts) {
      gitArgs.push("-m", messagePart);
    }

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
