import assert from "node:assert/strict";
import test from "node:test";
import { createAnsiStyle } from "../src/renderers/ansi-style.js";
import { highlightCodeLine } from "../src/renderers/code-highlighter.js";
import { SummarizeRenderer } from "../src/renderers/summarize-renderer.js";

const chalk = createAnsiStyle({ forceColor: true });

test("highlightCodeLine formats diff additions, deletions, and line headers", () => {
  const added = highlightCodeLine("+ const x = 1;", { language: "diff", chalk });
  assert.equal(added, chalk.green("+ const x = 1;"));

  const deleted = highlightCodeLine("- const x = 1;", { language: "diff", chalk });
  assert.equal(deleted, chalk.red("- const x = 1;"));

  const header = highlightCodeLine("@@ -1,3 +1,3 @@", { language: "diff", chalk });
  assert.equal(header, chalk.cyan("@@ -1,3 +1,3 @@"));

  const contextLine = highlightCodeLine("  const x = 1;", { language: "diff", chalk });
  assert.equal(contextLine, chalk.gray("  const x = 1;"));
});

test("SummarizeRenderer manages ora spinner during workspace discovery", () => {
  let spinnerStatus = "stopped";
  let spinnerText = "";

  const mockOraFactory = ({ text }) => {
    spinnerText = text;
    spinnerStatus = "started";
    return {
      start() {
        return this;
      },
      succeed(text) {
        spinnerStatus = `succeeded: ${text}`;
      },
      fail(text) {
        spinnerStatus = `failed: ${text}`;
      }
    };
  };

  const renderer = new SummarizeRenderer({
    terminalUI: {
      capabilities: { isInteractive: true },
      divider() {},
      info() {},
      warning() {},
      error() {}
    },
    oraFactory: mockOraFactory
  });

  renderer.showStart({ sourcePath: "." });
  assert.equal(spinnerStatus, "started");
  assert.equal(spinnerText, "Scanning workspace files...");

  renderer.showDiscovery({ fileCount: 42 });
  assert.equal(spinnerStatus, "succeeded: Discovered 42 text/code files.");
});
