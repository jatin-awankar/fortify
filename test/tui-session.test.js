import assert from "node:assert/strict";
import test from "node:test";
import { TUISession, createTUISession } from "../src/renderers/tui-session.js";
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

test("TUISession renders header box with model name and session id", () => {
  const stdout = createMockStream();
  const terminalUI = new TerminalUI({ stdout, env: { FORCE_COLOR: "0" } });
  const session = createTUISession({ terminalUI });

  session.renderHeader({
    model: "gpt-4o",
    provider: "openai",
    sessionId: "sess-123"
  });

  const output = stdout.getOutput();
  assert.ok(output.includes("Fortify"));
  assert.ok(output.includes("Model: gpt-4o"));
  assert.ok(output.includes("Session: sess-123"));
});

test("TUISession renders help footer tips", () => {
  const stdout = createMockStream();
  const terminalUI = new TerminalUI({ stdout, env: { FORCE_COLOR: "0" } });
  const session = createTUISession({ terminalUI });

  session.renderHelpFooter();
  const output = stdout.getOutput();
  assert.ok(output.includes("/help"));
  assert.ok(output.includes("/commit"));
  assert.ok(output.includes("@filename"));
});
