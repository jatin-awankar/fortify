import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MessageRenderer } from "../src/renderers/message-renderer.js";
import { TerminalUI } from "../src/renderers/terminal-ui.js";
import { stripAnsi } from "../src/renderers/ansi-style.js";

function createMockStdout() {
  const chunks = [];
  return {
    chunks,
    isTTY: true,
    columns: 80,
    write(data) {
      chunks.push(data);
      return true;
    },
    get output() {
      return chunks.join("");
    },
    clear() {
      chunks.length = 0;
    },
  };
}

describe("MessageRenderer", () => {
  let stdout;
  let terminalUI;
  let renderer;

  beforeEach(() => {
    stdout = createMockStdout();
    terminalUI = new TerminalUI({ stdout, env: { NO_COLOR: "1" } });
    renderer = new MessageRenderer({ terminalUI });
  });

  describe("getUserPrompt", () => {
    it("returns a styled prompt string with ❯", () => {
      const prompt = renderer.getUserPrompt();
      assert.ok(prompt.includes("❯"), "Prompt should include ❯ symbol");
    });
  });

  describe("renderUserMessage", () => {
    it("renders a user message with ❯ prefix", () => {
      renderer.renderUserMessage("Hello world");
      const stripped = stripAnsi(stdout.output);
      assert.ok(stripped.includes("❯"), "Should include ❯ prompt");
      assert.ok(stripped.includes("Hello world"), "Should include message text");
    });

    it("renders file attachments when provided", () => {
      renderer.renderUserMessage("Check this file", {
        attachments: [{ path: "src/index.js", size: 2048 }],
      });
      const stripped = stripAnsi(stdout.output);
      assert.ok(stripped.includes("Attached:"), "Should show attachment indicator");
      assert.ok(stripped.includes("src/index.js"), "Should include file path");
      assert.ok(stripped.includes("2.0KB"), "Should show file size");
    });

    it("trims message whitespace", () => {
      renderer.renderUserMessage("  padded message  ");
      const stripped = stripAnsi(stdout.output);
      assert.ok(stripped.includes("padded message"), "Should include trimmed message");
    });
  });

  describe("renderAssistantLabel", () => {
    it("renders 'Assistant' label", () => {
      renderer.renderAssistantLabel();
      const stripped = stripAnsi(stdout.output);
      assert.ok(stripped.includes("Assistant"), "Should show Assistant label");
    });
  });

  describe("thinking indicator", () => {
    it("showThinking starts the indicator", () => {
      const indicator = renderer.showThinking();
      assert.ok(indicator.isActive, "Indicator should be active");
      indicator.stop();
    });

    it("stopThinking stops an active indicator", () => {
      renderer.showThinking();
      renderer.stopThinking();
      assert.ok(!renderer.thinkingIndicator.isActive, "Indicator should be stopped");
    });

    it("stopThinking is safe when no indicator is active", () => {
      // Should not throw
      renderer.stopThinking();
    });
  });

  describe("tool cards", () => {
    it("startToolCard returns a controller", () => {
      const controller = renderer.startToolCard({
        type: "read_file",
        title: "src/index.js",
      });
      assert.ok(typeof controller.succeed === "function");
      assert.ok(typeof controller.fail === "function");
      controller.succeed();
    });

    it("renderToolCard renders a static card", () => {
      const result = renderer.renderToolCard({
        type: "read_file",
        title: "src/index.js",
        status: "success",
      });
      assert.ok(result.includes("src/index.js"));
    });

    it("renderToolContent renders content lines", () => {
      const result = renderer.renderToolContent(["line 1", "line 2"]);
      assert.ok(result.includes("line 1"));
      assert.ok(result.includes("line 2"));
    });

    it("renderStepProgress renders step header", () => {
      const result = renderer.renderStepProgress(1, 3, "Analyzing");
      assert.ok(result.includes("[1/3]"));
      assert.ok(result.includes("Analyzing"));
    });
  });

  describe("status messages", () => {
    it("renderError shows ✖ with message", () => {
      renderer.renderError("Something failed");
      const stripped = stripAnsi(stdout.output);
      assert.ok(stripped.includes("✖"), "Should include ✖");
      assert.ok(stripped.includes("Something failed"));
    });

    it("renderWarning shows ⚠ with message", () => {
      renderer.renderWarning("Watch out");
      const stripped = stripAnsi(stdout.output);
      assert.ok(stripped.includes("⚠"), "Should include ⚠");
      assert.ok(stripped.includes("Watch out"));
    });

    it("renderInfo shows ✓ with message", () => {
      renderer.renderInfo("All good");
      const stripped = stripAnsi(stdout.output);
      assert.ok(stripped.includes("✓"), "Should include ✓");
      assert.ok(stripped.includes("All good"));
    });

    it("renderModelFallback shows warning about model change", () => {
      renderer.renderModelFallback({ fromModel: "gpt-4o", toModel: "gpt-3.5-turbo" });
      const stripped = stripAnsi(stdout.output);
      assert.ok(stripped.includes("gpt-4o"));
      assert.ok(stripped.includes("gpt-3.5-turbo"));
    });
  });

  describe("null stdout handling", () => {
    it("handles null stdout gracefully", () => {
      const nullRenderer = new MessageRenderer({
        terminalUI: new TerminalUI({ stdout: null, env: { NO_COLOR: "1" } }),
      });
      // Should not throw
      nullRenderer.renderUserMessage("test");
      nullRenderer.renderAssistantLabel();
      nullRenderer.renderError("error");
      nullRenderer.renderWarning("warning");
      nullRenderer.renderInfo("info");
    });
  });
});
