import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ToolUseCard, TOOL_TYPES, CARD_STATUS } from "../src/renderers/tool-use-card.js";
import { stripAnsi } from "../src/renderers/ansi-style.js";

function createMockStdout({ isTTY = false } = {}) {
  const chunks = [];
  return {
    chunks,
    isTTY,
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

describe("ToolUseCard", () => {
  let stdout;
  let card;

  beforeEach(() => {
    stdout = createMockStdout();
    card = new ToolUseCard({ stdout, env: { NO_COLOR: "1" } });
  });

  describe("renderCard", () => {
    it("renders a pending card with icon and title", () => {
      const result = card.renderCard({
        type: "read_file",
        title: "src/index.js",
        status: CARD_STATUS.PENDING,
      });

      assert.ok(result.includes("📄"), "Should include file icon");
      assert.ok(result.includes("src/index.js"), "Should include title");
    });

    it("renders success status with green check", () => {
      const result = card.renderCard({
        type: "read_file",
        title: "src/index.js",
        status: CARD_STATUS.SUCCESS,
      });

      assert.ok(result.includes("✓"), "Should include check mark");
    });

    it("renders error status with red X", () => {
      const result = card.renderCard({
        type: "write_file",
        title: "Failed to write",
        status: CARD_STATUS.ERROR,
      });

      assert.ok(result.includes("✖"), "Should include X mark");
    });

    it("renders running status with spinner frame", () => {
      const result = card.renderCard({
        type: "execute_command",
        title: "npm test",
        status: CARD_STATUS.RUNNING,
      });

      assert.ok(result.includes("⠋"), "Should include spinner frame");
    });

    it("renders skipped status with hollow circle", () => {
      const result = card.renderCard({
        type: "read_file",
        title: "skipped.js",
        status: CARD_STATUS.SKIPPED,
      });

      assert.ok(result.includes("○"), "Should include hollow circle");
    });

    it("includes metadata when provided", () => {
      const result = card.renderCard({
        type: "read_file",
        title: "src/index.js",
        metadata: "387 lines",
        status: CARD_STATUS.SUCCESS,
      });

      assert.ok(result.includes("387 lines"), "Should include metadata");
    });

    it("includes duration when provided", () => {
      const result = card.renderCard({
        type: "read_file",
        title: "src/index.js",
        status: CARD_STATUS.SUCCESS,
        duration: "1.2s",
      });

      assert.ok(result.includes("1.2s"), "Should include duration");
    });

    it("includes step badge when provided", () => {
      const result = card.renderCard({
        type: "read_file",
        title: "src/index.js",
        status: CARD_STATUS.SUCCESS,
        stepCurrent: 2,
        stepTotal: 5,
      });

      assert.ok(result.includes("[2/5]"), "Should include step badge");
    });

    it("applies indentation", () => {
      const result = card.renderCard({
        type: "read_file",
        title: "test",
        indent: 3,
      });

      const stripped = stripAnsi(result);
      assert.ok(stripped.startsWith("      "), "Should have 6-space indent (3 * 2)");
    });

    it("returns empty string when stdout is null", () => {
      const nullCard = new ToolUseCard({ stdout: null });
      const result = nullCard.renderCard({ type: "read_file", title: "test" });
      assert.equal(result, "");
    });
  });

  describe("startCard", () => {
    it("renders initial running state", () => {
      const controller = card.startCard({
        type: "read_file",
        title: "src/index.js",
      });

      assert.ok(stdout.output.includes("Reading"), "Should show verb from TOOL_TYPES");
      assert.ok(stdout.output.includes("src/index.js"), "Should include title");

      controller.succeed();
    });

    it("succeed() replaces running card with success", () => {
      const controller = card.startCard({
        type: "read_file",
        title: "src/index.js",
      });

      stdout.clear();
      controller.succeed("Read src/index.js", "387 lines");

      assert.ok(stdout.output.includes("✓"), "Should include check mark");
      assert.ok(stdout.output.includes("387 lines"), "Should include metadata");
    });

    it("fail() replaces running card with error", () => {
      const controller = card.startCard({
        type: "read_file",
        title: "missing.js",
      });

      stdout.clear();
      controller.fail("ENOENT: file not found");

      assert.ok(stdout.output.includes("✖"), "Should include X mark");
      assert.ok(stdout.output.includes("ENOENT"), "Should include error message");
    });

    it("skip() replaces running card with skipped state", () => {
      const controller = card.startCard({
        type: "write_file",
        title: "config.js",
      });

      stdout.clear();
      controller.skip();

      assert.ok(stdout.output.includes("○"), "Should include hollow circle");
      assert.ok(stdout.output.includes("Skipped"), "Should include skip label");
    });

    it("tracks elapsed time", () => {
      const controller = card.startCard({
        type: "read_file",
        title: "test.js",
      });

      const elapsed = controller.elapsed();
      assert.ok(typeof elapsed === "string", "elapsed() should return a string");

      controller.succeed();
    });
  });

  describe("renderStepHeader", () => {
    it("renders step progress with badge and title", () => {
      const result = card.renderStepHeader(1, 3, "Analyzing workspace");

      assert.ok(result.includes("[1/3]"), "Should include step badge");
      assert.ok(result.includes("Analyzing workspace"), "Should include title");
    });
  });

  describe("renderCommandCard", () => {
    it("renders a command with status and cwd", () => {
      const result = card.renderCommandCard("npm test", {
        cwd: "./src",
        status: CARD_STATUS.RUNNING,
      });

      assert.ok(result.includes("`npm test`"), "Should include command");
      assert.ok(result.includes("in ./src"), "Should include cwd");
      assert.ok(result.includes("Run"), "Should include Run label");
    });

    it("renders success status for completed commands", () => {
      const result = card.renderCommandCard("git status", {
        status: CARD_STATUS.SUCCESS,
      });

      assert.ok(result.includes("✓"), "Should include check mark");
    });
  });

  describe("renderContent", () => {
    it("renders content lines with indentation", () => {
      const result = card.renderContent(["line 1", "line 2", "line 3"]);

      assert.ok(result.includes("line 1"), "Should include content");
      assert.ok(result.includes("line 2"));
      assert.ok(result.includes("line 3"));
    });

    it("collapses content exceeding threshold", () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
      const result = card.renderContent(lines);

      assert.ok(result.includes("more lines"), "Should show collapse indicator");
      // Should NOT contain all 20 lines
      assert.ok(!result.includes("line 20"), "Should not show last line when collapsed");
    });

    it("expands all content when forceExpand is true", () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
      const result = card.renderContent(lines, { forceExpand: true });

      assert.ok(result.includes("line 20"), "Should show all lines when force-expanded");
      assert.ok(!result.includes("more lines"), "Should not show collapse indicator");
    });

    it("returns empty string for empty content", () => {
      const result = card.renderContent([]);
      assert.equal(result, "");
    });
  });
});

describe("TOOL_TYPES", () => {
  it("defines all expected tool types", () => {
    assert.ok(TOOL_TYPES.read_file);
    assert.ok(TOOL_TYPES.write_file);
    assert.ok(TOOL_TYPES.edit_file);
    assert.ok(TOOL_TYPES.execute_command);
    assert.ok(TOOL_TYPES.search_files);
    assert.ok(TOOL_TYPES.thinking);
    assert.ok(TOOL_TYPES.custom);
  });

  it("each type has name, icon, and verb", () => {
    for (const [key, meta] of Object.entries(TOOL_TYPES)) {
      assert.ok(meta.name, `${key} should have name`);
      assert.ok(meta.icon, `${key} should have icon`);
      assert.ok(meta.verb, `${key} should have verb`);
    }
  });
});

describe("CARD_STATUS", () => {
  it("defines all expected statuses", () => {
    assert.equal(CARD_STATUS.PENDING, "pending");
    assert.equal(CARD_STATUS.RUNNING, "running");
    assert.equal(CARD_STATUS.SUCCESS, "success");
    assert.equal(CARD_STATUS.ERROR, "error");
    assert.equal(CARD_STATUS.SKIPPED, "skipped");
  });
});
