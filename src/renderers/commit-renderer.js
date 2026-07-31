import { createInterface } from "node:readline/promises";
import { createTerminalUI } from "./terminal-ui.js";
import { StreamingTerminalRenderer } from "./streaming-terminal-renderer.js";
import { STREAM_RENDERER_EVENTS } from "./stream-events.js";

export class CommitRenderer {
  constructor({
    terminalUI = createTerminalUI(),
    streamRenderer = new StreamingTerminalRenderer()
  } = {}) {
    this.terminalUI = terminalUI;
    this.streamRenderer = streamRenderer;
  }

  showContext({ branchName, style, scope }) {
    this.terminalUI.divider("Commit Message");
    this.terminalUI.info(`Branch: ${branchName ?? "unknown"}`);
    this.terminalUI.info(`Style: ${style}`);
    if (scope) {
      this.terminalUI.info(`Scope: ${scope}`);
    }
    this.terminalUI.divider();
  }

  showNotGitRepository() {
    this.terminalUI.error("Current directory is not a git repository.");
  }

  showNoStagedChanges() {
    this.terminalUI.warning("No staged changes found. Stage files before generating a commit message.");
  }

  showDiffSummary(summary) {
    if (!summary?.trim()) {
      return;
    }

    this.terminalUI.info("Staged diff summary:");
    this.terminalUI.stdout.write(`${this.terminalUI.chalk.dim(summary.trim())}\n`);
    this.terminalUI.divider();
  }

  showGenerating() {
    this.terminalUI.info("Generating commit message from staged diff...");
    this.terminalUI.stdout.write(`${this.terminalUI.chalk.bold.green("Suggested:")} `);
  }

  async renderCommitMessageStream(stream, { signal } = {}) {
    let output = "";

    const handleToken = (token) => {
      output += token;
    };

    this.streamRenderer.on(STREAM_RENDERER_EVENTS.token, handleToken);

    try {
      await this.streamRenderer.renderStream(stream, {
        signal,
        handleCtrlC: false,
        ensureTrailingNewline: true
      });

      return output;
    } finally {
      this.streamRenderer.off(STREAM_RENDERER_EVENTS.token, handleToken);
    }
  }

  showResolvedMessage(message) {
    this.terminalUI.divider();
    this.terminalUI.info("Resolved commit message:");
    this.terminalUI.stdout.write(`${message}\n`);
  }

  showCommitExecuted(message) {
    this.terminalUI.success("Commit created successfully.");
    this.terminalUI.stdout.write(`${this.terminalUI.chalk.dim(message)}\n`);
  }

  showCommitSkipped() {
    this.terminalUI.info("Commit skipped.");
  }

  showDryRunComplete() {
    this.terminalUI.info("Dry run complete. No commit was created.");
  }

  showError(message) {
    this.terminalUI.error(message);
  }

  async askForConfirmation() {
    if (!this.terminalUI.capabilities.isInteractive) {
      return false;
    }

    const readlineInterface = createInterface({
      input: this.terminalUI.stdin,
      output: this.terminalUI.stdout,
      terminal: true
    });

    try {
      const answer = await readlineInterface.question(
        `${this.terminalUI.chalk.bold.cyan("Commit now?")} [y/N] `
      );

      const normalized = answer.trim().toLowerCase();
      return normalized === "y" || normalized === "yes";
    } finally {
      readlineInterface.close();
    }
  }
}
