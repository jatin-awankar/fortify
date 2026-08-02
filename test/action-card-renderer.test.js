import assert from "node:assert/strict";
import test from "node:test";
import { ActionCardRenderer, createActionCardRenderer } from "../src/renderers/action-card-renderer.js";
import { TerminalUI } from "../src/renderers/terminal-ui.js";

function createMockStream() {
  let output = "";
  return {
    write(chunk) {
      output += chunk;
    },
    getOutput() {
      return output;
    }
  };
}

test("ActionCardRenderer renders pending action card with icon and metadata", () => {
  const stdout = createMockStream();
  const terminalUI = new TerminalUI({ stdout, env: { FORCE_COLOR: "0" } });
  const renderer = createActionCardRenderer({ terminalUI });

  renderer.renderCard({
    type: "read_file",
    title: "Reading file src/index.js",
    metadata: "32 lines",
    status: "pending"
  });

  const output = stdout.getOutput();
  assert.ok(output.includes("📄"));
  assert.ok(output.includes("Reading file src/index.js"));
  assert.ok(output.includes("(32 lines)"));
});

test("ActionCardRenderer renders success status badge", () => {
  const stdout = createMockStream();
  const terminalUI = new TerminalUI({ stdout, env: { FORCE_COLOR: "0" } });
  const renderer = new ActionCardRenderer({ terminalUI });

  renderer.renderCard({
    type: "write_file",
    title: "Updated src/config.js",
    status: "success"
  });

  const output = stdout.getOutput();
  assert.ok(output.includes("✓"));
  assert.ok(output.includes("Updated src/config.js"));
});

test("ActionCardRenderer renders step progress indicator", () => {
  const stdout = createMockStream();
  const terminalUI = new TerminalUI({ stdout, env: { FORCE_COLOR: "0" } });
  const renderer = createActionCardRenderer({ terminalUI });

  renderer.renderStepProgress(1, 4, "Analyzing codebase dependencies");
  const output = stdout.getOutput();
  assert.ok(output.includes("[1/4]"));
  assert.ok(output.includes("Analyzing codebase dependencies"));
});

test("ActionCardRenderer renders command execution card", () => {
  const stdout = createMockStream();
  const terminalUI = new TerminalUI({ stdout, env: { FORCE_COLOR: "0" } });
  const renderer = createActionCardRenderer({ terminalUI });

  renderer.renderCommandCard("npm test", { cwd: "./src", status: "running" });
  const output = stdout.getOutput();
  assert.ok(output.includes("⚡"));
  assert.ok(output.includes("`npm test`"));
  assert.ok(output.includes("in ./src"));
});
