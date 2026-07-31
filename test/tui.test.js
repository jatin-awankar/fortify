import assert from "node:assert/strict";
import test from "node:test";
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

test("TerminalUI box renders title and content with border frame", () => {
  const stdout = createMockStream();
  const ui = new TerminalUI({ stdout, env: { FORCE_COLOR: "0" } });

  ui.box("Status Notice", "All services operating normally.");
  const rendered = stdout.getOutput();

  assert.ok(rendered.includes("Status Notice"));
  assert.ok(rendered.includes("All services operating normally."));
  assert.ok(rendered.includes("┌─"));
  assert.ok(rendered.includes("└"));
});

test("TerminalUI table renders aligned columns for headers and rows", () => {
  const stdout = createMockStream();
  const ui = new TerminalUI({ stdout, env: { FORCE_COLOR: "0" } });

  ui.table(
    ["Key", "Value"],
    [
      ["provider", "openai"],
      ["model", "gpt-5.4"]
    ]
  );

  const rendered = stdout.getOutput();
  assert.ok(rendered.includes("Key"));
  assert.ok(rendered.includes("Value"));
  assert.ok(rendered.includes("provider"));
  assert.ok(rendered.includes("openai"));
});
