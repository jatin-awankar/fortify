import test from "node:test";
import assert from "node:assert/strict";
import { detectNodeStackTrace } from "../src/utils/stack-trace.js";
import { estimateTokenCountFromText } from "../src/utils/token-safety.js";
import { LocalHistoryStore } from "../src/storage/local-history-store.js";
import { ConfigService } from "../src/services/config-service.js";
import { PluginService } from "../src/services/plugin-service.js";
import { highlightCodeLine } from "../src/renderers/code-highlighter.js";

test("Bug 22: redactConfigValue handles short strings without duplication", async () => {
  const configService = new ConfigService({
    configLoader: async () => ({
      provider: "openai",
      apiKeys: { openai: "short" }
    })
  });
  const res = await configService.listConfig();
  assert.equal(res.config.apiKeys.openai, "****");
});

test("Bug 23: detectNodeStackTrace handles Windows drive paths and Error [ERR_...] headers", () => {
  const stack = `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'express'\n    at C:\\project\\app.js:42:10`;
  const result = detectNodeStackTrace(stack);
  assert.equal(result.detected, true);
  assert.ok(result.header.includes("ERR_MODULE_NOT_FOUND"));
  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0].filePath, "C:\\project\\app.js");
  assert.equal(result.frames[0].line, 42);
  assert.equal(result.frames[0].column, 10);
});

test("Bug 26: highlightCodeLine does not treat URLs inside strings as comments", () => {
  const chalk = {
    green: (s) => s,
    magentaBright: (s) => s,
    cyanBright: (s) => s,
    gray: (s) => `[GRAY:${s}]`,
    white: (s) => s
  };

  const line = 'const url = "http://localhost:3000";';
  const highlighted = highlightCodeLine(line, { language: "js", chalk });
  assert.ok(!highlighted.includes("[GRAY://localhost:3000\"]"));
});

test("Bug 28: estimateTokenCountFromText accounts for multi-byte UTF-8 Hindi/CJK text", () => {
  const hindiText = "नमस्ते दुनिया आप कैसे हैं";
  const tokens = estimateTokenCountFromText(hindiText);
  assert.ok(tokens >= 15);
});

test("Bug 34: LocalHistoryStore sanitizes Windows reserved device names in session IDs", () => {
  const store = new LocalHistoryStore();
  const fileCon = store.getSessionFilePath("CON");
  const fileNul = store.getSessionFilePath("NUL");
  assert.ok(fileCon.includes("CON_session.json"));
  assert.ok(fileNul.includes("NUL_session.json"));
});

test("Bug 38: PluginService expandPromptShortcuts handles circular definitions without freezing", async () => {
  const pluginService = new PluginService();
  pluginService.getShortcutsMap = async () => ({
    "@a": "@b shortcut",
    "@b": "@a shortcut"
  });

  const expanded = await pluginService.expandPromptShortcuts("Testing @a");
  assert.ok(expanded.includes("Shortcut: @a"));
});
