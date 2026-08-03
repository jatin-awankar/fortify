import { StreamRenderCancelledError } from "./streaming-terminal-renderer.js";
import { highlightCodeLine } from "./code-highlighter.js";

function chunkToText(chunk) {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (!chunk || typeof chunk !== "object") {
    return "";
  }

  if (chunk.type === "text_done" || chunk.type === "response.output_text.done") {
    return "";
  }

  if (typeof chunk.delta === "string") {
    return chunk.delta;
  }

  if (typeof chunk.token === "string") {
    return chunk.token;
  }

  if (typeof chunk.text === "string") {
    return chunk.text;
  }

  if (typeof chunk.content === "string") {
    return chunk.content;
  }

  return "";
}

export class MarkdownTerminalRenderer {
  #pending = "";
  #lastChar = "\n";
  #inCodeBlock = false;
  #codeLanguage = "";
  #isRendering = false;
  #abortController = null;
  #sigintHandler = null;
  #activeAbortSignal = null;
  #activeAbortListener = null;
  #activeIterator = null;

  constructor({ terminalUI, stdout = process.stdout, signalProcess = process } = {}) {
    this.terminalUI = terminalUI;
    this.stdout = stdout;
    this.signalProcess = signalProcess;
  }

  async renderMarkdown(text, { ensureTrailingNewline = true } = {}) {
    const safeText = typeof text === "string" ? text : String(text ?? "");
    this.#resetRenderState();
    this.#consumeToken(safeText);
    this.#flushPending({ force: true });
    this.#ensureTrailingNewline(ensureTrailingNewline);
    return safeText;
  }

  async renderMarkdownStream(
    stream,
    { signal, handleCtrlC = true, ensureTrailingNewline = true } = {}
  ) {
    if (!stream || typeof stream[Symbol.asyncIterator] !== "function") {
      throw new TypeError("`stream` must be an async iterable.");
    }

    if (this.#isRendering) {
      throw new Error("Markdown renderer is already processing a stream.");
    }

    this.#isRendering = true;
    this.#abortController = new AbortController();
    this.#resetRenderState();

    let rawOutput = "";

    try {
      if (signal?.aborted) {
        throw signal.reason ?? new StreamRenderCancelledError("Stream aborted before rendering.");
      }

      this.#bindExternalSignal(signal);

      if (handleCtrlC) {
        this.#bindSigintCancellation();
      }

      const iterator = stream[Symbol.asyncIterator]();
      this.#activeIterator = iterator;
      const abortPromise = this.#waitForAbort(this.#abortController.signal);

      while (true) {
        const step = await Promise.race([iterator.next(), abortPromise]);
        if (step.done) {
          break;
        }

        const token = chunkToText(step.value);
        if (!token) {
          continue;
        }

        rawOutput += token;
        this.#consumeToken(token);
      }

      this.#flushPending({ force: true });
      this.#ensureTrailingNewline(ensureTrailingNewline);
      return rawOutput;
    } catch (error) {
      this.#flushPending({ force: true });
      this.#ensureTrailingNewline(ensureTrailingNewline);

      if (this.#isCancellationError(error)) {
        throw error instanceof Error ? error : new StreamRenderCancelledError(String(error));
      }

      throw error instanceof Error ? error : new Error("Markdown streaming failed.");
    } finally {
      await this.#cleanup();
    }
  }

  #consumeToken(token) {
    this.#pending += token;
    this.#flushPending({ force: false });
  }

  #flushPending({ force }) {
    while (true) {
      const newlineIndex = this.#pending.indexOf("\n");
      if (newlineIndex < 0) {
        break;
      }

      const line = this.#pending.slice(0, newlineIndex);
      this.#pending = this.#pending.slice(newlineIndex + 1);
      this.#renderLine(line, true);
    }

    if (force && this.#pending.length > 0) {
      const tail = this.#pending;
      this.#pending = "";
      this.#renderLine(tail, false);
    }
  }

  #renderLine(line, withNewline) {
    const normalizedLine = line.replace(/\r$/, "");
    const trimmed = normalizedLine.trim();

    if (!trimmed) {
      this.#write(withNewline ? "\n" : "");
      return;
    }

    const fenceMatch = trimmed.match(/^```([a-zA-Z0-9_-]+)?\s*$/);

    if (fenceMatch) {
      if (!this.#inCodeBlock) {
        this.#inCodeBlock = true;
        this.#codeLanguage = fenceMatch[1] ?? "";
        const label = this.#codeLanguage ? ` code:${this.#codeLanguage} ` : " code ";
        this.#write(this.terminalUI?.chalk?.dim(`+${"-".repeat(6)}${label}${"-".repeat(6)}`) ?? "");
        if (withNewline) {
          this.#write("\n");
        }
      } else {
        this.#inCodeBlock = false;
        this.#codeLanguage = "";
        this.#write(this.terminalUI?.chalk?.dim(`+${"-".repeat(20)}`) ?? "");
        if (withNewline) {
          this.#write("\n");
        }
      }
      return;
    }

    if (this.#inCodeBlock) {
      const highlighted = highlightCodeLine(normalizedLine, {
        language: this.#codeLanguage,
        chalk: this.terminalUI?.chalk
      });
      this.#write(`${highlighted}${withNewline ? "\n" : ""}`);
      return;
    }

    // ── Horizontal rule (---, ***, ___) ──
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(trimmed)) {
      const hrChar = "─";
      const hrWidth = 40;
      const hrLine = this.terminalUI?.chalk?.dim(hrChar.repeat(hrWidth)) ?? hrChar.repeat(hrWidth);
      this.#write(`${hrLine}${withNewline ? "\n" : ""}`);
      return;
    }

    // ── Blockquote (> text) ──
    const blockquoteMatch = normalizedLine.match(/^\s*>\s?(.*)$/);
    if (blockquoteMatch) {
      const quoteContent = this.#formatInlineMarkdown(blockquoteMatch[1] || "");
      const border = this.terminalUI?.chalk?.dim("│") ?? "│";
      const formatted = quoteContent
        ? `  ${border} ${this.terminalUI?.chalk?.italic(quoteContent) ?? quoteContent}`
        : `  ${border}`;
      this.#write(`${formatted}${withNewline ? "\n" : ""}`);
      return;
    }

    // ── Task list (- [x] or - [ ]) ──
    const taskListMatch = normalizedLine.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+(.+)$/);
    if (taskListMatch) {
      const indent = (taskListMatch[1] ?? "").replace(/\t/g, "  ");
      const isChecked = taskListMatch[3].toLowerCase() === "x";
      const checkbox = isChecked
        ? (this.terminalUI?.chalk?.green("✓") ?? "✓")
        : (this.terminalUI?.chalk?.dim("○") ?? "○");
      const content = this.#formatInlineMarkdown(taskListMatch[4]);
      const styledContent = isChecked
        ? (this.terminalUI?.chalk?.dim(content) ?? content)
        : content;
      this.#write(`${indent}${checkbox} ${styledContent}${withNewline ? "\n" : ""}`);
      return;
    }

    const headingMatch = normalizedLine.match(/^\s*(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = this.#formatInlineMarkdown(headingMatch[2]);
      const headingPrefix = "#".repeat(level);
      const colorFn = level <= 2 ? this.terminalUI?.chalk?.blueBright : this.terminalUI?.chalk?.cyan;
      const formatted = colorFn ? colorFn(`${headingPrefix} ${headingText}`) : `${headingPrefix} ${headingText}`;
      this.#write(`${this.terminalUI?.chalk?.bold(formatted) ?? formatted}${withNewline ? "\n" : ""}`);
      return;
    }

    // ── Table separator line (|---|---|) ──
    if (/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(trimmed)) {
      // Table separator — render as dim line
      const dimLine = this.terminalUI?.chalk?.dim(trimmed) ?? trimmed;
      this.#write(`${dimLine}${withNewline ? "\n" : ""}`);
      return;
    }

    // ── Table row (| cell | cell |) ──
    const tableMatch = trimmed.match(/^\|(.+)\|$/);
    if (tableMatch) {
      const cells = tableMatch[1].split("|").map((c) => c.trim());
      const formatted = cells.map((cell) => this.#formatInlineMarkdown(cell));
      const row = `│ ${formatted.join(" │ ")} │`;
      this.#write(`${row}${withNewline ? "\n" : ""}`);
      return;
    }

    const listMatch = normalizedLine.match(/^([ \t]*)([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const indent = (listMatch[1] ?? "").replace(/\t/g, "  ");
      const bullet = listMatch[2];
      const content = this.#formatInlineMarkdown(listMatch[3]);
      const bulletText = this.terminalUI?.chalk?.yellow(bullet) ?? bullet;
      this.#write(`${indent}${bulletText} ${content}${withNewline ? "\n" : ""}`);
      return;
    }

    const inlineFormatted = this.#formatInlineMarkdown(normalizedLine);
    this.#write(`${inlineFormatted}${withNewline ? "\n" : ""}`);
  }

  #formatInlineMarkdown(line) {
    if (!line) {
      return "";
    }

    let result = line.replace(/(?<!\\)`([^`\n]+)`/g, (_match, inlineCode) => {
      if (this.terminalUI?.chalk && this.terminalUI?.capabilities?.shouldUseColor) {
        return this.terminalUI.chalk.bgBlackBright.white(` ${inlineCode} `);
      }

      return `\`${inlineCode}\``;
    });

    if (this.terminalUI?.chalk && this.terminalUI?.capabilities?.shouldUseColor) {
      result = result.replace(/\*\*([^*]+)\*\*/g, (_m, boldText) => this.terminalUI.chalk.bold(boldText));
      result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_m, italicText) => this.terminalUI.chalk.italic(italicText));
      result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => `${this.terminalUI.chalk.underline.cyan(text)} (${this.terminalUI.chalk.dim(url)})`);
    }

    return result;
  }

  #write(text) {
    if (!text) {
      return;
    }

    this.stdout.write(text);
    this.#lastChar = text.at(-1) ?? this.#lastChar;
  }

  #ensureTrailingNewline(ensureTrailingNewline) {
    if (!ensureTrailingNewline) {
      return;
    }

    if (this.#lastChar !== "\n") {
      this.stdout.write("\n");
      this.#lastChar = "\n";
    }
  }

  #bindSigintCancellation() {
    this.#sigintHandler = () => {
      if (this.#abortController && !this.#abortController.signal.aborted) {
        this.#abortController.abort(new StreamRenderCancelledError("Cancelled by Ctrl+C."));
      }
    };
    this.signalProcess.on("SIGINT", this.#sigintHandler);
  }

  #bindExternalSignal(signal) {
    if (!signal) {
      return;
    }

    this.#activeAbortSignal = signal;
    this.#activeAbortListener = () => {
      const reason = signal.reason ?? new StreamRenderCancelledError("Stream aborted.");
      if (this.#abortController && !this.#abortController.signal.aborted) {
        this.#abortController.abort(reason);
      }
    };

    signal.addEventListener("abort", this.#activeAbortListener, { once: true });
  }

  #waitForAbort(signal) {
    return new Promise((_, reject) => {
      if (signal.aborted) {
        reject(signal.reason ?? new StreamRenderCancelledError("Stream aborted."));
        return;
      }

      signal.addEventListener(
        "abort",
        () => reject(signal.reason ?? new StreamRenderCancelledError("Stream aborted.")),
        { once: true }
      );
    });
  }

  #isCancellationError(error) {
    if (error instanceof StreamRenderCancelledError) {
      return true;
    }

    if (error?.name === "AbortError" || error?.code === "STREAM_RENDER_CANCELLED") {
      return true;
    }

    return false;
  }

  #resetRenderState() {
    this.#pending = "";
    this.#lastChar = "\n";
    this.#inCodeBlock = false;
    this.#codeLanguage = "";
  }

  async #cleanup() {
    if (this.#activeAbortSignal && this.#activeAbortListener) {
      this.#activeAbortSignal.removeEventListener("abort", this.#activeAbortListener);
    }

    if (this.#sigintHandler) {
      this.signalProcess.off("SIGINT", this.#sigintHandler);
    }

    if (this.#activeIterator && typeof this.#activeIterator.return === "function") {
      try {
        await this.#activeIterator.return();
      } catch {
        // Best-effort iterator cleanup.
      }
    }

    this.#activeAbortSignal = null;
    this.#activeAbortListener = null;
    this.#sigintHandler = null;
    this.#activeIterator = null;
    this.#abortController = null;
    this.#isRendering = false;
    this.#resetRenderState();
  }
}

export function createMarkdownTerminalRenderer(options) {
  return new MarkdownTerminalRenderer(options);
}
