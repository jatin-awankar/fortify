import { appMetadata } from "../config/app-metadata.js";
import { createTerminalUI } from "./terminal-ui.js";
import { StreamRenderCancelledError } from "./streaming-terminal-renderer.js";
import { MarkdownTerminalRenderer } from "./markdown-terminal-renderer.js";

export class ChatSessionRenderer {
  constructor({
    terminalUI = createTerminalUI(),
    markdownRenderer = new MarkdownTerminalRenderer({ terminalUI })
  } = {}) {
    this.terminalUI = terminalUI;
    this.markdownRenderer = markdownRenderer;
  }

  showSessionStart({ mode, sessionId }) {
    const banner = `
  ███████╗██████╗ ████████╗███████╗██╗   ██╗
  ██╔════╝██╔═══██╗  ██╔═══╝██╔════╝╚██╗ ██╔╝
  █████╗  ██║   ██║  ██║    █████╗   ╚████╔╝ 
  ██╔══╝  ██║   ██║  ██║    ██╔══╝    ╚██╔╝  
  ██║     ╚██████╔╝  ██║    ██║        ██║   
  ╚═╝      ╚═════╝   ╚═╝    ╚═╝        ╚═╝   `;
    if (this.terminalUI.capabilities.shouldUseColor) {
      this.terminalUI.stdout.write(`${this.terminalUI.chalk.cyan(banner)}\n`);
    }
    this.terminalUI.divider(`${appMetadata.displayName} v${appMetadata.version} Chat`);
    this.terminalUI.info(`Mode: ${mode} | Session: ${sessionId}`);
    this.terminalUI.info("Type /exit to leave chat, or @filename to attach workspace files.");
    this.terminalUI.divider();
  }

  showSessionEnd() {
    this.terminalUI.divider();
    this.terminalUI.info("Chat session ended.");
  }

  showUserPrompt() {
    return this.terminalUI.chalk.bold.cyan("You > ");
  }

  showUserMessage(message) {
    const formattedMessage = message.trim();
    this.terminalUI.stdout.write(`${this.terminalUI.chalk.bold.cyan("You:")} ${formattedMessage}\n`);
  }

  async renderAssistantStream(stream, { signal } = {}) {
    this.terminalUI.stdout.write(this.terminalUI.chalk.bold.green("Assistant: "));

    try {
      const assistantText = await this.markdownRenderer.renderMarkdownStream(stream, {
        signal,
        handleCtrlC: false,
        ensureTrailingNewline: true
      });

      return assistantText.trimEnd();
    } catch (error) {
      if (error instanceof StreamRenderCancelledError) {
        this.terminalUI.warning("Generation cancelled.");
        return "";
      }

      throw error;
    }
  }

  showModelFallback({ fromModel, toModel }) {
    this.terminalUI.warning(
      `Model limit reached for ${fromModel}. Retrying with ${toModel}.`,
    );
  }

  showWarning(message) {
    this.terminalUI.warning(message);
  }

  showError(errorMessage) {
    this.terminalUI.error(errorMessage);
  }
}
