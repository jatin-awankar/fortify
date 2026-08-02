import assert from "node:assert/strict";
import test from "node:test";
import { DiffRenderer, createDiffRenderer } from "../src/renderers/diff-renderer.js";
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

test("DiffRenderer renders rounded box frame with filename and line stats", () => {
  const stdout = createMockStream();
  const terminalUI = new TerminalUI({ stdout, env: { FORCE_COLOR: "0" } });
  const diffRenderer = createDiffRenderer({ terminalUI });

  const diffText = `@@ -1,3 +1,4 @@
-const timeout = 1000;
+const timeout = 5000;
+const retry = true;`;

  diffRenderer.renderDiffCard("src/config.js", diffText);
  const output = stdout.getOutput();

  assert.ok(output.includes("src/config.js"));
  assert.ok(output.includes("╭─"));
  assert.ok(output.includes("╰─"));
  assert.ok(output.includes("+2"));
  assert.ok(output.includes("-1"));
  assert.ok(output.includes("const timeout = 5000;"));
});

test("DiffRenderer formats additions and deletions with colored styles", () => {
  const stdout = createMockStream();
  const terminalUI = new TerminalUI({ stdout, env: { FORCE_COLOR: "0" } });
  const renderer = new DiffRenderer({ terminalUI });

  renderer.renderDiffCard("test.txt", "+added line\n-removed line");
  const output = stdout.getOutput();

  assert.ok(output.includes("+added line"));
  assert.ok(output.includes("-removed line"));
});
