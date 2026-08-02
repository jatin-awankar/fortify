import assert from "node:assert/strict";
import test from "node:test";
import { createCompleter, DEFAULT_SLASH_COMMANDS } from "../src/renderers/prompt-editor.js";

test("PromptEditor completer matches slash commands", () => {
  const completer = createCompleter({ commands: DEFAULT_SLASH_COMMANDS });

  const [hits, line] = completer("/co");
  assert.equal(line, "/co");
  assert.deepEqual(hits, ["/commit"]);
});

test("PromptEditor completer returns all slash commands for single slash", () => {
  const completer = createCompleter({ commands: DEFAULT_SLASH_COMMANDS });

  const [hits] = completer("/");
  assert.ok(hits.includes("/commit"));
  assert.ok(hits.includes("/explain"));
  assert.ok(hits.includes("/help"));
});

test("PromptEditor completer matches @file path completions", () => {
  const mockGetFiles = () => ["src/index.js", "src/config.js", "README.md"];
  const completer = createCompleter({ getFiles: mockGetFiles });

  const [hits] = completer("Check @src/in");
  assert.ok(hits.length > 0);
  assert.ok(hits[0].includes("@src/index.js"));
});
