import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { StatusBar } from "../src/renderers/status-bar.js";

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
    }
  };
}

describe("StatusBar", () => {
  let stdout;
  let bar;

  beforeEach(() => {
    stdout = createMockStdout();
    bar = new StatusBar({ stdout, env: { NO_COLOR: "1" } });
  });

  it("creates with default empty state", () => {
    assert.equal(bar.model, "");
    assert.equal(bar.provider, "");
    assert.equal(bar.promptTokens, 0);
    assert.equal(bar.completionTokens, 0);
    assert.equal(bar.estimatedCost, 0);
  });

  it("update() sets properties", () => {
    bar.update({
      model: "gpt-4o",
      provider: "openai",
      cwd: "/projects/my-app",
      branch: "main",
      sessionId: "sess-123"
    });

    assert.equal(bar.model, "gpt-4o");
    assert.equal(bar.provider, "openai");
    assert.equal(bar.cwd, "/projects/my-app");
    assert.equal(bar.branch, "main");
    assert.equal(bar.sessionId, "sess-123");
  });

  it("addUsage() accumulates token counts", () => {
    bar.addUsage({ promptTokens: 100, completionTokens: 50, estimatedCost: 0.002 });
    bar.addUsage({ promptTokens: 200, completionTokens: 100, estimatedCost: 0.004 });

    assert.equal(bar.promptTokens, 300);
    assert.equal(bar.completionTokens, 150);
    assert.ok(Math.abs(bar.estimatedCost - 0.006) < 0.0001);
  });

  it("resetCounters() clears all counters", () => {
    bar.addUsage({ promptTokens: 500, completionTokens: 300, estimatedCost: 0.01 });
    bar.resetCounters();

    assert.equal(bar.promptTokens, 0);
    assert.equal(bar.completionTokens, 0);
    assert.equal(bar.estimatedCost, 0);
  });

  it("render() writes to stdout", () => {
    bar.update({ model: "gpt-4o", provider: "openai" });
    bar.addUsage({ promptTokens: 1500, completionTokens: 3400 });

    const result = bar.render();
    assert.ok(result.length > 0, "Should produce output");
    assert.ok(stdout.chunks.length > 0, "Should write to stdout");
  });

  it("render() includes model info", () => {
    bar.update({ model: "claude-3.5-sonnet", provider: "anthropic" });
    bar.render();
    assert.ok(stdout.output.includes("claude-3.5-sonnet"), "Should include model name");
  });

  it("render() includes branch info when available", () => {
    bar.update({ branch: "feature/tui" });
    bar.render();
    assert.ok(stdout.output.includes("feature/tui"), "Should include branch name");
  });

  it("renderTurnSummary() shows token counts", () => {
    bar.addUsage({ promptTokens: 1200, completionTokens: 800 });
    const result = bar.renderTurnSummary();
    assert.ok(result.includes("1.2k") || result.includes("1200"), "Should show prompt tokens");
  });

  it("renderTurnSummary() returns empty when no usage", () => {
    const result = bar.renderTurnSummary();
    assert.equal(result, "", "Should return empty string with no usage data");
  });

  it("renderTurnSummary() includes cost when available", () => {
    bar.addUsage({ promptTokens: 100, completionTokens: 50, estimatedCost: 0.035 });
    const result = bar.renderTurnSummary();
    assert.ok(result.includes("$0.035") || result.includes("0.035"), "Should show cost");
  });

  it("handles null/undefined stdout gracefully", () => {
    const brokenBar = new StatusBar({ stdout: null });
    const result = brokenBar.render();
    assert.equal(result, "");
  });
});
