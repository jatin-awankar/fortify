import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAgenticSystemPrompt,
  estimateTokens,
  truncateToTokens,
  buildIdentityBlock,
  buildToolGuidelinesBlock,
} from "../src/config/agentic-system-prompt.js";

// ──────────────────────────────────────────────
// Helper utilities
// ──────────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns 0 for empty/null input", () => {
    assert.equal(estimateTokens(""), 0);
    assert.equal(estimateTokens(null), 0);
    assert.equal(estimateTokens(undefined), 0);
  });

  it("estimates ~4 chars per token", () => {
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("abcdefgh"), 2);
    assert.equal(estimateTokens("abc"), 1); // rounds up
  });
});

describe("truncateToTokens", () => {
  it("returns text unchanged when within budget", () => {
    assert.equal(truncateToTokens("short", 100), "short");
  });

  it("returns empty for null/empty input", () => {
    assert.equal(truncateToTokens("", 100), "");
    assert.equal(truncateToTokens(null, 100), "");
  });

  it("returns empty for zero or negative maxTokens", () => {
    assert.equal(truncateToTokens("some text", 0), "");
    assert.equal(truncateToTokens("some text", -5), "");
  });

  it("truncates and adds marker when exceeding budget", () => {
    const longText = "x".repeat(500);
    const result = truncateToTokens(longText, 10); // 10 tokens = 40 chars
    assert.ok(result.length <= 40);
    assert.ok(result.includes("[...truncated]"));
  });

  it("total output does not exceed maxTokens budget", () => {
    const longText = "x".repeat(1000);
    const result = truncateToTokens(longText, 50); // 50 tokens = 200 chars
    const resultTokens = estimateTokens(result);
    assert.ok(resultTokens <= 50, `Result was ${resultTokens} tokens, expected <= 50`);
  });
});

// ──────────────────────────────────────────────
// Building blocks
// ──────────────────────────────────────────────

describe("buildIdentityBlock", () => {
  it("includes Fortify identity", () => {
    const block = buildIdentityBlock();
    assert.ok(block.includes("You are Fortify"));
    assert.ok(block.includes("terminal coding assistant"));
  });

  it("includes core principles", () => {
    const block = buildIdentityBlock();
    assert.ok(block.includes("Read before you write"));
    assert.ok(block.includes("targeted edits"));
    assert.ok(block.includes("Verify your work"));
  });
});

describe("buildToolGuidelinesBlock", () => {
  it("includes agentic mode marker", () => {
    const block = buildToolGuidelinesBlock("tool list here");
    assert.ok(block.includes("[Agentic Mode]"));
  });

  it("includes the tool summary", () => {
    const block = buildToolGuidelinesBlock("- read_file\n- write_file");
    assert.ok(block.includes("read_file"));
    assert.ok(block.includes("write_file"));
  });

  it("includes file operations and command execution sections", () => {
    const block = buildToolGuidelinesBlock("");
    assert.ok(block.includes("File Operations"));
    assert.ok(block.includes("Command Execution"));
    assert.ok(block.includes("30-second timeout"));
  });
});

// ──────────────────────────────────────────────
// buildAgenticSystemPrompt — core tests
// ──────────────────────────────────────────────

describe("buildAgenticSystemPrompt", () => {
  const basePrompt = "[Project Context]\nName: my-app\nStack: Node.js";
  const toolSummary = [
    "Available tools:",
    "  - read_file(path*): Read the contents of a file from the workspace",
    "  - write_file(path*, content*): Create or overwrite a file in the workspace [requires permission]",
    "  - execute_command(command*, cwd): Run a shell command in the workspace [requires permission]",
  ].join("\n");

  it("includes the base prompt", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(result.includes("[Project Context]"));
    assert.ok(result.includes("my-app"));
  });

  it("includes identity block", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(result.includes("You are Fortify"));
  });

  it("includes the agentic mode marker", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(result.includes("[Agentic Mode]"));
  });

  it("includes the tool summary", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(result.includes("Available tools:"));
    assert.ok(result.includes("read_file"));
    assert.ok(result.includes("write_file"));
    assert.ok(result.includes("execute_command"));
  });

  it("includes tool-use guidelines", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(result.includes("Read before you write"));
    assert.ok(result.includes("targeted edits"));
    assert.ok(result.includes("Verify your work"));
  });

  it("includes the working directory when provided", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary, cwd: "/home/user/project" });
    assert.ok(result.includes("Working Directory: /home/user/project"));
  });

  it("omits working directory when cwd is not provided", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(!result.includes("Working Directory:"));
  });

  it("includes file operation descriptions", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(result.includes("File Operations"));
    assert.ok(result.includes("Command Execution"));
  });

  it("includes command execution safety notes", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(result.includes("30-second timeout"));
    assert.ok(result.includes("user permission"));
    assert.ok(result.includes("Dangerous commands"));
  });

  it("includes response format section", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(result.includes("[Response Format]"));
    assert.ok(result.includes("clean markdown"));
  });

  // ── New context sections ──

  it("includes memory section when provided", () => {
    const result = buildAgenticSystemPrompt({
      basePrompt,
      toolSummary,
      memory: "Always use const. Prefer arrow functions.",
    });
    assert.ok(result.includes("[Project Memory]"));
    assert.ok(result.includes("Always use const"));
  });

  it("includes repo map when provided", () => {
    const result = buildAgenticSystemPrompt({
      basePrompt,
      toolSummary,
      repoMap: "[Repository Map] (10 files)\nsrc/\n  index.js",
    });
    assert.ok(result.includes("[Repository Map]"));
    assert.ok(result.includes("src/"));
  });

  it("includes custom rules when provided", () => {
    const result = buildAgenticSystemPrompt({
      basePrompt,
      toolSummary,
      customRules: "Never use var. Always add JSDoc.",
    });
    assert.ok(result.includes("[Custom Rules]"));
    assert.ok(result.includes("Never use var"));
  });

  it("omits memory section when not provided", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(!result.includes("[Project Memory]"));
  });

  it("omits memory section when empty/whitespace", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary, memory: "   " });
    assert.ok(!result.includes("[Project Memory]"));
  });

  it("omits custom rules when not provided", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(!result.includes("[Custom Rules]"));
  });

  // ── Priority ordering ──

  it("places memory before repo-map in output (higher priority = earlier)", () => {
    const result = buildAgenticSystemPrompt({
      basePrompt,
      toolSummary,
      memory: "Use TypeScript strict mode",
      repoMap: "[Repository Map] (5 files)\nsrc/index.ts",
    });
    const memoryPos = result.indexOf("[Project Memory]");
    const repoMapPos = result.indexOf("[Repository Map]");
    assert.ok(memoryPos < repoMapPos, "Memory should appear before repo-map in the prompt");
  });

  // ── Token budget enforcement ──

  it("truncates repo-map first when over budget", () => {
    const largeRepoMap = "[Repository Map]\n" + "x".repeat(20000);
    const result = buildAgenticSystemPrompt({
      basePrompt,
      toolSummary,
      repoMap: largeRepoMap,
      memory: "Important memory content",
      tokenBudgets: { total: 2000, repoMap: 500 },
    });
    // Memory should be intact
    assert.ok(result.includes("Important memory content"));
    // Repo map should be truncated
    assert.ok(result.includes("[...truncated]"));
  });

  it("handles all sections being empty gracefully", () => {
    const result = buildAgenticSystemPrompt({ basePrompt: "", toolSummary: "" });
    assert.ok(result.includes("You are Fortify"));
    assert.ok(result.includes("[Response Format]"));
  });

  it("handles undefined options object", () => {
    const result = buildAgenticSystemPrompt();
    assert.ok(result.includes("You are Fortify"));
  });

  it("allows custom token budgets via tokenBudgets override", () => {
    const result = buildAgenticSystemPrompt({
      basePrompt,
      toolSummary,
      memory: "Short memory",
      tokenBudgets: { memory: 5 }, // Very small budget
    });
    // Memory should still appear (just may be truncated)
    assert.ok(result.includes("[Project Memory]") || result.includes("Short memory"));
  });
});
