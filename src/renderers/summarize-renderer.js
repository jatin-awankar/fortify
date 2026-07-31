import ora from "ora";
import { createTerminalUI } from "./terminal-ui.js";
import { MarkdownTerminalRenderer } from "./markdown-terminal-renderer.js";

export class SummarizeRenderer {
  constructor({
    terminalUI = createTerminalUI(),
    markdownRenderer = new MarkdownTerminalRenderer({ terminalUI }),
    oraFactory = ora
  } = {}) {
    this.terminalUI = terminalUI;
    this.markdownRenderer = markdownRenderer;
    this.oraFactory = oraFactory;
    this.spinner = null;
  }

  showStart({ sourcePath }) {
    this.terminalUI.divider("Project Summarizer");
    this.terminalUI.info(`Target: ${sourcePath}`);
    if (this.terminalUI.capabilities && this.terminalUI.capabilities.isInteractive) {
      try {
        this.spinner = this.oraFactory({
          text: "Scanning workspace files...",
          color: "cyan"
        }).start();
      } catch {
        this.spinner = null;
      }
    }
  }

  showDiscovery({ fileCount }) {
    if (this.spinner) {
      this.spinner.succeed(`Discovered ${fileCount} text/code files.`);
      this.spinner = null;
    } else {
      this.terminalUI.info(`Discovered ${fileCount} text/code files.`);
    }
  }

  showNoFilesFound() {
    if (this.spinner) {
      this.spinner.fail("No supported text/code files found at the target path.");
      this.spinner = null;
    } else {
      this.terminalUI.warning("No supported text/code files found at the target path.");
    }
  }

  showTokenGuardNotice(message) {
    this.terminalUI.warning(message);
  }

  showChunkProgress({ filePath, chunkIndex, totalChunks }) {
    this.terminalUI.info(`Summarizing ${filePath} (${chunkIndex + 1}/${totalChunks})`);
  }

  showFinalStart() {
    this.terminalUI.divider();
    this.terminalUI.info("Generating final project summary...");
    this.terminalUI.stdout.write(`${this.terminalUI.chalk.bold.green("Summary:")} `);
  }

  async renderFinalSummaryStream(stream, { signal } = {}) {
    const outputText = await this.markdownRenderer.renderMarkdownStream(stream, {
      signal,
      handleCtrlC: false,
      ensureTrailingNewline: true
    });
    return outputText.trim();
  }

  showError(message) {
    if (this.spinner) {
      this.spinner.fail(message);
      this.spinner = null;
    } else {
      this.terminalUI.error(message);
    }
  }

  showDone() {
    this.terminalUI.divider();
    this.terminalUI.success("Project summary completed.");
  }
}
