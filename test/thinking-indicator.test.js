import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ThinkingIndicator } from "../src/renderers/thinking-indicator.js";

function createMockStdout() {
  const chunks = [];
  return {
    chunks,
    isTTY: true,
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

describe("ThinkingIndicator", () => {
  let stdout;
  let indicator;

  beforeEach(() => {
    stdout = createMockStdout();
  });

  afterEach(() => {
    if (indicator && indicator.isActive) {
      indicator.stop();
    }
  });

  it("starts in default mode", () => {
    indicator = new ThinkingIndicator({ stdout, env: { NO_COLOR: "1" } });
    indicator.start();
    assert.ok(indicator.isActive, "Should be active after start");
    indicator.stop();
    assert.ok(!indicator.isActive, "Should be inactive after stop");
  });

  it("starts in extended mode with 🧠 icon", () => {
    indicator = new ThinkingIndicator({ stdout, env: { NO_COLOR: "1" } });
    indicator.start("extended");
    assert.ok(indicator.isActive);
    // In TTY mode, it renders via interval; check first frame was written
    assert.ok(stdout.chunks.length > 0, "Should write initial frame");
    assert.ok(stdout.output.includes("🧠"), "Extended mode should include brain emoji");
    indicator.stop();
  });

  it("tracks elapsed time", async () => {
    indicator = new ThinkingIndicator({ stdout, env: { NO_COLOR: "1" }, intervalMs: 50 });
    indicator.start();
    assert.ok(indicator.elapsedSeconds >= 0, "Elapsed should be >= 0");
    indicator.stop();
  });

  it("complete() stops and writes success message", () => {
    indicator = new ThinkingIndicator({ stdout, env: { NO_COLOR: "1" } });
    indicator.start();
    stdout.clear();
    indicator.complete("Done thinking");
    assert.ok(!indicator.isActive, "Should be inactive after complete");
    assert.ok(stdout.output.includes("Done thinking"), "Should include completion message");
  });

  it("does not double-start", () => {
    indicator = new ThinkingIndicator({ stdout, env: { NO_COLOR: "1" } });
    indicator.start();
    const chunkCount = stdout.chunks.length;
    indicator.start(); // Second start should be a no-op
    assert.equal(stdout.chunks.length, chunkCount, "Should not write again on double start");
    indicator.stop();
  });

  it("handles non-TTY mode with static text", () => {
    const chunks = [];
    const nonTTYStdout = {
      isTTY: false,
      write(data) { chunks.push(data); return true; },
      get output() { return chunks.join(""); }
    };
    indicator = new ThinkingIndicator({ stdout: nonTTYStdout, env: { NO_COLOR: "1" } });
    indicator.start();
    assert.ok(nonTTYStdout.output.includes("Thinking..."), "Non-TTY should show static text");
    assert.ok(indicator.isActive);
    indicator.stop();
  });

  it("stop() is idempotent", () => {
    indicator = new ThinkingIndicator({ stdout, env: { NO_COLOR: "1" } });
    indicator.stop(); // No-op when not active
    indicator.start();
    indicator.stop();
    indicator.stop(); // Second stop should be a no-op
    assert.ok(!indicator.isActive);
  });
});
