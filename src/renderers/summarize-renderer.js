import { NativeSpinner } from "./native-spinner.js";
import { createTerminalUI } from "./terminal-ui.js";
import { MarkdownTerminalRenderer } from "./markdown-terminal-renderer.js";

export class SummarizeRenderer {
  constructor({
    terminalUI = createTerminalUI(),
    markdownRenderer = new MarkdownTerminalRenderer({ terminalUI }),
    oraFactory = (opts) => new NativeSpinner(opts)
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
          stdout: this.terminalUI.stdout
        }).start();
      } catch {
        this.spinner = null;
      }
    }
  }

  showDiscovery({ fileCount }) {
    if (this.spinner) {
      this.spinner.text = `Found ${fileCount} files. Starting analysis...`;
    } else {
      this.terminalUI.info(`Found ${fileCount} files to analyze.`);
    }
  }

  showChunkProgress({ filePath, chunkIndex, totalChunks }) {
    const progressMsg = `Processing [${chunkIndex + 1}/${totalChunks}] ${filePath}`;
    if (this.spinner) {
      this.spinner.text = progressMsg;
    }
  }

  showTokenGuardNotice(message) {
    if (this.spinner) {
      this.spinner.warn(message);
      this.spinner = null;
    } else {
      this.terminalUI.warning(message);
    }
  }

  showFinalStart() {
    if (this.spinner) {
      this.spinner.succeed("Workspace analysis complete.");
      this.spinner = null;
    }
    this.terminalUI.divider("Executive Summary");
  }

  async renderFinalSummaryStream(stream, { signal } = {}) {
    return this.markdownRenderer.renderMarkdownStream(stream, {
      signal,
      handleCtrlC: false,
      ensureTrailingNewline: true
    });
  }

  showDone() {
    this.terminalUI.divider();
  }

  showNoFilesFound() {
    if (this.spinner) {
      this.spinner.fail("No text files found to summarize.");
      this.spinner = null;
    } else {
      this.terminalUI.warning("No supported text files found to summarize.");
    }
  }

  showError(message) {
    if (this.spinner) {
      this.spinner.fail(message);
      this.spinner = null;
    } else {
      this.terminalUI.error(message);
    }
  }
}
